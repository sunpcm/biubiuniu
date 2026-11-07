import { getAccessToken, getPayPalApiBaseUrl } from "@/lib/paypal/client";
import { getLogger, type AppLogger } from "@/lib/logger";

/** Maximum number of retries */
const MAX_RETRIES = 5;

/** Base delay (milliseconds) */
const BASE_DELAY_MS = 200;

/**
 * One verify-webhook-signature HTTP round-trip (access token + POST). The
 * default implementation performs the real network call; a test fixture only
 * replaces this transport (never the verification-status branch below) so the
 * success/failure outcome is still decided by `verification_status === 'SUCCESS'`.
 */
export interface PayPalVerifyTransport {
  verifySignature(requestBody: string): Promise<{
    status: number;
    verificationStatus?: string;
  }>;
}

function createDefaultPayPalVerifyTransport(logger: AppLogger): PayPalVerifyTransport {
  return {
    async verifySignature(requestBody) {
      const accessToken = await getAccessToken();
      const response = await fetch(
        `${getPayPalApiBaseUrl()}/v1/notifications/verify-webhook-signature`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: requestBody,
        },
      );
      if (response.status >= 400 && response.status < 500) {
        const errorBody = await response.text();
        logger.error(
          { status: response.status, responseBody: errorBody },
          "PayPal webhook signature verification failed",
        );
        return { status: response.status };
      }
      if (response.status >= 500) {
        return { status: response.status };
      }
      const result = (await response.json()) as { verification_status: string };
      return {
        status: response.status,
        verificationStatus: result.verification_status,
      };
    },
  };
}

/**
 * Verify a PayPal webhook signature with exponential-backoff retry.
 *
 * Retry schedule:
 * - retry 1: wait 200ms  (200 * 2^0)
 * - retry 2: wait 400ms  (200 * 2^1)
 * - retry 3: wait 800ms  (200 * 2^2)
 * - retry 4: wait 1600ms (200 * 2^3)
 * - retry 5: wait 3200ms (200 * 2^4)
 * Maximum total wait ≈ 6.2 seconds
 *
 * Only network errors and 5xx status codes are retried; 4xx errors fail
 * immediately (an invalid signature does not need retrying).
 */
export async function verifyPayPalWebhookSignature(
  webhookHeaders: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
  },
  rawBody: string,
  transport?: PayPalVerifyTransport,
  webhookId: string | undefined = process.env.PAYPAL_WEBHOOK_ID,
  logger: AppLogger = getLogger("billing.paypal.webhook.verify"),
): Promise<boolean> {
  const activeTransport = transport ?? createDefaultPayPalVerifyTransport(logger);

  if (!webhookId) {
    logger.error({}, "PAYPAL_WEBHOOK_ID not configured");
    return false;
  }

  // Important: PayPal signature verification requires the webhook_event to be
  // byte-for-byte identical to the raw body. PayPal's verify-webhook-signature
  // API validates the signature against transmission_id + transmission_time +
  // webhook_id + CRC32(rawBody) from the headers (transmission_sig + cert_url),
  // not against the body we send. The webhook_event we send merely tells PayPal
  // the event content.
  //
  // To be safe, we build the request body by concatenating the raw body
  // directly, avoiding any potential serialization differences:
  const verifyBodyStr = JSON.stringify({
    auth_algo: webhookHeaders.authAlgo,
    cert_url: webhookHeaders.certUrl,
    transmission_id: webhookHeaders.transmissionId,
    transmission_sig: webhookHeaders.transmissionSig,
    transmission_time: webhookHeaders.transmissionTime,
    webhook_id: webhookId,
  });
  // Manual concatenation: use the original rawBody string as the value of
  // webhook_event without parsing/stringifying it.
  const requestBody = verifyBodyStr.slice(0, -1) + ',"webhook_event":' + rawBody + "}";

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Not the first attempt: wait for the exponential-backoff delay
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { attempt, maxRetries: MAX_RETRIES, delayMs: delay },
          "PayPal webhook signature verification retry",
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const { status, verificationStatus } = await activeTransport.verifySignature(requestBody);

      // 4xx error: invalid signature or malformed request; do not retry
      if (status >= 400 && status < 500) {
        return false;
      }

      // 5xx error: PayPal server-side issue; keep retrying
      if (status >= 500) {
        lastError = new Error(`PayPal API returned ${status}`);
        continue;
      }

      // Successful response
      const isValid = status >= 200 && status < 300 && verificationStatus === "SUCCESS";

      if (!isValid) {
        logger.warn(
          { status, verificationStatus },
          "PayPal webhook signature verification did not return SUCCESS",
        );
      }

      return isValid;
    } catch (error) {
      // Network error (DNS failure, connection timeout, etc.); keep retrying
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.error(
        { attempt: attempt + 1, maxAttempts: MAX_RETRIES + 1, err: lastError },
        "PayPal webhook signature verification attempt failed",
      );
    }
  }

  // All retries failed
  logger.error(
    { maxAttempts: MAX_RETRIES + 1, err: lastError },
    "PayPal webhook signature verification exhausted retries",
  );
  return false;
}
