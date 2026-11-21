/**
 * [INPUT]: Depends on @/lib/auth/auth-client's authClient.organization
 *          (create/setActive + useListOrganizations), shadcn
 *          Card/Button/Input/Skeleton, @/i18n/routing's useRouter,
 *          next/navigation's useSearchParams, the i18n Team namespace
 * [OUTPUT]: Exports the TeamOnboarding client component (props: forceCreate)
 * [POS]: The onboarding state of dashboard/(user)/team — the create view is
 *        URL-driven (?create=1 or zero organizations); multi-org aware: the
 *        selection list carries a "create another" entry and the create card
 *        shows a back button when organizations already exist; the slug is
 *        derived from the name + a random suffix against collisions; creating
 *        and selecting both settle through setActive + URL convergence +
 *        refresh, after which page.tsx routes to TeamDashboard (?plan is kept
 *        to relay the subscription)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/i18n/routing";
import { authClient } from "@/lib/auth/auth-client";
import { ArrowLeft, ArrowRight, Loader2, Plus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Name → slug: lowercase hyphens + random suffix against collisions.
 * Non-latin names (e.g. pure CJK) sanitize to empty and uniformly fall back
 * to team-{suffix} — no special branch.
 */
function slugifyTeamName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : `team-${suffix}`;
}

export function TeamOnboarding({
  forceCreate = false,
}: {
  /** ?create=1 deep link: force the create view even with existing teams (multi-org entry) */
  forceCreate?: boolean;
}) {
  const t = useTranslations("Team");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: organizations, isPending } = authClient.useListOrganizations();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // The only switch for the create view is the URL (?create=1) plus the
  // "zero organizations" fallback; view changes always go through the
  // router — no shadow local state.
  const hasOrganizations = !!organizations?.length;
  const showCreate = forceCreate || !hasOrganizations;

  const teamPath = (create: boolean) => {
    const params = new URLSearchParams(searchParams);
    if (create) params.set("create", "1");
    else params.delete("create");
    const qs = params.toString();
    return qs ? `/dashboard/team?${qs}` : "/dashboard/team";
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;

    setCreating(true);
    const { data, error } = await authClient.organization.create({
      name: trimmed,
      slug: slugifyTeamName(trimmed),
    });
    if (error || !data) {
      // The server may reject on the organization limit — surface its
      // message, fall back to the generic copy.
      toast.error(error?.message || t("page.onboarding.createFailed"));
      setCreating(false);
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    // Converge the URL (strip ?create, keep ?plan) + server re-render: once
    // the workspace becomes the new team, page.tsx switches to TeamDashboard
    // which relays the checkout.
    router.replace(teamPath(false));
    router.refresh();
  };

  const handleSelect = async (organizationId: string) => {
    if (switchingId) return;
    setSwitchingId(organizationId);
    const { error } = await authClient.organization.setActive({
      organizationId,
    });
    if (error) {
      toast.error(t("page.onboarding.switchFailed"));
      setSwitchingId(null);
      return;
    }
    router.refresh();
  };

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-lg pt-8">
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  // Create a team (the first one, or another)
  if (showCreate) {
    return (
      <div className="mx-auto w-full max-w-lg pt-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5 text-primary" />
              {t("page.onboarding.createTitle")}
            </CardTitle>
            <CardDescription>
              {t("page.onboarding.createDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={handleCreate} className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("page.onboarding.namePlaceholder")}
                maxLength={64}
                disabled={creating}
                required
              />
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("page.onboarding.creating")}
                  </>
                ) : (
                  t("page.onboarding.createButton")
                )}
              </Button>
            </form>
            {hasOrganizations && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={creating}
                onClick={() => router.push(teamPath(false))}
              >
                <ArrowLeft className="size-4" />
                {t("page.onboarding.back")}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Orgs exist but the active workspace is personal → pick a team to manage,
  // or create another one.
  return (
    <div className="mx-auto w-full max-w-lg pt-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            {t("page.onboarding.chooseTitle")}
          </CardTitle>
          <CardDescription>
            {t("page.onboarding.chooseDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(organizations ?? []).map((org) => (
            <button
              key={org.id}
              type="button"
              disabled={switchingId !== null}
              onClick={() => handleSelect(org.id)}
              className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-60"
            >
              <span className="font-medium">{org.name}</span>
              {switchingId === org.id ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <ArrowRight className="size-4 text-muted-foreground" />
              )}
            </button>
          ))}
          <Button
            variant="outline"
            className="w-full"
            disabled={switchingId !== null}
            onClick={() => router.push(teamPath(true))}
          >
            <Plus className="size-4" />
            {t("page.onboarding.createAnother")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
