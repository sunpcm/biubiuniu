/**
 * [INPUT]: Depends on @/lib/auth/auth-client for authClient.organization
 *          (acceptInvitation/rejectInvitation/setActive) and signOut,
 *          shadcn Card/Button, the i18n Team namespace
 * [OUTPUT]: Exports the AcceptInvitationCard client component
 * [POS]: The interaction card of the accept-invitation page — on accept,
 *        setActive switches into the team workspace and routes to
 *        /dashboard/team; invalid/already-settled invitations render a
 *        read-only state; an email mismatch offers a "sign out and switch
 *        account" exit (signOut, then back to the login page carrying ?next=)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */
"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRouter } from "@/i18n/routing";
import { authClient } from "@/lib/auth/auth-client";
import { Loader2, MailX, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface AcceptInvitationCardProps {
  invitationId: string;
  organizationName: string | null;
  inviterEmail: string | null;
  pending: boolean;
  wrongAccount: boolean;
}

export function AcceptInvitationCard({
  invitationId,
  organizationName,
  inviterEmail,
  pending,
  wrongAccount,
}: AcceptInvitationCardProps) {
  const t = useTranslations("Team");
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | "switch" | null>(
    null
  );

  // Rescue exit for email mismatches: sign out, then return to login with
  // ?next= — after signing in with the invited email the user lands right
  // back on this invitation page, no hunting for a logout button.
  const switchAccount = async () => {
    setBusy("switch");
    await authClient.signOut();
    router.push(`/login?next=/accept-invitation/${invitationId}`);
  };

  if (!pending || !organizationName) {
    return (
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <MailX className="mx-auto mb-2 size-10 text-muted-foreground" />
          <CardTitle>
            {wrongAccount ? t("invite.wrongAccount") : t("invite.invalid")}
          </CardTitle>
          {!wrongAccount && (
            <CardDescription>{t("invite.invalidHint")}</CardDescription>
          )}
        </CardHeader>
        <CardFooter className="justify-center gap-3">
          {wrongAccount && (
            <Button onClick={switchAccount} disabled={busy !== null}>
              {busy === "switch" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                t("invite.switchAccount")
              )}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => router.push("/")}
            disabled={busy !== null}
          >
            {t("invite.backHome")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const accept = async () => {
    setBusy("accept");
    const { data, error } = await authClient.organization.acceptInvitation({
      invitationId,
    });
    if (error || !data) {
      toast.error(t("invite.acceptFailed"));
      setBusy(null);
      return;
    }
    toast.success(t("invite.accepted"));
    await authClient.organization.setActive({
      organizationId: data.member.organizationId,
    });
    router.push("/dashboard/team");
  };

  const decline = async () => {
    setBusy("decline");
    const { error } = await authClient.organization.rejectInvitation({
      invitationId,
    });
    if (error) {
      toast.error(t("invite.acceptFailed"));
      setBusy(null);
      return;
    }
    toast.success(t("invite.declined"));
    router.push("/");
  };

  return (
    <Card className="w-full max-w-md text-center">
      <CardHeader>
        <Users className="mx-auto mb-2 size-10 text-primary" />
        <CardTitle>{t("invite.title", { organizationName })}</CardTitle>
        <CardDescription>
          {t("invite.invitedBy", { inviter: inviterEmail ?? "A teammate" })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center gap-3">
        <Button onClick={accept} disabled={busy !== null}>
          {busy === "accept" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("invite.accepting")}
            </>
          ) : (
            t("invite.accept")
          )}
        </Button>
        <Button variant="outline" onClick={decline} disabled={busy !== null}>
          {t("invite.decline")}
        </Button>
      </CardContent>
    </Card>
  );
}
