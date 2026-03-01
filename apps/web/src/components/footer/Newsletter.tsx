"use client";

import { subscribeToNewsletter } from "@/actions/newsletter";
import { normalizeEmail, validateEmail } from "@/lib/email";
import { cn } from "@niu/utils";
import { Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

export function Newsletter() {
  const t = useTranslations("Footer.Newsletter");
  const currentLocale = useLocale();

  const [email, setEmail] = useState("");
  const [subscribeStatus, setSubscribeStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    const normalizedEmailAddress = normalizeEmail(email);
    const { isValid, error: validationError } = validateEmail(normalizedEmailAddress);

    if (!isValid) {
      setSubscribeStatus("error");
      setErrorMessage(validationError || t("subscribe.invalidEmail"));
      setTimeout(() => setSubscribeStatus("idle"), 5000);
      return;
    }

    try {
      setSubscribeStatus("loading");

      const result = await subscribeToNewsletter(normalizedEmailAddress, currentLocale);

      if (!result.success) {
        throw new Error(result.error || t("subscribe.defaultErrorMessage"));
      }

      setSubscribeStatus("success");
      setEmail("");
      setErrorMessage("");
    } catch (error) {
      setSubscribeStatus("error");
      setErrorMessage(error instanceof Error ? error.message : t("subscribe.defaultErrorMessage"));
    } finally {
      setTimeout(() => setSubscribeStatus("idle"), 5000);
    }
  };
  return (
    <div className="">
      <div className="mb-3 font-semibold">{t("title")}</div>
      <p className="mb-3 text-sm">{t("description")}</p>
      <form onSubmit={handleSubscribe} className="flex max-w-64 flex-col gap-2">
        <div className="flex">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            className="focus:ring-primary w-full rounded-l-lg bg-gray-800 px-4 py-2 text-white focus:ring-1 focus:outline-hidden"
            disabled={subscribeStatus === "loading"}
          />
          <button
            type="submit"
            disabled={subscribeStatus === "loading"}
            className={cn(
              "bg-primary hover:bg-primary/90 rounded-r-lg px-4 py-2",
              subscribeStatus === "loading",
            )}
            aria-label="Subscribe to newsletter"
          >
            <Send className="h-3.5 w-3.5 text-white" />
          </button>
        </div>
        {subscribeStatus === "success" && (
          <p className="mt-1 text-xs text-green-600">{t("subscribe.successMessage")}</p>
        )}
        {subscribeStatus === "error" && <p className="mt-1 text-xs text-red-600">{errorMessage}</p>}
      </form>
    </div>
  );
}
