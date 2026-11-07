/**
 * [INPUT]: Depends on @/lib/auth/auth-client for useSession/useListOrganizations/
 *          organization.setActive, the shadcn DropdownMenu and Sidebar
 *          primitives, the i18n Team.switcher copy, @/i18n/routing's useRouter
 *          (refresh)
 * [OUTPUT]: Exports the WorkspaceSwitcher client component (personal/team
 *           workspace dropdown)
 * [POS]: The workspace context entry of components/shared — setActive writes
 *        session.activeOrganizationId and every server-side consumer (billing
 *        pool / balance display) switches with it; footer entries: "team
 *        settings" (when organizations exist) + "create team" (always present,
 *        /dashboard/team?create=1 forces the create view, multi-org supported);
 *        consumed by the signed-in workspace group of DashboardSidebar
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */
"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useRouter } from "@/i18n/routing";
import { authClient } from "@/lib/auth/auth-client";
import {
  Check,
  ChevronsUpDown,
  Plus,
  Settings,
  User,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

export function WorkspaceSwitcher() {
  const t = useTranslations("Team");
  const router = useRouter();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const { data: session } = authClient.useSession();
  const { data: organizations } = authClient.useListOrganizations();
  const [switching, setSwitching] = useState(false);

  const activeOrganizationId =
    (session?.session as { activeOrganizationId?: string | null } | undefined)
      ?.activeOrganizationId ?? null;
  const activeOrg = organizations?.find((o) => o.id === activeOrganizationId);

  // Switching writes session.activeOrganizationId; server-side billing pool /
  // balance display all follow; refresh makes server components read the new
  // context immediately.
  const switchTo = async (organizationId: string | null) => {
    if (switching) return;
    setSwitching(true);
    const { error } = await authClient.organization.setActive({
      organizationId,
    });
    if (error) {
      toast.error(t("switcher.switchFailed"));
    } else {
      router.refresh();
    }
    setSwitching(false);
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              tooltip={t("switcher.label")}
              className="font-medium"
            >
              {activeOrg ? (
                <Users className="h-4 w-4" />
              ) : (
                <User className="h-4 w-4" />
              )}
              {!isCollapsed && (
                <>
                  <span className="truncate">
                    {activeOrg ? activeOrg.name : t("switcher.personal")}
                  </span>
                  <ChevronsUpDown className="ml-auto h-4 w-4 opacity-50" />
                </>
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              onClick={() => switchTo(null)}
              disabled={switching}
            >
              <User className="h-4 w-4" />
              <span>{t("switcher.personal")}</span>
              {!activeOrg && <Check className="ml-auto h-4 w-4" />}
            </DropdownMenuItem>
            {(organizations ?? []).map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => switchTo(org.id)}
                disabled={switching}
              >
                <Users className="h-4 w-4" />
                <span className="truncate">{org.name}</span>
                {org.id === activeOrganizationId && (
                  <Check className="ml-auto h-4 w-4" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {!!organizations?.length && (
              <DropdownMenuItem
                onClick={() => router.push("/dashboard/team")}
                disabled={switching}
              >
                <Settings className="h-4 w-4" />
                <span>{t("switcher.manageTeam")}</span>
              </DropdownMenuItem>
            )}
            {/* Multi-org: the create entry is always present; ?create=1 forces
                the team page into its create view */}
            <DropdownMenuItem
              onClick={() => router.push("/dashboard/team?create=1")}
              disabled={switching}
            >
              <Plus className="h-4 w-4" />
              <span>{t("switcher.createTeam")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
