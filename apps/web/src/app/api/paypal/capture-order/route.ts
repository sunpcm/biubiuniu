/** Fresh authorization precedes the sensitive provider capture side effect. */
import { getFreshSession } from '@/lib/auth/server';
import { createPayPalCaptureHandler } from '@/lib/paypal/capture';

export const POST = createPayPalCaptureHandler({ getFreshSession });
