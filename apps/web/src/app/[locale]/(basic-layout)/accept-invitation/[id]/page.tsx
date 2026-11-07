/**
 * [INPUT]: Depends on @/lib/auth's auth.api.getInvitation and @/lib/auth/server's
 *          getSession, @/lib/metadata's constructMetadata,
 *          ./AcceptInvitationCard
 * [OUTPUT]: Exports the AcceptInvitationPage server component and generateMetadata
 * [POS]: The landing page for team invitation mail — the server only reads the
 *        invitation details; accept/decline are client button actions (a GET
 *        prefetched by a mail scanner must never cause side effects); signed-out
 *        users round-trip through /login?next=
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { Locale } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/auth/server";
import { constructMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AcceptInvitationCard } from "./AcceptInvitationCard";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "Team" });
  return constructMetadata({
    title: t("invite.metaTitle"),
    description: t("invite.metaDescription"),
    locale: locale as Locale,
    path: `/accept-invitation/${id}`,
    noIndex: true,
  });
}

export default async function AcceptInvitationPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;

  const session = await getSession();
  if (!session?.user) {
    redirect(`/login?next=/accept-invitation/${id}`);
  }

  // getInvitation validates that the session email matches the invited email,
  // the status is pending and it has not expired — any violation throws.
  // All failures collapse into the invalid display state; the exact reason
  // does not change the next step.
  let invitation: {
    organizationName: string;
    inviterEmail: string;
    status: string;
  } | null = null;
  let wrongAccount = false;
  try {
    const result = await auth.api.getInvitation({
      query: { id },
      headers: await headers(),
    });
    invitation = {
      organizationName: result.organizationName,
      inviterEmail: result.inviterEmail,
      status: result.status,
    };
  } catch (error) {
    // better-auth 1.4.x phrases the recipient mismatch as
    // "You are not the recipient of the invitation" — match on its keyword,
    // keep the email keyword for forward compatibility with future wording.
    wrongAccount =
      error instanceof Error &&
      /recipient|email/i.test(error.message ?? "");
  }

  return (
    <div className="container flex min-h-[60vh] items-center justify-center py-16">
      <AcceptInvitationCard
        invitationId={id}
        organizationName={invitation?.organizationName ?? null}
        inviterEmail={invitation?.inviterEmail ?? null}
        pending={invitation?.status === "pending"}
        wrongAccount={wrongAccount}
      />
    </div>
  );
}
