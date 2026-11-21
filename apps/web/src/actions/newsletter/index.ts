'use server';
import { siteConfig } from '@/config/site';
import { NewsletterWelcomeEmail } from '@/emails/newsletter-welcome';
import { DEFAULT_LOCALE } from '@/i18n/routing';
import { actionResponse, ActionResult } from '@/lib/action-response';
import { normalizeEmail, validateEmail } from '@/lib/email';
import { removeContact, sendEmail } from '@/lib/mail';
import { checkRateLimit, getClientIPFromHeaders, RATE_LIMIT_CONFIGS } from '@/lib/redis';
import { getTranslations } from 'next-intl/server';

async function validateRateLimit(locale: string) {
  const t = await getTranslations({ locale, namespace: 'Footer.Newsletter' });

  const clientIP = await getClientIPFromHeaders();

  const success = await checkRateLimit(clientIP, RATE_LIMIT_CONFIGS.newsletter);
  if (!success) {
    throw new Error(t('subscribe.multipleSubmissions'));
  }
}

export async function subscribeToNewsletter(email: string, locale = DEFAULT_LOCALE): Promise<ActionResult<{ email: string }>> {
  try {
    await validateRateLimit(locale);

    const t = await getTranslations({ locale, namespace: 'Footer.Newsletter' });

    const normalizedEmail = normalizeEmail(email);
    const { isValid, error } = validateEmail(normalizedEmail);

    if (!isValid) {
      return actionResponse.error(error || t('subscribe.invalidEmail'));
    }

    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL;
    if (!adminEmail) {
      return actionResponse.error('DEFAULT_ADMIN_EMAIL is not configured');
    }

    const subject = `Welcome to ${siteConfig.name} Newsletter!`;
    const unsubscribeToken = Buffer.from(normalizedEmail).toString('base64');
    const unsubscribeLink = `${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe/newsletter?token=${unsubscribeToken}`;

    const result = await sendEmail({
      to: normalizedEmail,
      from: { email: adminEmail, name: process.env.DEFAULT_ADMIN_NAME || siteConfig.name },
      subject,
      react: NewsletterWelcomeEmail,
      reactProps: {
        email: normalizedEmail,
        unsubscribeLink: unsubscribeLink,
      },
      headers: {
        'List-Unsubscribe': `<${unsubscribeLink}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      addToContacts: true,
    });

    if (!result.success) {
      return actionResponse.error(t('subscribe.defaultErrorMessage'));
    }

    return actionResponse.success({ email: normalizedEmail });
  } catch (error) {
    console.error('failed to subscribe to newsletter:', error);
    const t = await getTranslations({ locale, namespace: 'Footer.Newsletter' });
    const errorMessage = error instanceof Error ? error.message : t('subscribe.defaultErrorMessage');
    return actionResponse.error(errorMessage);
  }
}

export async function unsubscribeFromNewsletter(token: string, locale = DEFAULT_LOCALE): Promise<ActionResult<{ email: string }>> {
  try {
    await validateRateLimit(locale);
    const t = await getTranslations({ locale, namespace: 'Footer.Newsletter' });

    const email = Buffer.from(token, 'base64').toString();
    const normalizedEmail = normalizeEmail(email);
    const { isValid, error } = validateEmail(normalizedEmail);

    if (!isValid) {
      return actionResponse.error(error || t('unsubscribe.invalidEmail'));
    }

    // Remove user from contacts asynchronously (fire and forget)
    removeContact(normalizedEmail).catch(() => { });

    return actionResponse.success({ email: normalizedEmail });
  } catch (error) {
    console.error('failed to unsubscribe from newsletter:', error);
    const t = await getTranslations({ locale, namespace: 'Footer.Newsletter' });
    const errorMessage = error instanceof Error ? error.message : t('unsubscribe.defaultErrorMessage');
    return actionResponse.error(errorMessage);
  }
}
