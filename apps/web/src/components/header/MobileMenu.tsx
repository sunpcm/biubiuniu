/**
 * [INPUT]: Depends on Home/Header i18n copy, shadcn DropdownMenu primitives,
 *          LocaleSwitcher/ThemeToggle and the font-brand brand-face utility
 * [OUTPUT]: Exports the MobileMenu client component (mobile dropdown navigation)
 * [POS]: Mobile form of components/header, complements Header.tsx (lg breakpoint switch)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */
"use client";

import LocaleSwitcher from "@/components/LocaleSwitcher";
import { useNanoConfig } from "@/components/nano/NanoConfigContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { applyPricingOverride } from "@/config/public-paths";
import { Link as I18nLink } from "@/i18n/routing";
import { HeaderLink } from "@/types/common";
import { Languages, Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";

export default function MobileMenu() {
  const t = useTranslations("Home");
  const tHeader = useTranslations("Header");

  const rawHeaderLinks = tHeader.raw("links") as HeaderLink[];
  const { enabled: nanoEnabled } = useNanoConfig();
  const headerLinks: HeaderLink[] = rawHeaderLinks
    .map((link) => ({
      ...applyPricingOverride(link),
      items: link.items?.map((item) => ({ ...item })),
    }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="p-2" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>
          <I18nLink
            href="/"
            title={t("title")}
            prefetch={true}
            className="flex items-center space-x-1 font-bold"
          >
            <Image alt={t("title")} src="/logo-mini.png" className="h-6 w-6" width={32} height={32} />
            <span className="font-brand font-normal lowercase">{t("title")}</span>
          </I18nLink>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {headerLinks.map((link) =>
            link.items ? (
              <DropdownMenuSub key={link.name}>
                <DropdownMenuSubTrigger className="px-2 py-1.5">{link.name}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-40">
                  {link.items.map((child) => (
                    <DropdownMenuItem key={child.name}>
                      <I18nLink
                        href={child.href}
                        title={child.name}
                        prefetch={child.target && child.target === "_blank" ? false : true}
                        target={child.target || "_self"}
                        rel={child.rel || undefined}
                        className="flex flex-col gap-y-1"
                      >
                        <span>{child.name}</span>
                        {child.description && (
                          <span className="text-muted-foreground text-xs">{child.description}</span>
                        )}
                      </I18nLink>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem key={link.name}>
                <I18nLink
                  href={link.href}
                  title={link.name}
                  prefetch={link.target && link.target === "_blank" ? false : true}
                  target={link.target || "_self"}
                  rel={link.rel || undefined}
                >
                  {link.name}
                  {link.href === "/nano" && !nanoEnabled && (
                    <span className="text-muted-foreground/70 ml-1 text-xs">
                      {tHeader("nanoClosed")}
                    </span>
                  )}
                </I18nLink>
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="px-2 py-1.5">
            <Languages className="mr-2 h-4 w-4" />
            <span>Language</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="border-border/70 min-w-36 rounded-lg p-1.5 shadow-md">
            <LocaleSwitcher variant="submenu" />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm">Theme</span>
          <ThemeToggle />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
