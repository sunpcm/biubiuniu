/** Real webhook handler; signature verification and dispatch share the testable factory. */
import { createStripeWebhookHandler } from '@/lib/stripe/webhook';

export const maxDuration = 60;
export const POST = createStripeWebhookHandler();
