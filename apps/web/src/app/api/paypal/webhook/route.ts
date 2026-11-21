/** Real webhook handler; signature verification and dispatch share the testable factory. */
import { createPayPalWebhookHandler } from '@/lib/paypal/webhook';

export const maxDuration = 60;
export const POST = createPayPalWebhookHandler();
