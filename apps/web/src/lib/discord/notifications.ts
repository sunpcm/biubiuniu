/**
 * [INPUT]: Depends on @/lib/error-utils for getErrorMessage, on env for
 *          DISCORD_WEBHOOK_URL / DISCORD_ORDER_WEBHOOK_URL
 * [OUTPUT]: Exports the generic sender sendDiscordNotification and the
 *           business alerts notifyNewOrder / notifyDuplicateSubscription /
 *           notifyPendingPayment / notifyPaymentDenied / notifyDispute /
 *           notifySignupGiftWithheld, plus payload types such as
 *           DiscordEmbed / DiscordWebhookPayload
 * [POS]: The only member of lib/discord — the single funnel for ops-facing
 *        Discord notifications, all fire-and-safe (never throws, failures are
 *        only logged), consumed by lib/billing's fulfillment core, the Creem
 *        adapter, the PayPal capture route and lib/auth/signup-rewards
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { getErrorMessage } from "@/lib/error-utils";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  timestamp?: string;
  footer?: {
    text: string;
  };
  thumbnail?: {
    url: string;
  };
}

export interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

/**
 * Sends a generic Discord notification using a webhook
 * @param webhookUrl The Discord webhook URL
 * @param payload The payload to send to the webhook
 * @returns A promise that resolves to an object indicating success or failure
 */
export async function sendDiscordNotification({
  webhookUrl,
  payload,
}: {
  webhookUrl: string;
  payload: DiscordWebhookPayload;
}): Promise<{ success: boolean; error?: string }> {
  webhookUrl = webhookUrl || process.env.DISCORD_WEBHOOK_URL || '';

  if (!webhookUrl) {
    const message = "Discord webhook URL not provided";
    console.warn(message);
    return { success: false, error: message };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Discord webhook failed:', response.status, errorText);
      return {
        success: false,
        error: `Discord webhook failed: ${response.status} ${errorText}`,
      };
    }

    console.log('Discord notification sent successfully.');
    return { success: true };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error('Error sending Discord notification:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

const DISCORD_GREEN = 0x57f287

const ORDER_TITLES: Record<string, string> = {
  one_time: "💰 Credit Pack Purchased",
  subscription_initial: "🎉 New Subscription",
  subscription_renewal: "🔁 Subscription Renewed",
  subscription_upgrade: "⬆️ Subscription Upgraded",
};

/**
 * A paid order landed (pack purchase / subscription start / renewal /
 * mid-cycle upgrade) — push it to the private orders channel (falls back to
 * the general webhook). Fire-and-safe: never throws, failures only log.
 */
export async function notifyNewOrder(params: {
  orderType:
    | "one_time"
    | "subscription_initial"
    | "subscription_renewal"
    | "subscription_upgrade";
  planId: string;
  creditsGranted: number;
  /** Integer cents (provider native); converted to display amount only here */
  amountTotal: number;
  currency: string;
  userId: string;
}): Promise<void> {
  const { orderType, planId, creditsGranted, amountTotal, currency, userId } =
    params;

  await sendDiscordNotification({
    webhookUrl:
      process.env.DISCORD_ORDER_WEBHOOK_URL ||
      process.env.DISCORD_WEBHOOK_URL ||
      '',
    payload: {
      embeds: [
        {
          title: ORDER_TITLES[orderType] ?? `💰 New Order (${orderType})`,
          color: DISCORD_GREEN,
          fields: [
            {
              name: "Amount",
              value: `${(amountTotal / 100).toFixed(2)} ${currency.toUpperCase()}`,
              inline: true,
            },
            { name: "Plan", value: planId, inline: true },
            {
              name: "Credits",
              value: String(creditsGranted),
              inline: true,
            },
            { name: "User", value: userId },
          ],
        },
      ],
    },
  });
}

const DISCORD_RED = 0xed4245

/**
 * Defense #2 fired: a duplicate subscription payment for the same
 * subject was handled automatically (first fulfilled wins; the duplicate is
 * canceled + refunded). refunded=false means the automatic refund was
 * unavailable or failed — ops must refund manually in the provider dashboard,
 * and the refund webhook will then advance the local order to refunded.
 * Fire-and-safe: never throws, failures only log.
 */
export async function notifyDuplicateSubscription(params: {
  provider: string;
  providerSubscriptionId: string;
  /** Idempotency key (stripe invoice id / creem transaction id / paypal sale id) */
  providerOrderId: string;
  winnerProvider: string;
  winnerProviderSubscriptionId: string;
  /** Integer cents (provider native) */
  amountTotal: number;
  currency: string;
  userId: string;
  /** Whether the automatic refund was issued; false = manual refund needed */
  refunded: boolean;
}): Promise<void> {
  await sendDiscordNotification({
    webhookUrl:
      process.env.DISCORD_ORDER_WEBHOOK_URL ||
      process.env.DISCORD_WEBHOOK_URL ||
      '',
    payload: {
      embeds: [
        {
          title: params.refunded
            ? "♻️ Duplicate Subscription Auto-Refunded"
            : "🚨 Duplicate Subscription — MANUAL REFUND NEEDED",
          description: `A second live subscription for the same billing subject was detected at fulfillment. The duplicate was canceled${params.refunded ? " and refunded automatically" : ", but the payment could NOT be auto-refunded — refund it in the provider dashboard"}.`,
          color: DISCORD_RED,
          fields: [
            {
              name: "Amount",
              value: `${(params.amountTotal / 100).toFixed(2)} ${params.currency.toUpperCase()}`,
              inline: true,
            },
            {
              name: "Duplicate",
              value: `${params.provider} / ${params.providerSubscriptionId}`,
              inline: true,
            },
            {
              name: "Kept (winner)",
              value: `${params.winnerProvider} / ${params.winnerProviderSubscriptionId}`,
              inline: true,
            },
            { name: "Payment ref", value: params.providerOrderId, inline: true },
            { name: "User", value: params.userId, inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
}

const DISCORD_AMBER = 0xf59e0b

/**
 * A capture entered PENDING (eCheck clearing / risk review): money is in
 * flight, no credits granted, and — by design — no local order row exists
 * (orders store confirmed payments only). This alert IS the local trace:
 * if the settlement webhook (PAYMENT.CAPTURE.COMPLETED) is ever lost, it
 * is what lets an admin chase the capture in the provider dashboard.
 * Fire-and-safe: never throws, failures only log.
 */
export async function notifyPendingPayment(params: {
  provider: string;
  /** Capture/payment id — the handle to look up in the provider dashboard */
  providerPaymentId: string;
  planId: string;
  /** Decimal display amount as reported by the provider (e.g. "9.99") */
  amountValue: string;
  currency: string;
  userId: string;
}): Promise<void> {
  await sendDiscordNotification({
    webhookUrl:
      process.env.DISCORD_ORDER_WEBHOOK_URL ||
      process.env.DISCORD_WEBHOOK_URL ||
      '',
    payload: {
      embeds: [
        {
          title: "⏳ Payment Pending Settlement",
          description:
            "A capture is awaiting settlement (eCheck / risk review). No credits were granted and no local order exists yet — fulfillment happens when the settlement webhook arrives. If no completion or denial follows within a few days, check this capture in the provider dashboard.",
          color: DISCORD_AMBER,
          fields: [
            {
              name: "Amount",
              value: `${params.amountValue} ${params.currency.toUpperCase()}`,
              inline: true,
            },
            { name: "Plan", value: params.planId, inline: true },
            {
              name: "Capture",
              value: `${params.provider} / ${params.providerPaymentId}`,
              inline: true,
            },
            { name: "User", value: params.userId },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
}

/**
 * A previously pending capture was denied (eCheck bounced / risk declined):
 * no money arrived and no credits were ever granted — this closes out the
 * pending alert above, no action needed. Fire-and-safe: never throws.
 */
export async function notifyPaymentDenied(params: {
  provider: string;
  providerPaymentId: string;
  planId: string;
  userId: string;
}): Promise<void> {
  await sendDiscordNotification({
    webhookUrl:
      process.env.DISCORD_ORDER_WEBHOOK_URL ||
      process.env.DISCORD_WEBHOOK_URL ||
      '',
    payload: {
      embeds: [
        {
          title: "🚫 Pending Payment Denied",
          description:
            "A pending capture was denied by the provider. No credits were granted, so there is nothing to claw back — this closes the earlier pending alert.",
          color: DISCORD_RED,
          fields: [
            { name: "Plan", value: params.planId, inline: true },
            {
              name: "Capture",
              value: `${params.provider} / ${params.providerPaymentId}`,
              inline: true,
            },
            { name: "User", value: params.userId },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
}

/**
 * A chargeback / dispute was opened at the provider. No money has moved yet
 * and the ledger is untouched — operations must respond in the provider
 * dashboard before the deadline. Fire-and-safe: never throws.
 */
export async function notifyDispute(params: {
  provider: string;
  disputeId: string;
  /** Transaction / charge / capture id the dispute is raised against */
  providerPaymentId: string;
  providerOrderId: string | null;
  /** Integer cents (provider native) */
  amount: number;
  currency: string;
  userId: string | null;
  planId: string | null;
}): Promise<void> {
  await sendDiscordNotification({
    webhookUrl:
      process.env.DISCORD_ORDER_WEBHOOK_URL ||
      process.env.DISCORD_WEBHOOK_URL ||
      '',
    payload: {
      embeds: [
        {
          title: "⚠️ Payment Dispute Opened",
          description:
            "A customer opened a chargeback. Nothing has been clawed back locally yet — respond to the dispute in the provider dashboard; a lost dispute arrives as a refund event and settles through the normal refund path.",
          color: DISCORD_RED,
          fields: [
            { name: "Provider", value: params.provider, inline: true },
            { name: "Dispute", value: params.disputeId, inline: true },
            {
              name: "Amount",
              value: `${(params.amount / 100).toFixed(2)} ${params.currency.toUpperCase()}`,
              inline: true,
            },
            { name: "Payment", value: params.providerPaymentId, inline: true },
            { name: "Order", value: params.providerOrderId ?? "unknown", inline: true },
            { name: "Plan", value: params.planId ?? "unknown", inline: true },
            { name: "User", value: params.userId ?? "unknown" },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
}

/*
Example usage:

// This is an example, please do not call it directly.
// You should call it in your own business logic.
async function example() {
  // 1. Simple text message
  const simplePayload: DiscordWebhookPayload = {
    content: 'Hello, Discord! This is a simple message.'
  };

  await sendDiscordNotification({
    webhookUrl: process.env.DISCORD_WEBHOOK_URL!, // Make sure to set this in your .env
    payload: simplePayload
  });


  // 2. Message with an embed
  const embedPayload: DiscordWebhookPayload = {
    embeds: [
      {
        title: "New User Registered",
        description: "A new user has signed up on our platform.",
        color: 0x00ff00, // Green
        fields: [
          {
            name: "Email",
            value: "test@example.com",
            inline: true
          },
          {
            name: "Username",
            value: "testuser",
            inline: true
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: "User Registration Service"
        }
      }
    ]
  };

  await sendDiscordNotification({
    webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
    payload: embedPayload
  });
}
*/

/**
 * The signup gift was withheld by the identity-cluster gate: signups from the
 * same IP / device fingerprint passed the cap inside the window. Pushed to the
 * ops channel so someone can see who is farming accounts; fire-and-safe,
 * failures are only logged.
 */
export async function notifySignupGiftWithheld(params: {
  userId: string;
  email: string;
  reason: "ip_cap" | "device_cap";
  ip?: string;
  deviceHash?: string;
  ipCount?: number;
  deviceCount?: number;
}): Promise<void> {
  const { userId, email, reason, ip, deviceHash, ipCount, deviceCount } = params;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  // Ops channel, not the order channel: this is account farming, not revenue
  await sendDiscordNotification({
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
    payload: {
      embeds: [
        {
          title: "🚧 Signup gift withheld",
          description: `**${email}** registered but got no welcome credits (${reason}).`,
          color: DISCORD_AMBER,
          fields: [
            { name: "IP", value: ip ? `${ip} (#${ipCount ?? "?"})` : "—", inline: true },
            {
              name: "Device",
              value: deviceHash
                ? `${deviceHash.slice(0, 12)}… (#${deviceCount ?? "?"})`
                : "—",
              inline: true,
            },
            { name: "Admin", value: `${baseUrl}/dashboard/admin/users` },
          ],
          footer: { text: `User ID: ${userId}` },
        },
      ],
    },
  });
}
