/** Real webhook handler; signature verification and dispatch share the testable factory. */
import { createCreemWebhookHandler } from '@/lib/creem/webhook';

export const maxDuration = 60;
export const POST = createCreemWebhookHandler();
