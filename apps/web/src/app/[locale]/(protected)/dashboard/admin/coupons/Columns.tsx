/**
 * [INPUT]: Depends on @/actions/coupons/admin for AdminPromotionCodeItem /
 *          PromotionCodeStatus, @/config/pricing for getPlanName, @/lib/format
 *          for formatCents/formatDate, @/components/ui for Badge/Button/Switch/
 *          Progress/Tooltip/DropdownMenu, @tanstack/react-table for ColumnDef
 * [OUTPUT]: Exports columns (coupon table column definitions) and CouponsColumnMeta
 * [POS]: Column definitions of admin/coupons, consumed by DataTable. Every row
 *        action travels through table meta, so the columns keep no state: the
 *        enable switch and the "duplicate" entry are callbacks DataTable injects.
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  type AdminPromotionCodeItem,
  type PromotionCodeStatus,
} from "@/actions/coupons/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getPlanName } from "@/config/pricing";
import { formatCents, formatDate } from "@/lib/format";
import { ColumnDef } from "@tanstack/react-table";
import { Copy, ExternalLink, MoreHorizontal, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

// ──────────────────────────────────────────────
//  Table meta — DataTable injects the row callbacks here
// ──────────────────────────────────────────────

export interface CouponsColumnMeta {
  onToggle?: (item: AdminPromotionCodeItem, active: boolean) => void;
  onDuplicate?: (item: AdminPromotionCodeItem) => void;
  /** Row currently awaiting its enable/disable round trip */
  togglingId?: string | null;
}

// ──────────────────────────────────────────────
//  Badge palettes — one map per axis, no branching at the call site
// ──────────────────────────────────────────────

const STATUS_BADGE_CLASS: Record<PromotionCodeStatus, string> = {
  active:
    "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
  disabled:
    "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400",
  expired: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  exhausted:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

/** Expiry and redemption caps are terminal in Stripe: a code there stays off. */
const TERMINAL_STATUSES: PromotionCodeStatus[] = ["expired", "exhausted"];

// ──────────────────────────────────────────────
//  Cells — rendered through flexRender, so next-intl hooks are legal here
// ──────────────────────────────────────────────

const HeaderText = ({ k }: { k: string }) => {
  const t = useTranslations("Coupons");
  return <>{t(`columns.${k}`)}</>;
};

const CodeCell = ({ item }: { item: AdminPromotionCodeItem }) => {
  const t = useTranslations("Coupons");

  const copy = () => {
    navigator.clipboard.writeText(item.code);
    toast.success(t("toasts.copied", { code: item.code }));
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <code className="font-mono text-sm font-medium tracking-wide">
          {item.code}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          title={t("actions.copyCode")}
          onClick={copy}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        {/* A code wired into config/pricing is live for every visitor — say so
            here, because switching it off changes the public pricing page. */}
        {item.autoApplied && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="gap-1 border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
              >
                <Zap className="h-3 w-3" />
                {t("autoApplied")}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {t("autoAppliedHint")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {item.name && (
        <span className="text-xs text-muted-foreground">{item.name}</span>
      )}
    </div>
  );
};

const DiscountCell = ({ item }: { item: AdminPromotionCodeItem }) => {
  const t = useTranslations("Coupons");
  const locale = useLocale();

  return (
    <span className="font-medium whitespace-nowrap">
      {item.percentOff !== null
        ? t("discountValue.percent", { value: item.percentOff })
        : t("discountValue.amount", {
            value: formatCents(
              item.amountOff ?? 0,
              item.currency ?? "usd",
              locale
            ),
          })}
    </span>
  );
};

/** Scope = which products plus who may redeem; both answer "does this apply to me". */
const ScopeCell = ({ item }: { item: AdminPromotionCodeItem }) => {
  const t = useTranslations("Coupons");
  const locale = useLocale();
  const unrestricted =
    item.appliesToPlanIds.length === 0 &&
    item.appliesToUnknownProducts.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {unrestricted ? (
        <span className="text-muted-foreground">{t("allProducts")}</span>
      ) : (
        <>
          {item.appliesToPlanIds.map((planId) => (
            <Badge key={planId} variant="secondary" className="font-normal">
              {getPlanName(planId, locale)}
            </Badge>
          ))}
          {item.appliesToUnknownProducts.length > 0 && (
            <Badge variant="outline" className="font-normal">
              {t("unknownProducts", {
                count: item.appliesToUnknownProducts.length,
              })}
            </Badge>
          )}
        </>
      )}
      {item.firstTimeOnly && (
        <Badge variant="outline" className="font-normal">
          {t("restrictionFirstTime")}
        </Badge>
      )}
      {item.minimumAmount !== null && (
        <Badge variant="outline" className="font-normal">
          {t("restrictionMinimum", {
            amount: formatCents(
              item.minimumAmount,
              item.currency ?? "usd",
              locale
            ),
          })}
        </Badge>
      )}
    </div>
  );
};

const DurationCell = ({ item }: { item: AdminPromotionCodeItem }) => {
  const t = useTranslations("Coupons");
  return (
    <span className="whitespace-nowrap">
      {item.duration === "repeating"
        ? t("durationValue.repeating", { months: item.durationInMonths ?? 0 })
        : t(`durationValue.${item.duration}`)}
    </span>
  );
};

const RedemptionsCell = ({ item }: { item: AdminPromotionCodeItem }) => {
  const t = useTranslations("Coupons");
  if (item.maxRedemptions === null) {
    return (
      <span className="whitespace-nowrap tabular-nums">
        {item.timesRedeemed}
        <span className="text-muted-foreground"> / {t("unlimited")}</span>
      </span>
    );
  }

  const used = Math.min(item.timesRedeemed, item.maxRedemptions);
  return (
    <div className="flex w-24 flex-col gap-1">
      <span className="tabular-nums">
        {item.timesRedeemed}
        <span className="text-muted-foreground"> / {item.maxRedemptions}</span>
      </span>
      <Progress value={(used / item.maxRedemptions) * 100} className="h-1" />
    </div>
  );
};

const ExpiryCell = ({ item }: { item: AdminPromotionCodeItem }) => {
  const t = useTranslations("Coupons");
  const locale = useLocale();

  if (item.expiresAt === null) {
    return <span className="text-muted-foreground">{t("expiresNever")}</span>;
  }

  const remainingMs = item.expiresAt * 1000 - Date.now();
  return (
    <div className="flex flex-col whitespace-nowrap">
      <span>{formatDate(item.expiresAt * 1000, locale)}</span>
      {remainingMs > 0 && (
        <span className="text-xs text-muted-foreground">
          {t("expiresRelative", {
            days: Math.ceil(remainingMs / 86_400_000),
          })}
        </span>
      )}
    </div>
  );
};

const StatusCell = ({ item }: { item: AdminPromotionCodeItem }) => {
  const t = useTranslations("Coupons");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={STATUS_BADGE_CLASS[item.status]}>
          {t(`status.${item.status}`)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {t(`statusHint.${item.status}`)}
      </TooltipContent>
    </Tooltip>
  );
};

const ActionsCell = ({
  item,
  meta,
}: {
  item: AdminPromotionCodeItem;
  meta?: CouponsColumnMeta;
}) => {
  const t = useTranslations("Coupons");
  // Terminal codes can only be read, never revived — Stripe rejects the update.
  const locked = TERMINAL_STATUSES.includes(item.status);

  return (
    <div className="flex items-center justify-end gap-1">
      <Switch
        checked={item.active && !locked}
        disabled={locked || meta?.togglingId === item.id}
        onCheckedChange={(checked) => meta?.onToggle?.(item, checked)}
        aria-label={t("actions.enabledLabel")}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">{t("actions.menuLabel")}</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t("actions.menuLabel")}</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(item.code);
              toast.success(t("toasts.copied", { code: item.code }));
            }}
          >
            {t("actions.copyCode")}
          </DropdownMenuItem>
          {/* The only way to "edit" a code: Stripe freezes them once created */}
          <DropdownMenuItem onClick={() => meta?.onDuplicate?.(item)}>
            {t("actions.duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={item.dashboardUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              {t("actions.openInStripe")}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

// ──────────────────────────────────────────────
//  Column definitions
// ──────────────────────────────────────────────

export const columns: ColumnDef<AdminPromotionCodeItem>[] = [
  {
    accessorKey: "code",
    header: () => <HeaderText k="code" />,
    size: 240,
    minSize: 200,
    cell: ({ row }) => <CodeCell item={row.original} />,
  },
  {
    accessorKey: "discount",
    header: () => <HeaderText k="discount" />,
    size: 130,
    minSize: 110,
    cell: ({ row }) => <DiscountCell item={row.original} />,
  },
  {
    id: "appliesTo",
    header: () => <HeaderText k="appliesTo" />,
    size: 260,
    minSize: 200,
    cell: ({ row }) => <ScopeCell item={row.original} />,
  },
  {
    accessorKey: "duration",
    header: () => <HeaderText k="duration" />,
    size: 150,
    minSize: 120,
    cell: ({ row }) => <DurationCell item={row.original} />,
  },
  {
    accessorKey: "timesRedeemed",
    header: () => <HeaderText k="redemptions" />,
    size: 130,
    minSize: 110,
    cell: ({ row }) => <RedemptionsCell item={row.original} />,
  },
  {
    accessorKey: "expiresAt",
    header: () => <HeaderText k="expiresAt" />,
    size: 150,
    minSize: 130,
    cell: ({ row }) => <ExpiryCell item={row.original} />,
  },
  {
    accessorKey: "status",
    header: () => <HeaderText k="status" />,
    size: 120,
    minSize: 100,
    cell: ({ row }) => <StatusCell item={row.original} />,
  },
  {
    id: "actions",
    header: () => <HeaderText k="actions" />,
    size: 110,
    minSize: 100,
    maxSize: 120,
    cell: ({ row, table }) => (
      <ActionsCell
        item={row.original}
        meta={table.options.meta as CouponsColumnMeta | undefined}
      />
    ),
  },
];
