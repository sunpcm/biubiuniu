/**
 * [INPUT]: Depends on the Creem client from creem (the official TypeScript
 *          SDK 1.x), the entity type aliases from ./types, getErrorMessage
 *          from @/lib/error-utils, and the env vars CREEM_API_KEY /
 *          CREEM_WEBHOOK_SECRET / CREEM_API_BASE_URL (optional override)
 * [OUTPUT]: Exports isCreemEnabled, creemMode, getCreem,
 *           createCreemCheckoutSession, retrieveCreemCheckoutSession,
 *           retrieveCreemSubscription, cancelCreemSubscription,
 *           refundCreemTransaction, createCreemCustomerPortalLink
 * [POS]: The SDK wrapper of lib/creem — the only file that instantiates the
 *        Creem SDK; test/live is derived from the API key prefix
 *        (creem_test_ → test) and selects the creemProductId column in
 *        config/pricing; business translation lives in lib/billing/creem,
 *        this layer only does transport
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getErrorMessage } from '@/lib/error-utils';
import { Creem } from 'creem';
import type {
  CreemCheckout,
  CreemCheckoutCreateParams,
  CreemRefundResponse,
  CreemSubscription,
} from './types';

const CREEM_API_KEY = process.env.CREEM_API_KEY;
const CREEM_WEBHOOK_SECRET = process.env.CREEM_WEBHOOK_SECRET;

export const isCreemEnabled =
  Boolean(CREEM_API_KEY) && Boolean(CREEM_WEBHOOK_SECRET);

/**
 * test/live is derived from the API key prefix (creem_test_… is a test key) —
 * same source as the key itself, so it cannot be misconfigured. It selects the
 * environment column of creemProductId in config/pricing.ts.
 */
export const creemMode: 'test' | 'live' = CREEM_API_KEY?.startsWith(
  'creem_test_'
)
  ? 'test'
  : 'live';

// ============================================================================
// SDK singleton — lazily initialized: importing this file at build time or
// while unconfigured must never throw
// ============================================================================

/**
 * CREEM_API_BASE_URL is an optional override. Legacy configs carry a /v1
 * suffix while the SDK's own paths already include /v1 ("/v1/checkouts"), so
 * it is stripped here for compatibility; when unset, the SDK picks between
 * api.creem.io and test-api.creem.io according to creemMode.
 */
function resolveServerURL(): string | undefined {
  const raw = process.env.CREEM_API_BASE_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, '').replace(/\/v1$/, '');
}

let client: Creem | null = null;

export function getCreem(): Creem {
  if (!CREEM_API_KEY) {
    throw new Error(
      'Creem API key is not configured. Set CREEM_API_KEY to enable Creem integration.'
    );
  }
  if (!client) {
    client = new Creem({
      apiKey: CREEM_API_KEY,
      server: creemMode === 'test' ? 'test' : 'prod',
      serverURL: resolveServerURL(),
    });
  }
  return client;
}

// ============================================================================
// Thin wrappers — they only prepend context; the SDK's original error text
// (HTTP status and response body included) stays in the message so lib/billing
// can classify "already canceled / does not exist / already refunded" from it
// ============================================================================

export async function createCreemCheckoutSession(
  params: CreemCheckoutCreateParams
): Promise<CreemCheckout> {
  try {
    return await getCreem().checkouts.create(params);
  } catch (error) {
    throw new Error(
      `Failed to create Creem checkout session: ${getErrorMessage(error)}`
    );
  }
}

export async function retrieveCreemCheckoutSession(
  checkoutId: string
): Promise<CreemCheckout> {
  try {
    return await getCreem().checkouts.retrieve(checkoutId);
  } catch (error) {
    throw new Error(
      `Failed to retrieve Creem checkout ${checkoutId}: ${getErrorMessage(error)}`
    );
  }
}

export async function retrieveCreemSubscription(
  subscriptionId: string
): Promise<CreemSubscription> {
  try {
    return await getCreem().subscriptions.get(subscriptionId);
  } catch (error) {
    throw new Error(
      `Failed to retrieve Creem subscription ${subscriptionId}: ${getErrorMessage(error)}`
    );
  }
}

/**
 * Cancels a Creem subscription immediately (POST /v1/subscriptions/{id}/cancel,
 * mode=immediate) — the stop-loss action for full refunds / subscriptions
 * judged duplicate, always invoked through lib/billing/cancel.
 */
export async function cancelCreemSubscription(
  subscriptionId: string
): Promise<CreemSubscription> {
  try {
    return await getCreem().subscriptions.cancel(subscriptionId, {
      mode: 'immediate',
    });
  } catch (error) {
    throw new Error(
      `Failed to cancel Creem subscription ${subscriptionId}: ${getErrorMessage(error)}`
    );
  }
}

/**
 * Full refund (POST /v1/refunds): Creem refunds the entire remaining
 * refundable amount for a transaction id and accepts no amount parameter; the
 * provider returns pending while it confirms asynchronously, and the local
 * ledger always waits for the refund.created webhook to settle.
 */
export async function refundCreemTransaction(
  transactionId: string
): Promise<CreemRefundResponse> {
  try {
    return await getCreem().transactions.refund({ transactionId });
  } catch (error) {
    throw new Error(
      `Failed to refund Creem transaction ${transactionId}: ${getErrorMessage(error)}`
    );
  }
}

export async function createCreemCustomerPortalLink(
  customerId: string
): Promise<string> {
  try {
    const { customerPortalLink } =
      await getCreem().customers.generateBillingLinks({ customerId });
    if (!customerPortalLink) {
      throw new Error('Portal link not returned from Creem API');
    }
    return customerPortalLink;
  } catch (error) {
    throw new Error(
      `Failed to create Creem customer portal link for ${customerId}: ${getErrorMessage(error)}`
    );
  }
}
