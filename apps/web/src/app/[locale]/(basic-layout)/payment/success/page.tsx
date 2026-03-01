"use client";

import { Button } from "@niu/ui/button";
import { Card } from "@niu/ui/card";
import { useUserBenefits } from "@/hooks/useUserBenefits";
import { DEFAULT_LOCALE, Link as I18nLink, useRouter } from "@/i18n/routing";
import confetti from "canvas-confetti";
import { motion, Variants } from "framer-motion";
import {
  ArrowRight,
  CheckCircle,
  CreditCard,
  Home,
  Loader2,
  Receipt,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const buildVerifySuccessUrl = ({
  sessionId,
  checkoutId,
  provider,
}: {
  sessionId: string;
  checkoutId: string;
  provider: string;
}) => {
  const baseUrl = "/api/payment/verify-success";

  const params = new URLSearchParams();

  if (provider === "stripe") {
    params.append("session_id", sessionId);
  } else if (provider === "creem") {
    params.append("checkout_id", checkoutId);
  }
  params.append("provider", provider);

  return `${baseUrl}?${params.toString()}`;
};

function SuccessContent() {
  const locale = useLocale();
  const router = useRouter();
  const { mutate: revalidateBenefits } = useUserBenefits();
  const searchParams = useSearchParams();

  const sessionId = searchParams.get("session_id");
  const checkoutId = searchParams.get("checkout_id");
  const provider = searchParams.get("provider");

  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [paymentData, setPaymentData] = useState<{
    message: string;
    orderId?: string;
    subscriptionId?: string;
    planName?: string;
  }>({
    message: "Verifying your payment details...",
  });

  useEffect(() => {
    if (provider === "stripe" && !sessionId) {
      setStatus("error");
      setPaymentData({
        message: "Checkout session ID missing. Payment cannot be verified.",
      });
      return;
    }
    if (provider === "creem" && !checkoutId) {
      setStatus("error");
      setPaymentData({
        message: "Checkout ID missing. Payment cannot be verified.",
      });
      return;
    }

    const verifySession = async () => {
      try {
        const url = buildVerifySuccessUrl({
          sessionId: sessionId ?? "",
          checkoutId: checkoutId ?? "",
          provider: provider ?? "",
        });
        const response = await fetch(url, {
          headers: {
            "Accept-Language": (locale || DEFAULT_LOCALE) as string,
          },
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Verification failed.");
        }

        if (!result.success) {
          throw new Error(result.error || "Verification failed.");
        }

        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
          colors: ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444"],
        });

        setStatus("success");
        setPaymentData({
          message:
            result.data.message || "Your payment has been confirmed. Your plan has been updated.",
          orderId: result.data.orderId,
          subscriptionId: result.data.subscriptionId,
          planName: result.data.planName,
        });
        revalidateBenefits();
      } catch (error) {
        setStatus("error");
        setPaymentData({
          message:
            error instanceof Error ? error.message : "An error occurred during verification.",
        });
      }
    };

    verifySession();
  }, [sessionId, checkoutId, provider, locale, revalidateBenefits]);

  const fadeIn: Variants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: "easeOut" },
    },
  };

  const containerVariants: Variants = {
    hidden: { opacity: 0, scale: 0.98 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.2,
        duration: 0.4,
      },
    },
  };

  const renderVerifying = () => (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md"
    >
      <Card className="border-border/50 bg-background/60 flex flex-col items-center justify-center space-y-6 p-10 text-center shadow-xl backdrop-blur-xl">
        <div className="relative">
          <Loader2 className="text-primary relative z-10 h-16 w-16 animate-spin" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Verifying Payment</h1>
          <p className="text-muted-foreground mx-auto max-w-xs text-balance">
            {paymentData.message}
          </p>
        </div>
      </Card>
    </motion.div>
  );

  const renderSuccess = () => (
    <motion.div
      className="relative w-full max-w-md"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Background decoration */}
      <Card className="border-border/50 bg-background/80 relative flex flex-col items-center overflow-hidden p-8 text-center shadow-xl backdrop-blur-xl">
        <div className="absolute top-0 left-0 h-1 w-full bg-linear-to-r from-green-400 to-emerald-600" />

        <motion.div variants={fadeIn} className="mt-2 mb-6">
          <div className="group relative cursor-default">
            <div className="absolute inset-0 scale-150 rounded-full bg-green-500/20 blur-2xl transition-transform duration-700 ease-out group-hover:scale-175"></div>
            <div className="dark:to-background relative rounded-full bg-linear-to-b from-green-50 to-white p-4 shadow-sm ring-1 ring-green-100 dark:from-green-950/30 dark:ring-green-900">
              <CheckCircle className="h-16 w-16 text-green-500" strokeWidth={1.5} />
            </div>
          </div>
        </motion.div>

        <motion.h1 variants={fadeIn} className="mb-3 text-3xl font-bold tracking-tight">
          Payment Successful!
        </motion.h1>

        <motion.p
          variants={fadeIn}
          className="text-muted-foreground mb-8 text-center leading-relaxed text-balance"
        >
          {paymentData.message}
        </motion.p>

        <motion.div variants={fadeIn} className="mb-8 w-full">
          <div className="bg-muted/40 border-border/50 overflow-hidden rounded-xl border">
            <div className="bg-muted/60 border-border/50 text-foreground/80 flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
              <Receipt className="text-muted-foreground h-4 w-4" />
              <span>Transaction Details</span>
            </div>
            <div className="space-y-3.5 p-4 text-sm">
              {paymentData.orderId && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Order ID</span>
                  <span className="text-foreground bg-background border-border/50 rounded border px-2 py-0.5 font-mono text-xs font-medium">
                    {paymentData.orderId}
                  </span>
                </div>
              )}
              {paymentData.subscriptionId && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Subscription</span>
                  <span
                    className="text-foreground bg-background border-border/50 max-w-[150px] truncate rounded border px-2 py-0.5 font-mono text-xs font-medium"
                    title={paymentData.subscriptionId}
                  >
                    {paymentData.subscriptionId}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-muted-foreground">Plan Purchased</span>
                <span className="text-primary flex items-center gap-1.5 font-bold">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {paymentData.planName || "Premium Plan"}
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div variants={fadeIn} className="flex w-full flex-col gap-3 sm:flex-row">
          <Button className="flex-1 shadow-md transition-all hover:shadow-lg" asChild size="lg">
            <I18nLink href="/" title="Back to Home" prefetch={true}>
              <Home className="h-4 w-4" />
              <span>Back to Home</span>
            </I18nLink>
          </Button>
          <Button className="flex-1" asChild variant="outline" size="lg">
            <I18nLink href="/dashboard" title="Go to Dashboard" prefetch={true}>
              <span>Dashboard</span>
              <ArrowRight className="ml-1 h-4 w-4" />
            </I18nLink>
          </Button>
        </motion.div>
      </Card>
    </motion.div>
  );

  const renderError = () => (
    <motion.div
      className="w-full max-w-md"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <Card className="bg-background/80 relative flex flex-col items-center overflow-hidden border-red-100 p-8 text-center shadow-xl backdrop-blur-xl dark:border-red-900/30">
        <div className="absolute top-0 left-0 h-1 w-full bg-linear-to-r from-red-400 to-rose-600" />

        <motion.div variants={fadeIn} className="mt-2 mb-6">
          <div className="relative">
            <div className="absolute inset-0 scale-150 rounded-full bg-red-100 opacity-50 dark:bg-red-900/20"></div>
            <div className="relative rounded-full bg-red-50 p-4 ring-1 ring-red-100 dark:bg-red-950/30 dark:ring-red-900">
              <XCircle className="h-16 w-16 text-red-500" strokeWidth={1.5} />
            </div>
          </div>
        </motion.div>

        <motion.h1 variants={fadeIn} className="mb-3 text-2xl font-bold tracking-tight">
          Verification Failed
        </motion.h1>
        <motion.p
          variants={fadeIn}
          className="text-muted-foreground mx-auto mb-8 max-w-xs text-center text-balance"
        >
          {paymentData.message}
        </motion.p>

        <motion.div variants={fadeIn} className="flex w-full flex-col gap-3 sm:flex-row">
          <Button variant="outline" className="flex-1" asChild>
            <I18nLink href="/" title="Back to Home" prefetch={true}>
              <CreditCard className="h-4 w-4" /> Back to Home
            </I18nLink>
          </Button>
          <Button
            className="flex-1 bg-red-600 text-white hover:bg-red-700"
            onClick={() => router.refresh()}
          >
            <RefreshCw className="h-4 w-4" /> Try Again
          </Button>
        </motion.div>
      </Card>
    </motion.div>
  );

  return (
    <div className="flex min-h-[80vh] w-full flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      {status === "verifying" && renderVerifying()}
      {status === "success" && renderSuccess()}
      {status === "error" && renderError()}
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <main className="container mx-auto max-w-4xl">
      <Suspense
        fallback={
          <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 text-center">
            <Loader2 className="text-primary mb-4 h-12 w-12 animate-spin" />
            <h1 className="text-muted-foreground text-xl font-medium">Loading Payment Status...</h1>
          </div>
        }
      >
        <SuccessContent />
      </Suspense>
    </main>
  );
}
