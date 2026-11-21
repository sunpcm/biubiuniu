/**
 * [INPUT]: Depends on @/actions/users/admin for banUser/unbanUser/updateUserRole/
 *          deleteUserAccount/UserWithSource,
 *          @/actions/users/impersonation for startImpersonation (superadmin
 *          borrows a user's session),
 *          ./AdjustCreditsDialog for the credit-adjustment dialog,
 *          ./use-user-row-action for useUserRowAction (optimistic row updates)
 *          and useRefreshUsersTable (silent refresh when no patch applies),
 *          @/components/shared/row-action-buttons for RowActionButtons,
 *          @/lib/format for formatCents + @/config/common for DEFAULT_CURRENCY
 *          (the Total Spent column), @/lib/auth for the session and role checks,
 *          @/i18n/routing for Link
 *          (navigates to the user detail page), next-intl for useTranslations,
 *          @/components/ui for the table widgets
 * [OUTPUT]: exports columns (user table column definitions: User (name + role
 *          tag + destructive Banned badge)/Credits/Total Spent (lifetime net
 *          spend from orders in the primary currency, other currencies in the
 *          Tooltip)/last active + signup time
 *          (highlighted when the last-active day is later than the signup day,
 *          i.e. retained)/Stripe ID/UTM (referrer merged into the Tooltip)/
 *          Country (country / language)/IP (signup IP captured by userSource,
 *          click to copy)/Browser/OS/Device/Aff Code; plus row actions for
 *          detail navigation, credit adjustment, copy id, role, impersonation,
 *          ban and account deletion)
 * [POS]: The column definitions of admin/users, consumed by DataTable. Row
 *        actions use RowActionButtons in the hybrid "two everyday icons inline
 *        + ... overflow" shape (role / impersonate / delete are superadmin-only,
 *        ban is high-risk; the long tail and the risky items live in the
 *        overflow menu, see TABLE_DESIGN_STANDARDS.md section 7). Dialogs own
 *        their state and submit through useUserRowAction: the row is patched
 *        optimistically, the server action runs in the background and a
 *        failure rolls the row back (router.refresh() never reaches React
 *        Query data). Both the user name and View details link to the [userId]
 *        detail page; a banned account shows a destructive Banned badge next
 *        to the name (i18n: Users.detail.profile.banned)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  banUser,
  deleteUserAccount,
  unbanUser,
  updateUserRole,
  UserWithSource,
} from "@/actions/users/admin";
import { startImpersonation } from "@/actions/users/impersonation";
import {
  RowActionButtons,
  type RowAction,
} from "@/components/shared/row-action-buttons";
import { SortableHeader } from "@/components/shared/sortable-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DEFAULT_CURRENCY } from "@/config/common";
import { DEFAULT_LOCALE, Link as I18nLink } from "@/i18n/routing";
import { authClient } from "@/lib/auth/auth-client";
import { isAdminUserRole, isSuperAdminUserRole } from "@/lib/auth/permissions";
import { formatCents } from "@/lib/format";
import { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import {
  Ban,
  ClipboardCopy,
  Coins,
  Eye,
  Loader2,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
  VenetianMask,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AdjustCreditsDialog } from "./AdjustCreditsDialog";
import { useRefreshUsersTable, useUserRowAction } from "./use-user-row-action";

type UserType = UserWithSource;

const BanUserDialog = ({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserType;
}) => {
  const runRowAction = useUserRowAction();
  const [banReason, setBanReason] = useState("");
  const close = () => {
    setBanReason("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setBanReason("");
        }
        onOpenChange(isOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban user</DialogTitle>
          <DialogDescription>
            This will immediately ban {user.email || user.id}. You can provide
            an optional reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`ban-reason-${user.id}`}>Reason (optional)</Label>
          <Textarea
            id={`ban-reason-${user.id}`}
            placeholder="Reason for ban..."
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const reason = banReason.trim();
              close();
              runRowAction({
                rowId: user.id,
                // Same wording as banUser's server-side write: an empty reason lands as "Banned by admin"
                patch: {
                  banned: true,
                  banReason: reason || "Banned by admin",
                  banExpires: null,
                },
                run: () =>
                  banUser({ userId: user.id, reason: reason || undefined }),
                success: "User banned",
                failure: "Failed to ban",
              });
            }}
          >
            Confirm ban
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const UnbanUserDialog = ({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserType;
}) => {
  const runRowAction = useUserRowAction();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unban user</DialogTitle>
          <DialogDescription>
            Are you sure you want to unban {user.email || user.id}?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              runRowAction({
                rowId: user.id,
                patch: { banned: false, banReason: null, banExpires: null },
                run: () => unbanUser({ userId: user.id }),
                success: "User unbanned",
                failure: "Failed to unban",
              });
            }}
          >
            Unban
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const RoleDialog = ({
  open,
  onOpenChange,
  user,
  newRole,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserType;
  newRole: "admin" | "user";
}) => {
  const runRowAction = useUserRowAction();

  const isPromoting = newRole === "admin";
  const title = isPromoting ? "Set as admin" : "Remove admin";
  const description = isPromoting
    ? `Are you sure you want to set ${user.email || user.id} as admin?`
    : `Are you sure you want to remove admin privileges from ${user.email || user.id}?`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              runRowAction({
                rowId: user.id,
                patch: { role: newRole },
                run: () => updateUserRole({ userId: user.id, role: newRole }),
                success: isPromoting
                  ? "User promoted to admin"
                  : "Admin privileges removed",
                failure: "Failed to update role",
              });
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Account deletion (superadmin): the only entry point on the admin side.
 * Typing the email is the second safety catch; the server additionally guards
 * against live subscriptions / organization owners, and surfaces the guard's
 * reason to the admin verbatim when it rejects.
 */
const DeleteUserDialog = ({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserType;
}) => {
  const runRowAction = useUserRowAction();
  const [confirmText, setConfirmText] = useState("");
  const expected = user.email || user.id;
  const close = () => {
    setConfirmText("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) setConfirmText("");
        onOpenChange(isOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            Permanently deletes {expected}: the user row, sessions, linked
            accounts, team memberships and credit balance are erased, and the
            user's R2 artifacts (avatars) are deleted. Orders, subscriptions
            and ledger records are kept de-identified. Blocked while the user
            has a live subscription (active, trialing, or in dunning) or owns
            a team.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`delete-confirm-${user.id}`}>
            Type <span className="font-mono">{expected}</span> to confirm
          </Label>
          <Input
            id={`delete-confirm-${user.id}`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={expected}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={confirmText !== expected}
            onClick={() => {
              close();
              runRowAction({
                rowId: user.id,
                // A null patch removes the row from the cache and the total drops by one
                patch: () => null,
                run: () => deleteUserAccount({ userId: user.id }),
                success: "Account deleted",
                failure: "Failed to delete account",
              });
            }}
          >
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Impersonation (superadmin only): once confirmed, this tab *is* that user —
 * their workspace, their credits, their billing, and every action lands on
 * their account. The only reminder is the always-on ImpersonationBanner, which
 * is also the way back (the borrowed session expires after an hour anyway).
 */
const ImpersonateDialog = ({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserType;
}) => {
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const target = user.email || user.id;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (isPending) return;
        onOpenChange(isOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Impersonate user</DialogTitle>
          <DialogDescription>
            You will browse the site as {target} for up to one hour: their
            workspace, their credits, their billing. Anything you do counts as
            theirs — spending credits spends theirs, and checkout charges their
            card. A banner stays on screen the whole time; use its Exit button
            to come back to your own account.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const res = await startImpersonation({ userId: user.id });
                if (!res.success) {
                  toast.error("Failed to impersonate", {
                    description: res.error,
                  });
                  return;
                }
                // Full page load: the session cookie now belongs to someone
                // else, so the admin data in the client cache must die with it
                const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
                window.location.assign(`${prefix}/dashboard`);
              });
            }}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Impersonate"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ActionsCell = ({ user }: { user: UserType }) => {
  const t = useTranslations("Users.adjustCredits");
  const tUsers = useTranslations("Users");
  const refreshUsers = useRefreshUsersTable();
  const [openBan, setOpenBan] = useState(false);
  const [openUnban, setOpenUnban] = useState(false);
  const [openSetAdmin, setOpenSetAdmin] = useState(false);
  const [openRemoveAdmin, setOpenRemoveAdmin] = useState(false);
  const [openAdjustCredits, setOpenAdjustCredits] = useState(false);
  const [openImpersonate, setOpenImpersonate] = useState(false);
  const [openDelete, setOpenDelete] = useState(false);

  const { data: session } = authClient.useSession();
  const isCurrentUserSuperAdmin = isSuperAdminUserRole(
    (session?.user as { role?: string } | undefined)?.role
  );

  // Hybrid shape, "two everyday icons inline + ... overflow"
  // (TABLE_DESIGN_STANDARDS.md section 7): inline is for what gets clicked
  // every day (details, credit adjustment); the low-frequency tail (copy id,
  // role) and the high-risk items (ban, delete) go into the menu, where one
  // extra click buys protection against a slip.
  const canManageRole = isCurrentUserSuperAdmin && !isSuperAdminUserRole(user.role);
  const actions: RowAction[] = [
    {
      key: "view",
      icon: Eye,
      label: tUsers("actions.viewDetails"),
      href: `/dashboard/admin/users/${user.id}`,
    },
    {
      key: "adjust-credits",
      icon: Coins,
      label: t("action"),
      onClick: () => setOpenAdjustCredits(true),
    },
    {
      key: "copy-user-id",
      icon: ClipboardCopy,
      label: "Copy user ID",
      overflow: true,
      onClick: () => {
        navigator.clipboard.writeText(user.id);
        toast.success("Copied to clipboard");
      },
    },
    {
      key: "role",
      icon: isAdminUserRole(user.role) ? ShieldOff : ShieldCheck,
      label: isAdminUserRole(user.role) ? "Remove admin" : "Set as admin",
      overflow: true,
      visible: canManageRole,
      onClick: () =>
        isAdminUserRole(user.role)
          ? setOpenRemoveAdmin(true)
          : setOpenSetAdmin(true),
    },
    {
      // Impersonation: superadmin only, and only for plain users; admins
      // cannot be borrowed (guarded both in the action and in better-auth's
      // access table)
      key: "impersonate",
      icon: VenetianMask,
      // A disabled menu item carries no tooltip, so the reason goes in the label
      label: user.banned
        ? "Impersonate user (unban first)"
        : "Impersonate user",
      overflow: true,
      visible: isCurrentUserSuperAdmin && !isAdminUserRole(user.role),
      disabled: !!user.banned,
      onClick: () => setOpenImpersonate(true),
    },
    {
      key: "ban",
      icon: user.banned ? Undo2 : Ban,
      label: user.banned ? "Unban user" : "Ban user",
      tone: "destructive",
      overflow: true,
      onClick: () => {
        if (user.banned) {
          setOpenUnban(true);
          return;
        }
        if (isAdminUserRole(user.role)) {
          toast.error("Cannot ban admin users");
          return;
        }
        setOpenBan(true);
      },
    },
    {
      key: "delete",
      icon: Trash2,
      label: "Delete account",
      tone: "destructive",
      overflow: true,
      visible: canManageRole,
      onClick: () => setOpenDelete(true),
    },
  ];

  return (
    <>
      <RowActionButtons actions={actions} />

      <BanUserDialog open={openBan} onOpenChange={setOpenBan} user={user} />
      <UnbanUserDialog
        open={openUnban}
        onOpenChange={setOpenUnban}
        user={user}
      />
      <RoleDialog
        open={openSetAdmin}
        onOpenChange={setOpenSetAdmin}
        user={user}
        newRole="admin"
      />
      <RoleDialog
        open={openRemoveAdmin}
        onOpenChange={setOpenRemoveAdmin}
        user={user}
        newRole="user"
      />
      <AdjustCreditsDialog
        open={openAdjustCredits}
        onOpenChange={setOpenAdjustCredits}
        userId={user.id}
        userEmail={user.email || user.id}
        onAdjusted={refreshUsers}
      />
      <ImpersonateDialog
        open={openImpersonate}
        onOpenChange={setOpenImpersonate}
        user={user}
      />
      <DeleteUserDialog
        open={openDelete}
        onOpenChange={setOpenDelete}
        user={user}
      />
    </>
  );
};

// ============================================================================
// Total spent cell: the primary-currency figure, with every currency the user
// ever paid in listed in the Tooltip. A "+N" tag flags rows whose spend is
// spread over other currencies, so a bare number never hides money.
// ============================================================================
const TotalSpentCell = ({ user }: { user: UserType }) => {
  const locale = useLocale();
  const breakdown = user.totalSpentBreakdown ?? [];
  if (breakdown.length === 0) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }
  const primary = formatCents(user.totalSpentCents ?? 0, DEFAULT_CURRENCY, locale);
  const others = breakdown.filter((entry) => entry.currency !== DEFAULT_CURRENCY);
  if (others.length === 0) {
    return <span className="text-sm tabular-nums">{primary}</span>;
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-sm tabular-nums cursor-default">
            {primary}
            <span className="ml-1 text-xs text-muted-foreground">
              +{others.length}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="space-y-1 text-xs">
            {breakdown.map((entry) => (
              <div key={entry.currency} className="flex justify-between gap-4">
                <span className="uppercase">{entry.currency}</span>
                <span className="tabular-nums">
                  {formatCents(entry.cents, entry.currency, locale)}
                </span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ============================================================================
// User cell: avatar + name (links to the detail page) + role tag + a
// destructive Banned badge, so a banned account is spotted at a glance without
// opening the row menu. A component rather than an inline cell because the
// badge label comes from useTranslations. Name and email truncate (min-w-0)
// so a long name can never push the badge out of the column.
// ============================================================================
const UserCell = ({ user }: { user: UserType }) => {
  const t = useTranslations("Users");
  const { id, image, name, email, role, banned } = user;
  const displayName = name || email;
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={image || undefined} alt={displayName} />
        <AvatarFallback>{(displayName?.[0] || "?").toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col min-w-0 max-w-full">
        <div className="flex items-center gap-1.5 min-w-0">
          <I18nLink
            href={`/dashboard/admin/users/${id}`}
            className="font-medium hover:underline truncate"
            title={name || email}
          >
            {name || email}
          </I18nLink>
          {isAdminUserRole(role) && (
            <span className="text-xs capitalize text-primary font-medium shrink-0">
              ({role})
            </span>
          )}
          {banned && (
            <Badge variant="destructive" className="shrink-0">
              {t("detail.profile.banned")}
            </Badge>
          )}
        </div>
        <span
          className="text-sm text-muted-foreground truncate cursor-pointer hover:underline"
          title={email}
          onClick={() => {
            navigator.clipboard.writeText(email);
            toast.success("Copied to clipboard");
          }}
        >
          {email}
        </span>
      </div>
    </div>
  );
};

export const columns: ColumnDef<UserType>[] = [
  {
    id: "user",
    header: "User",
    size: 260,
    minSize: 200,
    // Capped: without it the flex layout hands an ultra-wide viewport's spare
    // width to this column, and the name/email pair floats alone in the gap
    maxSize: 280,
    cell: ({ row }) => <UserCell user={row.original} />,
  },
  {
    id: "credits",
    accessorFn: (row) => row.credits?.totalCredits ?? 0,
    header: ({ column }) => <SortableHeader column={column} title="Credits" />,
    size: 130,
    minSize: 100,
    cell: ({ row }) => {
      const credits = row.original.credits;
      if (!credits) {
        return <span className="text-sm text-muted-foreground">-</span>;
      }
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm tabular-nums cursor-default">
                {credits.totalCredits.toLocaleString()}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="space-y-1 text-xs">
                <div>
                  Subscription: {credits.subscriptionCredits.toLocaleString()}
                </div>
                <div>
                  Purchased: {credits.purchasedCredits.toLocaleString()}
                </div>
                <div className="border-t pt-1 font-medium">
                  Total: {credits.totalCredits.toLocaleString()}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },
  {
    // Lifetime net spend (orders: Σ(amountTotal - amountRefunded) per currency),
    // right after Credits so balance and money paid sit side by side; sorts by
    // the primary-currency figure. No settled orders renders "-" to keep quiet.
    id: "totalSpent",
    accessorFn: (row) => row.totalSpentCents ?? 0,
    header: ({ column }) => (
      <SortableHeader column={column} title="Total Spent" />
    ),
    size: 130,
    minSize: 110,
    cell: ({ row }) => <TotalSpentCell user={row.original} />,
  },
  {
    // Last active = MAX(updatedAt) over all of this user's session rows (it
    // advances whenever a session refreshes), used to spot dormant users; with
    // no session row (never signed in / sessions cleared) it renders "-".
    // The signup time is stacked below it in the same column so an admin can
    // relate the account lifecycle at a glance. A last-active day later than
    // the signup day means the user came back (retained) and is highlighted.
    id: "lastActiveAt",
    accessorFn: (row) =>
      row.lastActiveAt ? new Date(row.lastActiveAt).getTime() : 0,
    header: ({ column }) => (
      <SortableHeader column={column} title="Last active" />
    ),
    size: 170,
    minSize: 150,
    cell: ({ row }) => {
      const { lastActiveAt, createdAt } = row.original;
      // Compared at day granularity on purpose: signup itself creates a
      // session, so a raw millisecond ">" would light up every single row.
      const retained =
        !!lastActiveAt && dayjs(lastActiveAt).isAfter(dayjs(createdAt), "day");
      return (
        <div className="flex flex-col gap-0.5">
          {lastActiveAt ? (
            <span
              className={
                retained
                  ? "text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded px-1 -mx-1 w-fit"
                  : "text-xs text-muted-foreground"
              }
            >
              {dayjs(lastActiveAt).format("YYYY-MM-DD HH:mm")}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
          <span className="text-xs text-muted-foreground">
            {dayjs(createdAt).format("YYYY-MM-DD HH:mm")}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "stripeCustomerId",
    header: ({ column }) => (
      <SortableHeader column={column} title="Stripe Customer ID" />
    ),
    size: 200,
    minSize: 160,
    cell: ({ row }) => (
      <span
        className="cursor-pointer"
        onClick={() => {
          navigator.clipboard.writeText(row.original.stripeCustomerId || "");
          toast.success("Copied to clipboard");
        }}
      >
        {row.original.stripeCustomerId || "-"}
      </span>
    ),
  },
  {
    // referrer gets no column of its own; it is shown inside this column's TooltipContent
    id: "utm",
    header: "UTM",
    size: 160,
    minSize: 120,
    cell: ({ row }) => {
      const {
        utmSource,
        utmMedium,
        utmCampaign,
        utmTerm,
        utmContent,
        referrer,
      } = row.original;

      const utmParts: string[] = [];
      if (utmSource) utmParts.push(`source: ${utmSource}`);
      if (utmMedium) utmParts.push(`medium: ${utmMedium}`);
      if (utmCampaign) utmParts.push(`campaign: ${utmCampaign}`);
      if (utmTerm) utmParts.push(`term: ${utmTerm}`);
      if (utmContent) utmParts.push(`content: ${utmContent}`);
      if (referrer) utmParts.push(`referrer: ${referrer}`);

      if (utmParts.length === 0) {
        return <span className="text-sm text-muted-foreground">-</span>;
      }

      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-sm max-w-[200px] truncate cursor-default">
                {utmSource || utmMedium || utmCampaign || "-"}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs break-all">
              <div className="space-y-1 text-xs">
                {utmParts.map((part, idx) => (
                  <div key={idx}>{part}</div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },
  {
    // language gets no column of its own; it is rendered merged as "country / language"
    accessorKey: "countryCode",
    header: ({ column }) => <SortableHeader column={column} title="Country" />,
    size: 140,
    minSize: 100,
    cell: ({ row }) => {
      const { countryCode, language } = row.original;
      const text = [countryCode, language].filter(Boolean).join(" / ");
      return (
        <span className="text-sm text-muted-foreground">{text || "-"}</span>
      );
    },
  },
  {
    // Signup IP captured by userSource, click to copy (fraud checks, several
    // accounts sharing one address). Not sortable: ordering by IP tells nothing.
    accessorKey: "ipAddress",
    header: "IP",
    size: 130,
    minSize: 110,
    cell: ({ row }) => {
      const ipAddress = row.original.ipAddress;
      if (!ipAddress) {
        return <span className="text-sm text-muted-foreground">-</span>;
      }
      return (
        <span
          className="text-sm text-muted-foreground cursor-pointer hover:underline"
          title="Click to copy"
          onClick={() => {
            navigator.clipboard.writeText(ipAddress);
            toast.success("Copied to clipboard");
          }}
        >
          {ipAddress}
        </span>
      );
    },
  },
  {
    accessorKey: "browser",
    header: ({ column }) => <SortableHeader column={column} title="Browser" />,
    size: 130,
    minSize: 100,
    cell: ({ row }) => {
      const browser = row.original.browser;
      return (
        <span className="text-sm text-muted-foreground">{browser || "-"}</span>
      );
    },
  },
  {
    accessorKey: "os",
    header: ({ column }) => <SortableHeader column={column} title="OS" />,
    size: 130,
    minSize: 100,
    cell: ({ row }) => {
      const os = row.original.os;
      return <span className="text-sm text-muted-foreground">{os || "-"}</span>;
    },
  },
  {
    id: "device",
    header: "Device",
    size: 160,
    minSize: 120,
    cell: ({ row }) => {
      const { deviceType, deviceBrand, deviceModel } = row.original;

      const deviceParts: string[] = [];
      if (deviceType) deviceParts.push(deviceType);
      if (deviceBrand) deviceParts.push(deviceBrand);
      if (deviceModel) deviceParts.push(deviceModel);

      if (deviceParts.length === 0) {
        return <span className="text-sm text-muted-foreground">-</span>;
      }

      const fullText = deviceParts.join(" / ");

      return <span className="text-sm text-muted-foreground">{fullText}</span>;
    },
  },
  {
    accessorKey: "affCode",
    header: ({ column }) => (
      <SortableHeader column={column} title="Affiliate Code" />
    ),
    size: 150,
    minSize: 120,
    cell: ({ row }) => {
      const affCode = row.original.affCode;
      return (
        <span className="text-sm text-muted-foreground">{affCode || "-"}</span>
      );
    },
  },
  {
    id: "actions",
    header: "Actions",
    // Two inline icons + the ... overflow trigger
    size: 120,
    minSize: 110,
    cell: ({ row }) => <ActionsCell user={row.original} />,
  },
];
