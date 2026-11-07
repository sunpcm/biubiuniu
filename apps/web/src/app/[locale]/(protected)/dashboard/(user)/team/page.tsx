/**
 * [INPUT]: Depends on @/lib/auth/server's getSession/getWorkspaceContext,
 *          @/lib/metadata's constructMetadata, next-intl/server,
 *          ./TeamOnboarding and ./TeamDashboard
 * [OUTPUT]: exports the TeamPage server component and generateMetadata
 * [POS]: The entry of dashboard/(user)/team — the team management page: renders
 *        the four-card dashboard when the active workspace is a team, otherwise
 *        the create/select onboarding; ?create=1 forces the create view
 *        (multi-org: a user who already has a team can create another, reachable
 *        from the WorkspaceSwitcher and the select list); ?plan= is passed
 *        through to TeamDashboard (the pricing page's "create the team, then
 *        subscribe" round trip)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { Locale } from "@/i18n/routing";
import { getSession, getWorkspaceContext } from "@/lib/auth/server";
import { constructMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { TeamDashboard } from "./TeamDashboard";
import { TeamOnboarding } from "./TeamOnboarding";

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<{ plan?: string; create?: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Team" });

  return constructMetadata({
    title: t("page.metaTitle"),
    description: t("page.metaDescription"),
    locale: locale as Locale,
    path: "/dashboard/team",
  });
}

export default async function TeamPage({
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }

  const [workspace, { plan, create }] = await Promise.all([
    getWorkspaceContext(),
    searchParams,
  ]);

  // ?create=1 → unconditionally enter the create view (works even with
  // existing teams; organizationLimit is enforced by the server hook).
  // Active workspace is not a team → onboarding (create/select).
  // ?plan survives the refresh; TeamDashboard picks it up for checkout.
  if (create === "1" || !workspace?.organizationId) {
    return <TeamOnboarding forceCreate={create === "1"} />;
  }

  return (
    <TeamDashboard
      organizationId={workspace.organizationId}
      currentUserId={session.user.id}
      planId={plan ?? null}
    />
  );
}
