"use client";

import { DynamicIcon } from "@/components/DynamicIcon";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@niu/ui/sidebar";
import { Link as I18nLink, usePathname } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import Image from "next/image";

type Menu = {
  name: string;
  href: string;
  target?: string;
  icon: string;
};

export function DashboardSidebar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const t = useTranslations("Login");

  const userMenus: Menu[] = t.raw("UserMenus");
  const adminMenus: Menu[] = t.raw("AdminMenus");

  const isActive = (href: string) => pathname === href;

  const { state } = useSidebar();

  const isCollapsed = state === "collapsed";

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader>
        <I18nLink
          href="/"
          title={t("title")}
          prefetch={true}
          className="flex items-center space-x-1 px-2 py-1"
        >
          <Image src="/logo.png" alt="Logo" width={84} height={44} className="rounded-md" />
          {/* {!isCollapsed && <h1 className="font-semibold">{siteConfig.name}</h1>} */}
        </I18nLink>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {userMenus.map((menu) => (
                <SidebarMenuItem key={menu.href}>
                  <SidebarMenuButton asChild isActive={isActive(menu.href)}>
                    <I18nLink
                      href={menu.href}
                      title={menu.name}
                      prefetch={true}
                      target={menu.target}
                    >
                      {menu.icon ? (
                        <DynamicIcon name={menu.icon} className="h-4 w-4" />
                      ) : (
                        <span>{menu.name.slice(0, 1)}</span>
                      )}
                      {!isCollapsed && <span>{menu.name}</span>}
                    </I18nLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {user?.role === "admin" && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Admin Menus</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {adminMenus.map((menu) => (
                    <SidebarMenuItem key={menu.href}>
                      <SidebarMenuButton asChild isActive={isActive(menu.href)}>
                        <I18nLink href={menu.href} title={menu.name} prefetch={false}>
                          <DynamicIcon name={menu.icon} className="h-4 w-4" />
                          {!isCollapsed && <span>{menu.name}</span>}
                        </I18nLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
