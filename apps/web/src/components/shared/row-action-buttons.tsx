/**
 * [INPUT]: Depends on @/components/ui/button's Button, @/components/ui/tooltip's
 *          Tooltip trio, @/components/ui/dropdown-menu's menu quartet (the
 *          overflow cluster), @/i18n/routing's Link (href actions), @/lib/utils'
 *          cn, lucide-react's LucideIcon type plus Loader2 / MoreHorizontal
 * [OUTPUT]: Exports RowActionButtons (the row-action icon button group), the
 *           RowAction type and ROW_ACTION_TONES (the tone colour table, read-only)
 * [POS]: The single source of truth for table row actions in components/shared,
 *        same layer as pinned-column / sortable-header / table-elements; the
 *        rules live in TABLE_DESIGN_STANDARDS.md section 7 Row Actions
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link as I18nLink } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { Loader2, MoreHorizontal, type LucideIcon } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Tone colour table                                                          */
/*                                                                            */
/*  Idle state is always muted-foreground; colour appears on hover only. A    */
/*  screen of 20 rows x 5 coloured buttons is 100 colour blobs, which is      */
/*  noise, not design. Colour belongs to the one button the pointer is on.    */
/*  The positive green matches the "active" status badge: what hover shows is */
/*  the colour the badge turns into after the click, a cause-effect hint.     */
/* -------------------------------------------------------------------------- */

export const ROW_ACTION_TONES = {
  neutral: "hover:bg-muted hover:text-foreground",
  positive: "hover:bg-emerald-500/10 hover:text-emerald-500",
  destructive: "hover:bg-destructive/10 hover:text-destructive",
} as const;

export type RowActionTone = keyof typeof ROW_ACTION_TONES;

interface RowActionBase {
  /** React key + debug id; use the action's semantic name (edit/duplicate/...) */
  key: string;
  icon: LucideIcon;
  /** Tooltip text + aria-label: an icon button without a readable name is a blank sheet for screen-reader users */
  label: string;
  /** Defaults to neutral; destructive is automatically moved past the divider */
  tone?: RowActionTone;
  /** State-machine gating: visible by default, false renders nothing (no conditional spreads at the call site) */
  visible?: boolean;
  /** Visible but unavailable right now (e.g. an already refunded order); OR'd with the group's disabled */
  disabled?: boolean;
  /** In flight: the icon becomes a spinner and the button is disabled */
  loading?: boolean;
  /** Move into the "..." overflow menu, for the long tail once a row carries more than ~6 actions */
  overflow?: boolean;
  /** href actions only: turn off prefetch (heavy editor pages; prefetching 20 rows is pure waste) */
  prefetch?: boolean;
}

/** An action either runs in place or navigates, never both (the union blocks "both given" at the type level) */
export type RowAction = RowActionBase &
  ({ onClick: () => void; href?: never } | { href: string; onClick?: never });

/* -------------------------------------------------------------------------- */
/*  Single icon button                                                         */
/* -------------------------------------------------------------------------- */

function RowActionButton({
  action,
  disabled,
}: {
  action: RowAction;
  disabled: boolean;
}) {
  const Icon = action.loading ? Loader2 : action.icon;
  const isDisabled = disabled || action.disabled || action.loading === true;
  const className = cn(
    "size-8 rounded-md text-muted-foreground transition-colors",
    ROW_ACTION_TONES[action.tone ?? "neutral"]
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {action.href ? (
          <Button variant="ghost" size="icon" asChild className={className}>
            <I18nLink
              href={action.href}
              aria-label={action.label}
              prefetch={action.prefetch}
            >
              <Icon className="size-4" />
            </I18nLink>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={action.label}
            disabled={isDisabled}
            onClick={action.onClick}
            className={className}
          >
            <Icon className={cn("size-4", action.loading && "animate-spin")} />
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{action.label}</TooltipContent>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------------- */
/*  "..." overflow menu (long tail)                                            */
/* -------------------------------------------------------------------------- */

function RowActionOverflow({
  actions,
  disabled,
}: {
  actions: RowAction[];
  disabled: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="More actions"
          disabled={disabled}
          className={cn(
            "size-8 rounded-md text-muted-foreground transition-colors",
            ROW_ACTION_TONES.neutral
          )}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => {
          const Icon = action.icon;
          const variant =
            action.tone === "destructive" ? "destructive" : "default";
          // Inside the menu the icon carries text and the tone rides on the
          // variant, not a hover colour: a menu highlights one item at a time,
          // so the "100 colour blobs" problem does not apply here
          const content = (
            <>
              <Icon className="size-4" />
              {action.label}
            </>
          );
          return action.href ? (
            <DropdownMenuItem key={action.key} variant={variant} asChild>
              <I18nLink href={action.href} prefetch={action.prefetch}>
                {content}
              </I18nLink>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={action.key}
              variant={variant}
              disabled={action.disabled || action.loading}
              onClick={action.onClick}
            >
              {content}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/*  Row action button group                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The one shape for table row actions: icon + tooltip, reversible actions in
 * one cluster and irreversible ones (tone=destructive) in a second cluster
 * behind a hairline divider. Grouping by the cost of a misclick beats even
 * spacing at preventing slips.
 *
 * Layout: [everyday actions] [... overflow] | [irreversible actions]
 * The "..." belongs to the everyday cluster (it means "more everyday
 * actions"), so the divider guards only what cannot be undone.
 *
 * Clustering is derived here from tone / overflow; callers declare one flat
 * array. The rule lives in one place, so it cannot drift on the Nth table.
 */
export function RowActionButtons({
  actions,
  disabled = false,
  className,
}: {
  actions: RowAction[];
  /** Usually useTransition's isPending */
  disabled?: boolean;
  className?: string;
}) {
  const visible = actions.filter((action) => action.visible !== false);
  const inline = visible.filter((action) => !action.overflow);
  const overflow = visible.filter((action) => action.overflow);
  const safe = inline.filter((action) => action.tone !== "destructive");
  const risky = inline.filter((action) => action.tone === "destructive");

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {safe.map((action) => (
        <RowActionButton key={action.key} action={action} disabled={disabled} />
      ))}

      {overflow.length > 0 && (
        <RowActionOverflow actions={overflow} disabled={disabled} />
      )}

      {/* Only two non-empty clusters need a boundary; with one cluster the divider is decoration */}
      {safe.length + overflow.length > 0 && risky.length > 0 && (
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
      )}

      {risky.map((action) => (
        <RowActionButton key={action.key} action={action} disabled={disabled} />
      ))}
    </div>
  );
}
