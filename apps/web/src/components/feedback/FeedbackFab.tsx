/**
 * [INPUT]: Depends on @/components/ui/button, @/components/ui/tooltip,
 *          @/i18n/routing for usePathname, lucide-react for icons
 * [OUTPUT]: Exports FeedbackFab component
 * [POS]: Floating action button for opening feedback dialog,
 *        hidden on /dashboard and /login paths, mounted in root layout
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { useEffect, useState } from "react";

import { MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePathname } from "@/i18n/routing";

import { useFeedback } from "./FeedbackProvider";

// ============================================================
// Config
// ============================================================

const HIDDEN_PATHS = ["/dashboard", "/login"];

// ============================================================
// Component
// ============================================================

export function FeedbackFab() {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const { openDialog } = useFeedback();
  const t = useTranslations("Feedback");

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return null;

  return (
    <div className="fixed bottom-40 right-6 z-50">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            className="h-[54px] w-[54px] rounded-full"
            onClick={openDialog}
          >
            <MessageSquarePlus className="h-6 w-6" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>{t("button.newFeedback")}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
