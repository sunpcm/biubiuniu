import BuiltWithButton from "@/components/BuiltWithButton";
import { Newsletter } from "@/components/footer/Newsletter";
import { TwitterX } from "@/components/social-icons/icons";
import { applyPricingOverride } from "@/config/public-paths";
import { siteConfig } from "@/config/site";
import { Link as I18nLink } from "@/i18n/routing";
import { FooterLink } from "@/types/common";
import { GithubIcon, InstagramIcon, MailIcon, Youtube } from "lucide-react";
import { getMessages, getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { SiBluesky, SiDiscord, SiTiktok } from "react-icons/si";

export default async function Footer() {
  const messages = await getMessages();

  const t = await getTranslations("Home");
  const tFooter = await getTranslations("Footer");

  const rawFooterLinks = tFooter.raw("Links.groups") as FooterLink[];
  const footerLinks: FooterLink[] = rawFooterLinks.map((group) => ({
    ...group,
    links: group.links.map((link) => applyPricingOverride(link)),
  }));

  return (
    <div className="border-t border-gray-700 bg-gray-900 text-gray-300">
      <footer className="max-w-8xl container mx-auto py-2">
        <div className="mx-auto w-full px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 py-12 sm:grid-cols-2 lg:grid-cols-6">
            <div className="col-span-full flex w-full flex-col gap-4 sm:flex-row md:col-span-2 lg:flex-col">
              <div className="flex-1 space-y-4">
                <div className="flex items-center space-x-2">
                  <div className="flex items-center gap-2 text-xl font-medium text-gray-50">
                    <Image
                      src="/logo.png"
                      alt={t("title")}
                      width={100}
                      height={26}
                      className="h-auto w-auto max-w-[100px]"
                    />
                    <span className="font-brand font-normal lowercase">{t("title")}</span>
                  </div>
                </div>

                <p className="p4-4 text-sm md:pr-12">{t("tagLine")}</p>

                <div className="flex items-center gap-2">
                  {siteConfig.socialLinks?.github && (
                    <Link
                      href={siteConfig.socialLinks.github}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer nofollow noopener"
                      aria-label="GitHub"
                      title="View on GitHub"
                      className="hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md"
                    >
                      <GithubIcon className="size-4" aria-hidden="true" />
                    </Link>
                  )}
                  {siteConfig.socialLinks?.bluesky && (
                    <Link
                      href={siteConfig.socialLinks.bluesky}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer nofollow noopener"
                      aria-label="Bluesky"
                      title="View on Bluesky"
                      className="hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md"
                    >
                      <SiBluesky className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                  {siteConfig.socialLinks?.twitter && (
                    <Link
                      href={siteConfig.socialLinks.twitter}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer nofollow noopener"
                      aria-label="Twitter"
                      title="View on Twitter"
                      className="hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md"
                    >
                      <TwitterX className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                  {siteConfig.socialLinks?.youtube && (
                    <Link
                      href={siteConfig.socialLinks.youtube}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer nofollow noopener"
                      aria-label="YouTube"
                      title="View on YouTube"
                      className="hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md"
                    >
                      <Youtube className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                  {siteConfig.socialLinks?.instagram && (
                    <Link
                      href={siteConfig.socialLinks.instagram}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer nofollow noopener"
                      aria-label="Instagram"
                      title="View on Instagram"
                      className="hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md"
                    >
                      <InstagramIcon className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                  {siteConfig.socialLinks?.tiktok && (
                    <Link
                      href={siteConfig.socialLinks.tiktok}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer nofollow noopener"
                      aria-label="TikTok"
                      title="View on TikTok"
                      className="hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md"
                    >
                      <SiTiktok className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                  {siteConfig.socialLinks?.discord && (
                    <Link
                      href={siteConfig.socialLinks.discord}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer nofollow noopener"
                      aria-label="Discord"
                      title="Join Discord"
                      className="hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md"
                    >
                      <SiDiscord className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                  {siteConfig.socialLinks?.email && (
                    <Link
                      href={`mailto:${siteConfig.socialLinks.email}`}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer nofollow noopener"
                      aria-label="Email"
                      title="Email"
                      className="hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md"
                    >
                      <MailIcon className="h-4 w-4" />
                    </Link>
                  )}
                </div>

                <BuiltWithButton />
              </div>
            </div>

            {footerLinks.map((section) => (
              <div key={section.title} className="flex-1">
                <div className="mb-4 text-lg font-semibold text-white">{section.title}</div>
                <ul className="space-y-2 text-sm">
                  {section.links
                    .filter((link) => link.href !== "/ja")
                    .map((link) => (
                      <li key={link.href}>
                      {link.href.startsWith("/") && !link.useA ? (
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
                    ))}
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
                href="/about"
                title={tFooter("About")}
                prefetch={false}
                className="text-sm text-gray-400 hover:text-white"
              >
                {tFooter("About")}
              </I18nLink>
              <Link
                href="/privacy-policy"
                title={tFooter("PrivacyPolicy")}
                prefetch={false}
                className="text-sm text-gray-400 hover:text-white"
              >
                {tFooter("PrivacyPolicy")}
              </Link>
              <Link
                href="/terms-of-service"
                title={tFooter("TermsOfService")}
                prefetch={false}
                className="text-sm text-gray-400 hover:text-white"
              >
                {tFooter("TermsOfService")}
              </Link>
              <Link
                href="/refund-policy"
                title={tFooter("RefundPolicy")}
                prefetch={false}
                className="text-sm text-gray-400 hover:text-white"
              >
                {tFooter("RefundPolicy")}
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
