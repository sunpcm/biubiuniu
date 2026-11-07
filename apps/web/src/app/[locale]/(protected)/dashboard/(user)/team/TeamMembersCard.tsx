/**
 * [INPUT]: Depends on @/lib/auth/auth-client's authClient.organization
 *          (inviteMember/cancelInvitation/removeMember/updateMemberRole/leave),
 *          shadcn Card/Badge/Button/Input/Select/Avatar/AlertDialog,
 *          @/i18n/routing's Link, the i18n Team namespace, dayjs
 * [OUTPUT]: Exports the TeamMembersCard client component
 * [POS]: The members/seats card of dashboard/(user)/team — consumed by
 *        TeamDashboard: header refresh button (onRefresh injected by the
 *        parent) + seat usage + member list (owner changes roles, owner/admin
 *        removes, a non-owner may leave on their own — after leaving, the
 *        active workspace falls back to personal) + three-state invite area
 *        (no team subscription → purchase nudge pointing at pricing / seats
 *        full including pending placeholders → inline notice / otherwise the
 *        form; the client-side prediction mirrors the server invitation hook,
 *        a 403 is only the concurrency backstop and triggers a resync) +
 *        pending invitation list (canManage may copy the invite link / cancel;
 *        the link shares the /accept-invitation/{id} path with the invitation
 *        email); members/invitations come from useActiveOrganization
 *        (better-auth refetches automatically after mutations); seat counts go
 *        through onMutated so the parent invalidates overview
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRICING_PATH } from "@/config/public-paths";
import { Link as I18nLink, useRouter } from "@/i18n/routing";
import { authClient } from "@/lib/auth/auth-client";
import dayjs from "dayjs";
import {
  Check,
  Copy,
  Loader2,
  LogOut,
  MailPlus,
  RefreshCw,
  Sparkles,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

// Minimal slice of better-auth's get-full-organization response —
// structural typing decouples this component from plugin version bumps.
interface TeamMemberEntry {
  id: string;
  userId: string;
  role: string;
  user: { name?: string | null; email: string; image?: string | null };
}

interface TeamInvitationEntry {
  id: string;
  email: string;
  role?: string | null;
  status: string;
  expiresAt: Date | string;
}

export function TeamMembersCard({
  organizationId,
  currentUserId,
  currentRole,
  seats,
  hasTeamSubscription,
  members,
  invitations,
  onMutated,
  onRefresh,
}: {
  organizationId: string;
  currentUserId: string;
  currentRole: string | undefined;
  seats: { used: number; total: number };
  /** Live team subscription flag — same source of truth as the server invitation hook (getTeamOverview) */
  hasTeamSubscription: boolean;
  members: TeamMemberEntry[];
  invitations: TeamInvitationEntry[];
  onMutated: () => void;
  /** Manually refresh every data source of this card (activeOrg members/invitations + overview seats/subscription) */
  onRefresh: () => Promise<unknown>;
}) {
  const t = useTranslations("Team");
  const router = useRouter();

  const isOwner = currentRole === "owner";
  const canManage = isOwner || currentRole === "admin";
  const [leaving, setLeaving] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [sending, setSending] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  // Expired and settled invitations are filtered at read time — same
  // definition of "pending placeholder" as the server side.
  const pendingInvitations = invitations.filter(
    (inv) => inv.status === "pending" && dayjs(inv.expiresAt).isAfter(dayjs()),
  );

  // Mirrors the server beforeCreateInvitation hook: member count + pending
  // invitation placeholders. No subscription / seats full replaces the form
  // at render time — a predictable 403 should never be user-discoverable.
  const seatsLeft = seats.total - seats.used - pendingInvitations.length > 0;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email || sending) return;

    setSending(true);
    const { error } = await authClient.organization.inviteMember({
      email,
      role: inviteRole,
      organizationId,
    });
    setSending(false);

    if (error) {
      // The form only renders when "subscribed with free seats", so a 403
      // here means stale client state (subscription just lapsed / concurrent
      // seat grab): toast, then refetch the overview so the UI converges.
      toast.error(
        error.status === 403 ? t("page.members.invite.seatsFull") : t("page.members.invite.failed"),
      );
      if (error.status === 403) onMutated();
      return;
    }
    toast.success(t("page.members.invite.sent"));
    setInviteEmail("");
    onMutated();
  };

  const handleCancelInvitation = async (invitationId: string) => {
    setCancelingId(invitationId);
    const { error } = await authClient.organization.cancelInvitation({
      invitationId,
    });
    setCancelingId(null);
    if (error) {
      toast.error(t("page.members.pending.cancelFailed"));
      return;
    }
    toast.success(t("page.members.pending.canceled"));
    onMutated();
  };

  // Copy invite link: same landing path as the invitation email
  // (/accept-invitation/{id}), so inviters can share it over IM etc.;
  // success feedback swaps to a Check icon in place, no toast.
  const handleCopyInviteLink = async (invitationId: string) => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/accept-invitation/${invitationId}`,
      );
      setCopiedId(invitationId);
      setTimeout(() => setCopiedId((id) => (id === invitationId ? null : id)), 1500);
    } catch {
      toast.error(t("page.members.pending.copyFailed"));
    }
  };

  const handleRemove = async (memberId: string) => {
    setBusyMemberId(memberId);
    const { error } = await authClient.organization.removeMember({
      memberIdOrEmail: memberId,
      organizationId,
    });
    setBusyMemberId(null);
    if (error) {
      toast.error(t("page.members.removeFailed"));
      return;
    }
    onMutated();
  };

  // Self-serve leave (non-owner): after leaving, the active workspace falls
  // back to personal and refresh lets the page naturally switch to the
  // onboarding/personal state — owners cannot leave (an org needs an owner).
  const handleLeave = async () => {
    setLeaving(true);
    const { error } = await authClient.organization.leave({ organizationId });
    if (error) {
      toast.error(t("page.members.leave.failed"));
      setLeaving(false);
      return;
    }
    await authClient.organization.setActive({ organizationId: null });
    toast.success(t("page.members.leave.left"));
    router.refresh();
  };

  const handleRoleChange = async (memberId: string, role: string) => {
    setBusyMemberId(memberId);
    const { error } = await authClient.organization.updateMemberRole({
      memberId,
      role: role as "member" | "admin",
      organizationId,
    });
    setBusyMemberId(null);
    if (error) {
      toast.error(t("page.members.roleUpdateFailed"));
      return;
    }
    onMutated();
  };

  const roleLabel = (role: string) =>
    t.has(`page.members.role.${role}`) ? t(`page.members.role.${role}`) : role;

  return (
    <Card className="gap-3 py-5">
      <CardHeader>
        <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
          <Users className="text-primary size-4" />
          {t("page.members.title")}
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          <Badge variant="outline" className="tabular-nums">
            {t("page.members.seats", {
              used: seats.used,
              total: seats.total,
            })}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-8"
            title={t("page.refresh")}
            aria-label={t("page.refresh")}
            disabled={refreshing}
            onClick={handleRefresh}
          >
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Member list */}
        <ul className="space-y-1">
          {members.map((m) => {
            const displayName = m.user.name || m.user.email;
            const isSelf = m.userId === currentUserId;
            const busy = busyMemberId === m.id;
            return (
              <li
                key={m.id}
                className="hover:bg-accent/50 flex items-center gap-3 rounded-lg px-2 py-2"
              >
                <Avatar className="size-8">
                  <AvatarImage src={m.user.image ?? undefined} />
                  <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {displayName}
                    {isSelf && (
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        {t("page.members.you")}
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">{m.user.email}</p>
                </div>

                {/* Role: the owner can switch non-owner members between admin/member */}
                {isOwner && m.role !== "owner" ? (
                  <Select
                    value={m.role}
                    disabled={busy}
                    onValueChange={(role) => handleRoleChange(m.id, role)}
                  >
                    <SelectTrigger size="sm" className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{t("page.members.role.admin")}</SelectItem>
                      <SelectItem value="member">{t("page.members.role.member")}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                    {roleLabel(m.role)}
                  </Badge>
                )}

                {/* Leave: a non-owner can remove themselves from the team */}
                {isSelf && m.role !== "owner" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive size-8"
                        disabled={leaving}
                      >
                        {leaving ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <LogOut className="size-4" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("page.members.leave.title")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("page.members.leave.description")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("page.members.removeCancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive hover:bg-destructive/90 text-white"
                          onClick={handleLeave}
                        >
                          {t("page.members.leave.confirm")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}

                {/* Remove: owner/admin can remove members that are neither owner nor self */}
                {canManage && m.role !== "owner" && !isSelf && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive size-8"
                        disabled={busy}
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <UserMinus className="size-4" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("page.members.removeTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("page.members.removeDescription", {
                            name: displayName,
                          })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("page.members.removeCancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive hover:bg-destructive/90 text-white"
                          onClick={() => handleRemove(m.id)}
                        >
                          {t("page.members.removeConfirm")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </li>
            );
          })}
        </ul>

        {/* --------------------------------------------------------------
            Invite area (owner/admin only), three states, mirroring the
            server-side seat hook: no team subscription → purchase nudge;
            seats full → inline notice; otherwise → invite form.
            The server hook stays the enforcement line — this just keeps
            users from walking into a predictable 403.
        -------------------------------------------------------------- */}
        {canManage && !hasTeamSubscription && (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-4 sm:flex-row sm:items-center">
            <p className="text-muted-foreground flex-1 text-sm">
              {t("page.members.invite.requiresPlan")}
            </p>
            <Button asChild size="sm">
              <I18nLink href={PRICING_PATH}>
                <Sparkles className="size-3.5" />
                {t("page.subscription.viewPlans")}
              </I18nLink>
            </Button>
          </div>
        )}

        {canManage && hasTeamSubscription && !seatsLeft && (
          <div className="rounded-lg border border-dashed px-4 py-4">
            <p className="text-muted-foreground text-sm">{t("page.members.invite.seatsFull")}</p>
          </div>
        )}

        {canManage && hasTeamSubscription && seatsLeft && (
          <form onSubmit={handleInvite} className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={t("page.members.invite.emailPlaceholder")}
              disabled={sending}
              required
            />
            <div className="flex gap-2">
              <Select
                value={inviteRole}
                disabled={sending}
                onValueChange={(v) => setInviteRole(v as "member" | "admin")}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t("page.members.role.member")}</SelectItem>
                  <SelectItem value="admin">{t("page.members.role.admin")}</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={sending || !inviteEmail.trim()}>
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MailPlus className="size-4" />
                )}
                {t("page.members.invite.button")}
              </Button>
            </div>
          </form>
        )}

        {/* Pending invitations */}
        {pendingInvitations.length > 0 && (
          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              {t("page.members.pending.title")}
            </p>
            <ul className="space-y-1">
              {pendingInvitations.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{inv.email}</p>
                    <p className="text-muted-foreground text-xs">
                      {t("page.members.pending.expires", {
                        date: dayjs(inv.expiresAt).format("YYYY-MM-DD HH:mm"),
                      })}
                    </p>
                  </div>
                  {inv.role && <Badge variant="outline">{roleLabel(inv.role)}</Badge>}
                  {canManage && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground size-8"
                        title={t("page.members.pending.copyLink")}
                        aria-label={t("page.members.pending.copyLink")}
                        onClick={() => handleCopyInviteLink(inv.id)}
                      >
                        {copiedId === inv.id ? (
                          <Check className="size-4 text-emerald-500" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive size-8"
                        disabled={cancelingId === inv.id}
                        onClick={() => handleCancelInvitation(inv.id)}
                      >
                        {cancelingId === inv.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <X className="size-4" />
                        )}
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
