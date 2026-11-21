/**
 * [INPUT]: Depends on the Header i18n links array (common.json), shadcn NavigationMenu
 *          and NEXT_PUBLIC_PRICING_PATH (blank/unset resolves to /#pricing)
 * [OUTPUT]: Exports the HeaderLinks client component (desktop primary nav with dropdown groups)
 * [POS]: Desktop navigation of components/header, complements MobileMenu (lg breakpoint switch)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */
"use client";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { useNanoConfig } from "@/components/nano/NanoConfigContext";
import { applyPricingOverride } from "@/config/public-paths";
import { Link as I18nLink, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { HeaderLink } from "@/types/common";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

const HeaderLinks = () => {
  const tHeader = useTranslations("Header");
  const pathname = usePathname();

  const rawHeaderLinks = tHeader.raw("links") as HeaderLink[];
  const { enabled: nanoEnabled } = useNanoConfig();
  const headerLinks: HeaderLink[] = rawHeaderLinks
    .map((link) => ({
      ...applyPricingOverride(link),
      items: link.items?.map((item) => ({ ...item })),
    }));

  return (
    <NavigationMenu viewport={false} className="hidden lg:block">
      <NavigationMenuList className="flex-wrap">
        {headerLinks.map((link) => (
          <NavigationMenuItem key={link.name}>
            {link.items ? (
              <>
                <NavigationMenuTrigger className="hover:bg-accent-foreground/10 hover:text-accent-foreground text-muted-foreground flex items-center gap-x-1 rounded-xl bg-transparent px-4 py-2 text-sm font-normal">
                  {link.name}
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="w-[250px] gap-1">
                    {link.items.map((child) => (
                      <li key={child.name} className="hover:bg-accent-foreground/10">
                        <NavigationMenuLink asChild>
                          <I18nLink
                            href={child.href}
                            title={child.name}
                            prefetch={child.target && child.target === "_blank" ? false : true}
                            target={child.target || "_self"}
                            rel={child.rel || undefined}
                            className={cn(
                              "text-muted-foreground hover:text-accent-foreground flex flex-col gap-y-1 text-sm",
                            )}
                          >
                            <div className="flex items-center gap-x-1">
                              {child.name}
                              {child.target === "_blank" && (
                                <span className="text-xs">
                                  <ExternalLink className="h-4 w-4" />
                                </span>
                              )}
                            </div>
                            {child.description && (
                              <div className="text-muted-foreground text-xs">
                                {child.description}
                              </div>
                            )}
                          </I18nLink>
                        </NavigationMenuLink>
                      </li>
                    ))}
                  </ul>
                </NavigationMenuContent>
              </>
            ) : (
              <I18nLink
                key={link.name}
                href={link.href}
                title={link.name}
                prefetch={link.target && link.target === "_blank" ? false : true}
                target={link.target || "_self"}
                rel={link.rel || undefined}
                className={cn(
                  "text-muted-foreground hover:bg-accent-foreground/10 hover:text-accent-foreground flex items-center gap-x-1 rounded-xl bg-transparent px-4 py-2 text-sm font-normal",
                  pathname === link.href && "text-accent-foreground font-medium",
                )}
              >
                {link.name}
                {link.href === "/nano" && !nanoEnabled && (
                  <span className="text-muted-foreground/70 text-xs">
                    {tHeader("nanoClosed")}
                  </span>
                )}
                {link.target === "_blank" && (
                  <span className="text-xs">
                    <ExternalLink className="h-4 w-4" />
                  </span>
                )}
              </I18nLink>
            )}
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
};

export default HeaderLinks;
