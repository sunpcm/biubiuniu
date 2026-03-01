import { Newsletter } from "@/components/footer/Newsletter";
import { siteConfig } from "@/config/site";
import { Link as I18nLink } from "@/i18n/routing";
import { FooterLink } from "@/types/common";
import { getMessages, getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function Footer() {
  const messages = await getMessages();

  const _t = await getTranslations("Home");
  const tFooter = await getTranslations("Footer");
  const tTempFooter = await getTranslations("Landing.TempFooter");

  const footerLinks: FooterLink[] = tFooter.raw("Links.groups");
  footerLinks.forEach((group) => {
    const pricingLink = group.links.find((link) => link.id === "pricing");
    if (pricingLink) {
      pricingLink.href = process.env.NEXT_PUBLIC_PRICING_PATH!;
    }
  });

  return (
    <div className="bg-gray-900 text-gray-300">
      <footer className="border-t border-gray-700 py-2">
        <div className="mx-auto w-full px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 py-12 sm:grid-cols-2 lg:grid-cols-6">
            <div className="col-span-full flex w-full flex-col gap-4 sm:flex-row md:col-span-2 lg:flex-col">
              <div className="flex-1 space-y-4">
                <div className="flex items-center space-x-2">
                  <h2 className="highlight-text text-2xl font-bold">
                    BiuBiu <span style={{ color: "#FFD600" }}>·</span>{" "}
                    <span style={{ color: "rgb(154, 247, 68)" }}>Niu</span>
                  </h2>
                </div>
                <p className="p4-4 text-sm md:pr-12">{tTempFooter("description")}</p>
              </div>
            </div>

            {footerLinks.map((section) => (
              <div key={section.title} className="flex-1">
                <h3 className="mb-4 text-lg font-semibold text-white">{section.title}</h3>
                <ul className="space-y-2 text-sm">
                  {section.links.map(
                    (link) =>
                      !link.hidden && (
                        <li key={link.href}>
                          {link.disabled ? (
                            <span title={link.name} className="cursor-not-allowed text-gray-500">
                              {link.name}
                            </span>
                          ) : link.href.startsWith("/") && !link.useA ? (
                            <I18nLink
                              href={link.href}
                              title={link.name}
                              prefetch={false}
                              className="transition-colors hover:text-white"
                              target={link.target || ""}
                              rel={link.rel || ""}
                            >
                              {link.name}
                            </I18nLink>
                          ) : (
                            <Link
                              href={link.href}
                              title={link.name}
                              prefetch={false}
                              className="transition-colors hover:text-white"
                              target={link.target || ""}
                              rel={link.rel || ""}
                            >
                              {link.name}
                            </Link>
                          )}
                        </li>
                      ),
                  )}
                </ul>
              </div>
            ))}

            {messages.Footer.Newsletter && (
              <div className="w-full flex-1">
                <Newsletter />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center justify-between border-t border-gray-800 py-6 md:flex-row">
            <p className="text-sm text-gray-400">
              {tFooter("Copyright", {
                year: new Date().getFullYear(),
                name: siteConfig.name,
              })}
            </p>
            <div className="mt-4 flex space-x-6 md:mt-0">
              <I18nLink
                href="/privacy-policy"
                title={tFooter("PrivacyPolicy")}
                prefetch={false}
                className="text-sm text-gray-400 hover:text-white"
              >
                {tFooter("PrivacyPolicy")}
              </I18nLink>
              <I18nLink
                href="/terms-of-service"
                title={tFooter("TermsOfService")}
                prefetch={false}
                className="text-sm text-gray-400 hover:text-white"
              >
                {tFooter("TermsOfService")}
              </I18nLink>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
