/**
 * [INPUT]: Depends on @/lib/billing/stripe's fulfillCheckoutSessionById,
 *          @/lib/billing/creem's fulfillCreemCheckoutById and
 *          @/lib/billing/paypal's fulfillPayPalCaptureById (idempotent
 *          fulfillment, tri-state paid/failed/pending), @/lib/auth/server's
 *          getSession, @/config/pricing's getPlanById/getPlanCopy/
 *          getPlanCredits/isSubscriptionPlan/isTeamPlan, @/i18n/routing's
 *          redirect/DEFAULT_LOCALE (locale-preserving login redirect),
 *          @/lib/metadata's constructMetadata
 * [OUTPUT]: Exports the PaymentSuccessPage server component and generateMetadata
 * [POS]: Landing page for every provider's checkout success_url — Stripe
 *        (session_id), Creem (checkout_id, sent back by Creem) and PayPal
 *        (order_id = capture id); loading the page triggers fulfillment
 *        (belt-and-braces with the webhook); signed-out visitors take the i18n
 *        redirect to /login with next carrying the locale prefix (LoginForm's
 *        absolute redirect must not lose the language); a PayPal pending
 *        capture (eCheck) renders the processing state and re-verifies on
 *        refresh — the user-side self-healing channel when the COMPLETED
 *        webhook is lost; terminal failures (DECLINED/FAILED) render the
 *        failed card, never a misleading "processing"; for Creem only one-time
 *        purchases show instant details, subscriptions keep the async
 *        fulfillment copy; a failed ownership check shows only the generic
 *        success state; on a team plan the success state's second button is
 *        "invite members", going straight to /dashboard/team
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  getPlanById,
  getPlanCopy,
  getPlanCredits,
  isSubscriptionPlan,
  isTeamPlan,
} from "@/config/pricing";
import {
  DEFAULT_LOCALE,
  Link as I18nLink,
  Locale,
  redirect,
} from "@/i18n/routing";
import { getSession } from "@/lib/auth/server";
import { fulfillCreemCheckoutById } from "@/lib/billing/creem";
import { fulfillPayPalCaptureById } from "@/lib/billing/paypal";
import { fulfillCheckoutSessionById } from "@/lib/billing/stripe";
import { constructMetadata } from "@/lib/metadata";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  RefreshCw,
  UserPlus,
  XCircle,
} from "lucide-react";
import { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CreditCard } from "lucide-react";

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<{
  session_id?: string;
  provider?: string;
  checkout_id?: string;
  subscription_id?: string;
  order_id?: string;
}>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "PaymentSuccess" });

  return constructMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    locale: locale as Locale,
    path: "/payment/success",
    noIndex: true,
  });
}

// ----------------------------------------------------------------------------
// Presentation shell — one layout, four states (success/processing/invalid/error)
// ----------------------------------------------------------------------------

function StateCard({
  icon,
  accent,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="relative w-full max-w-md overflow-hidden border-border/50 bg-card p-8 text-center shadow-xl">
      <div className={`absolute top-0 left-0 h-1 w-full ${accent}`} />
      <div className="mb-6 flex justify-center">{icon}</div>
      <h1 className="mb-3 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-balance leading-relaxed text-muted-foreground">
        {description}
      </p>
      {children}
    </Card>
  );
}

function ActionButtons({
  billingLabel,
  secondary,
}: {
  billingLabel: string;
  /** Second button is caller-defined: dashboard by default; a fresh team
   *  subscription swaps it for "invite your team" (next natural step). */
  secondary: { href: string; children: React.ReactNode };
}) {
  return (
    <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row">
      <Button className="flex-1" size="lg" asChild>
        <I18nLink href="/dashboard/billing" prefetch={true}>
          <CreditCard className="size-4" />
          {billingLabel}
        </I18nLink>
      </Button>
      <Button className="flex-1" variant="outline" size="lg" asChild>
        <I18nLink href={secondary.href} prefetch={true}>
          {secondary.children}
        </I18nLink>
      </Button>
    </div>
  );
}

const successIcon = (
  <div className="rounded-full bg-emerald-500/10 p-4 ring-1 ring-emerald-500/20">
    <CheckCircle className="size-14 text-emerald-500" strokeWidth={1.5} />
  </div>
);

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = await searchParams;
  const sessionId = query.session_id;
  const checkoutId = query.checkout_id;
  // PayPal lands with order_id = capture id (see PayPalCheckoutButton).
  const captureId = query.order_id;
  const provider = query.provider ?? (sessionId ? "stripe" : undefined);
  const locale = await getLocale();
  const t = await getTranslations("PaymentSuccess");

  // Fulfillment burns provider API calls — never expose it to anonymous
  // visitors. The buyer is always signed in (checkout requires it).
  const session = await getSession();
  if (!session?.user) {
    // Under the as-needed prefix strategy the URL prefix is the locale's only
    // carrier: /login takes the i18n redirect to keep the language; next is the
    // absolute path LoginForm hands to window.location.assign, so it must carry
    // the prefix itself — otherwise a Japanese user is bounced into the English
    // flow after signing in.
    const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
    redirect({
      href: {
        pathname: "/login",
        query: {
          next: `${prefix}/payment/success?session_id=${sessionId ?? ""}&provider=${provider ?? ""}&checkout_id=${checkoutId ?? ""}&order_id=${captureId ?? ""}`,
        },
      },
      locale,
    });
    return null; // redirect throws — this only satisfies TS narrowing
  }

  const buttons = (
    <ActionButtons
      billingLabel={t("buttons.billing")}
      secondary={{
        href: "/dashboard",
        children: (
          <>
            {t("buttons.dashboard")}
            <ArrowRight className="size-4" />
          </>
        ),
      }}
    />
  );

  // Webhook-fulfilled providers land here: payment confirmed, credits arrive
  // asynchronously — the billing page reflects it moments later.
  const asyncSuccessCard = (
    <StateCard
      icon={successIcon}
      accent="bg-linear-to-r from-green-400 to-emerald-600"
      title={t("success.title")}
      description={t("asyncDescription")}
    >
      {buttons}
    </StateCard>
  );

  let content: React.ReactNode;

  if (
    (provider === "paypal" && !captureId) ||
    (provider === "creem" && !checkoutId)
  ) {
    // No verifiable handle: only the async-fulfillment copy can be shown
    // (the webhook is the source of truth).
    content = asyncSuccessCard;
  } else if (provider !== "creem" && provider !== "paypal" && !sessionId) {
    content = (
      <StateCard
        icon={<XCircle className="size-16 text-red-500" strokeWidth={1.5} />}
        accent="bg-linear-to-r from-red-400 to-rose-600"
        title={t("invalid.title")}
        description={t("invalid.description")}
      >
        {buttons}
      </StateCard>
    );
  } else {
    const isCreem = provider === "creem";
    const isPayPal = provider === "paypal";
    let result: {
      paid: boolean;
      /** PayPal-only third state: the capture is dead (DECLINED/FAILED/…), refreshing is pointless */
      failed?: boolean;
      planId: string | null;
      userId: string | null;
    } | null = null;
    try {
      // Only fulfills when the checkout's metadata.userId matches the
      // signed-in user; foreign ids get a read-only status check.
      result = isCreem
        ? await fulfillCreemCheckoutById(checkoutId!, session.user.id)
        : isPayPal
          ? await fulfillPayPalCaptureById(captureId!, session.user.id)
          : await fulfillCheckoutSessionById(sessionId!, session.user.id);
    } catch (error) {
      console.error("Payment success fulfillment failed:", error);
    }

    // Details are only shown when the checkout verifiably belongs to the
    // signed-in user; otherwise fall back to a generic success message.
    const isOwner = Boolean(
      result?.userId && result.userId === session.user.id
    );
    const plan =
      isOwner && result?.paid && result.planId
        ? getPlanById(result.planId)
        : undefined;

    if (
      isCreem &&
      (!result || (result.paid && !(plan && !isSubscriptionPlan(plan))))
    ) {
      // Creem: only a verified one-time purchase renders instant details.
      // Subscriptions (credits arrive via subscription.paid) and checkouts we
      // could not verify keep the async-fulfillment message — the webhook
      // remains the source of truth.
      content = asyncSuccessCard;
    } else if (isPayPal && !result) {
      // PayPal: a lookup failure is not a payment failure — the user only
      // lands here after a successful capture call. Keep the async message;
      // the webhook remains the source of truth.
      content = asyncSuccessCard;
    } else if (!result) {
      content = (
        <StateCard
          icon={<XCircle className="size-16 text-red-500" strokeWidth={1.5} />}
          accent="bg-linear-to-r from-red-400 to-rose-600"
          title={t("error.title")}
          description={t("error.description")}
        >
          {buttons}
        </StateCard>
      );
    } else if (!result.paid && result.failed) {
      // Terminal failure (eCheck bounce, risk decline): no credits, refreshing
      // is pointless — say so plainly, never render a dead payment as
      // "processing" forever.
      content = (
        <StateCard
          icon={<XCircle className="size-16 text-red-500" strokeWidth={1.5} />}
          accent="bg-linear-to-r from-red-400 to-rose-600"
          title={t("failed.title")}
          description={t("failed.description")}
        >
          {buttons}
        </StateCard>
      );
    } else if (!result.paid) {
      content = (
        <StateCard
          icon={<Clock className="size-16 text-amber-500" strokeWidth={1.5} />}
          accent="bg-linear-to-r from-yellow-400 to-amber-600"
          title={t("processing.title")}
          description={t("processing.description")}
        >
          <p className="mt-4 text-sm text-muted-foreground">
            {t("processing.refreshHint")}
          </p>
          <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row">
            <Button className="flex-1" size="lg" asChild>
              {/* Plain anchor forces a full server re-render → re-checks the provider */}
              <a
                href={
                  isCreem
                    ? `?provider=creem&checkout_id=${encodeURIComponent(checkoutId!)}`
                    : isPayPal
                      ? `?provider=paypal&order_id=${encodeURIComponent(captureId!)}`
                      : `?session_id=${encodeURIComponent(sessionId!)}`
                }
              >
                <RefreshCw className="size-4" />
                {t("buttons.refresh")}
              </a>
            </Button>
            <Button className="flex-1" variant="outline" size="lg" asChild>
              <I18nLink href="/dashboard/billing" prefetch={true}>
                {t("buttons.billing")}
              </I18nLink>
            </Button>
          </div>
        </StateCard>
      );
    } else {
      const planName = plan ? getPlanCopy(plan, locale).name : undefined;

      // A team plan was just activated — the next natural step is bringing
      // people in, so the second button becomes "invite your team".
      const successButtons =
        plan && isTeamPlan(plan) ? (
          <ActionButtons
            billingLabel={t("buttons.billing")}
            secondary={{
              href: "/dashboard/team",
              children: (
                <>
                  <UserPlus className="size-4" />
                  {t("buttons.inviteTeam")}
                </>
              ),
            }}
          />
        ) : (
          buttons
        );

      content = (
        <StateCard
          icon={successIcon}
          accent="bg-linear-to-r from-green-400 to-emerald-600"
          title={t("success.title")}
          description={t("success.description")}
        >
          {plan && (
            <div className="mt-6 overflow-hidden rounded-xl border border-border/50 bg-muted/40 text-left text-sm">
              <div className="border-b border-border/50 bg-muted/60 px-4 py-2.5 font-medium">
                {t("details.title")}
              </div>
              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t("details.plan")}
                  </span>
                  <span className="font-semibold">{planName}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t("details.credits")}
                  </span>
                  <span className="font-semibold text-primary">
                    {isSubscriptionPlan(plan)
                      ? t("details.creditsPerMonth", {
                          credits: getPlanCredits(plan),
                        })
                      : t("details.creditsValue", {
                          credits: getPlanCredits(plan),
                        })}
                  </span>
                </div>
              </div>
            </div>
          )}
          {successButtons}
        </StateCard>
      );
    }
  }

  return (
    <main className="container mx-auto max-w-4xl">
      <div className="flex min-h-[80vh] w-full items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        {content}
      </div>
    </main>
  );
}
