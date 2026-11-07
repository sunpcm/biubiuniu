/**
 * [INPUT]: Depends on @/lib/auth/auth-client's authClient (self-checks
 *          session.impersonatedBy), @/actions/users/impersonation's
 *          stopImpersonation, @/i18n/routing's DEFAULT_LOCALE (locale prefix
 *          for the return hop), @/components/ui/button and sonner's toast
 * [OUTPUT]: Exports ImpersonationBanner — the always-on notice for a borrowed
 *           session plus its Exit control
 * [POS]: A global auth-behaviour component of components/auth, mounted in the
 *        root layout next to GoogleOneTap; renders null when the session is
 *        not borrowed, so ordinary visitors pay nothing
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { stopImpersonation } from "@/actions/users/impersonation";
import { Button } from "@/components/ui/button";
import { DEFAULT_LOCALE } from "@/i18n/routing";
import { authClient } from "@/lib/auth/auth-client";
import { Loader2, VenetianMask } from "lucide-react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

/**
 * The only visual anchor of a borrowed session. The criterion is the session's
 * own impersonatedBy column — better-auth issues the borrowed session directly,
 * and nothing else on the page distinguishes it from a real login. An admin who
 * forgets whose account they are in and clicks "buy" spends real money, so this
 * notice is page-independent and always on, not something bolted to the admin
 * area alone.
 *
 * The self-check runs on the client: the root layout never reads the session,
 * which is what keeps marketing pages statically rendered.
 */
export function ImpersonationBanner() {
  const { data: session } = authClient.useSession();
  const locale = useLocale();
  const [exiting, setExiting] = useState(false);

  const impersonatedBy = session?.session?.impersonatedBy;
  if (!impersonatedBy) return null;

  const handleExit = async () => {
    setExiting(true);
    const result = await stopImpersonation();
    if (!result.success) {
      setExiting(false);
      toast.error("Failed to exit impersonation", {
        description: result.error,
      });
      return;
    }
    // A full page load, not router.refresh: the session cookie has just been
    // swapped back to the admin's own, so every client cache entry fetched
    // under the borrowed identity must die with it.
    const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
    window.location.assign(`${prefix}/dashboard/admin/users`);
  };

  return (
    <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/10 py-2 pl-3 pr-2 text-sm shadow-lg backdrop-blur">
      <VenetianMask className="h-4 w-4 shrink-0 text-amber-500" />
      <span className="max-w-[40vw] truncate text-amber-700 dark:text-amber-200">
        Viewing as{" "}
        <span className="font-medium">
          {session?.user?.email || session?.user?.id}
        </span>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 rounded-full border-amber-500/50 px-3 text-xs hover:bg-amber-500/20"
        disabled={exiting}
        onClick={handleExit}
      >
        {exiting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Exit"}
      </Button>
    </div>
  );
}
