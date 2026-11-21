/**
 * [INPUT]: Depends on @/actions/credits' getMyCredits (active workspace
 *          balance: a team workspace = the organization's shared pool), swr's
 *          useSWR, @/lib/format's formatNumber, @/i18n/routing's
 *          Link/useRouter, @/lib/auth/auth-client's signOut, the --credit
 *          coin-gold tokens from styles/globals.css
 * [OUTPUT]: Exports the SidebarUserCard component (credit balance + user menu
 *           in one card)
 * [POS]: The dashboard sidebar footer of components/layout — upper half is the
 *        credits card (balance as a gold coin badge / composition bar + legend
 *        / upgrade or credit-pack CTA), lower half is the user menu (name/mail +
 *        sign-out dropdown) anchored at the bottom; in collapsed state it
 *        degrades to a Coins icon button (balance shown in the tooltip) +
 *        avatar
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { getMyCredits } from "@/actions/credits";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { PRICING_PATH } from "@/config/public-paths";
import { Link as I18nLink, useRouter } from "@/i18n/routing";
import { authClient } from "@/lib/auth/auth-client";
import { user as userSchema } from "@/lib/db/schema";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, Coins, LogOutIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";

type User = typeof userSchema.$inferSelect;

/**
 * Below this total the CTA gets emphasis. The balance itself never changes
 * color: coin gold means "this number is credits", not "something is wrong".
 */
const LOW_BALANCE_THRESHOLD = 50;

export function SidebarUserCard({ user }: { user: User }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Billing");
  const tLogin = useTranslations("Login");
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed";

  const { data: credits, isLoading } = useSWR("my-credits", async () => {
    const result = await getMyCredits();
    return result.success ? (result.data ?? null) : null;
  });

  if (!user) {
    return null;
  }

  const fallbackLetter = user.email?.[0]?.toUpperCase() || "U";

  const signOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.refresh();
        },
      },
    });
  };

  const dropdownContent = (
    <DropdownMenuContent
      className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
      side={isMobile ? "bottom" : "top"}
      align="end"
      sideOffset={4}
    >
      <DropdownMenuLabel className="p-0 font-normal">
        <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
          <Avatar className="h-8 w-8 rounded-lg">
            <AvatarImage src={user.image || undefined} />
            <AvatarFallback className="rounded-lg">{fallbackLetter}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{user.name || "User"}</span>
            <span className="text-muted-foreground truncate text-xs">{user.email}</span>
          </div>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={() => signOut()}
        className="cursor-pointer text-red-600 dark:text-red-400"
      >
        <LogOutIcon className="mr-2 h-4 w-4" />
        {tLogin("Button.signOut")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  const avatar = (
    <Avatar className="h-8 w-8 rounded-lg">
      <AvatarImage src={user.image || undefined} />
      <AvatarFallback className="rounded-lg">{fallbackLetter}</AvatarFallback>
    </Avatar>
  );

  // Collapsed (icon) mode: credits icon button with tooltip + avatar menu.
  if (isCollapsed) {
    return (
      <SidebarMenu>
        {credits && (
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={t("sidebar.creditsTooltip", {
                credits: formatNumber(credits.totalCredits, locale),
              })}
            >
              <I18nLink href="/dashboard/billing" title={t("balance.title")}>
                <Coins className="text-credit-foreground size-4" />
              </I18nLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                {avatar}
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user.name || "User"}</span>
                  <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            {dropdownContent}
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const total = credits?.totalCredits ?? 0;
  const isLow = !!credits && total <= LOW_BALANCE_THRESHOLD;
  // Heuristic: a positive subscription bucket implies an active subscription —
  // subscribers get the top-up CTA, everyone else gets the upgrade CTA.
  const hasSubscription = (credits?.subscriptionCredits ?? 0) > 0;
  // The bar shows composition (subscription vs. pack), not fill level.
  const subscriptionPct = total > 0 ? ((credits?.subscriptionCredits ?? 0) / total) * 100 : 0;

  return (
    <div className="border-sidebar-border from-primary/10 overflow-hidden rounded-xl border bg-gradient-to-b to-transparent">
      {/* ── Credits ── */}
      <div className="px-3 pt-2.5 pb-3">
        {isLoading ? (
          <div className="space-y-2.5">
            <div className="bg-muted h-3.5 w-24 animate-pulse rounded" />
            <div className="bg-muted h-7 w-24 animate-pulse rounded-full" />
            <div className="bg-muted h-1.5 w-full animate-pulse rounded-full" />
            <div className="bg-muted h-3 w-32 animate-pulse rounded" />
          </div>
        ) : credits ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground truncate text-xs font-medium">
                {t("balance.title")}
              </span>
              <I18nLink
                href={PRICING_PATH}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors",
                  isLow || !hasSubscription
                    ? "text-primary hover:bg-primary/10"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                )}
              >
                {hasSubscription ? t("sidebar.buyPack") : t("sidebar.upgrade")}
              </I18nLink>
            </div>

            <I18nLink
              href="/dashboard/billing"
              title={t("balance.title")}
              className="mt-1.5 block rounded-md transition-opacity hover:opacity-80"
            >
              {/* Coin badge. One class set, two themes: the --credit tokens swap
                  roles (light = gold fill + bronze ink, dark = gold ink on a
                  wash), so no dark: branch is needed here. */}
              <p className="border-credit-border bg-credit text-credit-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 leading-none tracking-tight tabular-nums">
                <Coins className="size-4 shrink-0" />
                {formatNumber(total, locale)}
              </p>

              {/* Composition bar: solid = subscription, translucent = pack */}
              <div className="bg-muted mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full">
                {total > 0 && (
                  <>
                    <div
                      className="bg-primary transition-[width] duration-500"
                      style={{ width: `${subscriptionPct}%` }}
                    />
                    <div
                      className="bg-primary/40 transition-[width] duration-500"
                      style={{ width: `${100 - subscriptionPct}%` }}
                    />
                  </>
                )}
              </div>

              {/* Legend: dots map 1:1 onto the bar segments above */}
              <div className="text-muted-foreground mt-2 flex items-center gap-3 text-[11px] leading-none">
                <span className="flex items-center gap-1.5">
                  <span className="bg-primary size-1.5 shrink-0 rounded-full" />
                  {t("sidebar.subscriptionShort")}
                  <span className="text-foreground font-medium tabular-nums">
                    {formatNumber(credits.subscriptionCredits, locale)}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="bg-primary/40 size-1.5 shrink-0 rounded-full" />
                  {t("sidebar.packShort")}
                  <span className="text-foreground font-medium tabular-nums">
                    {formatNumber(credits.purchasedCredits, locale)}
                  </span>
                </span>
              </div>
            </I18nLink>
          </>
        ) : null}
      </div>

      {/* ── User ── */}
      <div className="border-sidebar-border border-t p-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors"
            >
              {avatar}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name || "User"}</span>
                <span className="text-muted-foreground truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          {dropdownContent}
        </DropdownMenu>
      </div>
    </div>
  );
}
