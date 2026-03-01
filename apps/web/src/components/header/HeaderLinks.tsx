"use client";

import { Link as I18nLink, usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { HeaderLink } from "@/types/common";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

const HeaderLinks = () => {
  const tHeader = useTranslations("Header");
  const pathname = usePathname();

  const headerLinks: HeaderLink[] = tHeader.raw("links");
  const pricingLink = headerLinks.find((link) => link.id === "pricing");
  if (pricingLink) {
    pricingLink.href = process.env.NEXT_PUBLIC_PRICING_PATH!;
  }

  return (
    <div className="text-muted-foreground hidden flex-row items-center gap-x-2 text-sm lg:flex">
      {headerLinks.map((link) => {
        const isDisabled = link.name !== "Nano Banana";
        return (
          !link.hidden && (
            <I18nLink
              key={link.name}
              href={isDisabled ? "#" : link.href}
              title={link.name}
              prefetch={link.target && link.target === "_blank" ? false : true}
              target={link.target || "_self"}
              rel={link.rel || undefined}
              aria-disabled={isDisabled}
              tabIndex={isDisabled ? -1 : 0}
              className={cn(
                "hover:bg-accent-foreground/10 hover:text-primary flex items-center gap-x-1 rounded-xl px-4 py-2",
                pathname === link.href && "text-primary font-medium",
                isDisabled && "pointer-events-none cursor-not-allowed opacity-50",
              )}
              onClick={isDisabled ? (e) => e.preventDefault() : undefined}
            >
              {link.name}
              {link.target && link.target === "_blank" && !isDisabled && (
                <span className="text-xs">
                  <ExternalLink className="h-4 w-4" />
                </span>
              )}
            </I18nLink>
          )
        );
      })}
    </div>
  );
};

export default HeaderLinks;
