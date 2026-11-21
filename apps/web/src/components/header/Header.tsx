/**
 * [INPUT]: Depends on the Home i18n title, getSession from @/lib/auth/server,
 *          sibling header/ components (HeaderLinks/MobileMenu/UserAvatar),
 *          LocaleSwitcher/ThemeToggle and the font-brand brand-face utility
 * [OUTPUT]: Exports the Header server component (site top bar: logo + brand title + nav)
 * [POS]: Entry shell of components/header, consumed by the public basic-layout;
 *        the brand title shares font-brand with MobileMenu/Footer/DashboardSidebar
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */
import HeaderLinks from "@/components/header/HeaderLinks";
import MobileMenu from "@/components/header/MobileMenu";
import { UserAvatar } from "@/components/header/UserAvatar";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Link as I18nLink } from "@/i18n/routing";
import { getSession } from "@/lib/auth/server";
import { user as userSchema } from "@/lib/db/schema";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
type User = typeof userSchema.$inferSelect;

const Header = async () => {
  const t = await getTranslations("Home");
  const session = await getSession();
  const user = session?.user;

  return (
    <header className="sticky top-0 z-50 py-2 backdrop-blur-md">
      <nav className="max-w-8xl container mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-6 md:space-x-12">
          <I18nLink
            href="/"
            title={t("title")}
            prefetch={true}
            className="flex items-center space-x-1"
          >
            <Image
              src="/logo.png"
              alt={t("title")}
              width={100}
              height={26}
              className="h-auto w-auto max-w-[100px]"
              priority
            />
          </I18nLink>

          <HeaderLinks />
        </div>

        <div className="flex flex-1 items-center justify-end gap-x-2">
          {/* PC */}
          <div className="hidden items-center gap-x-2 lg:flex">
            <LocaleSwitcher />
            <ThemeToggle />
            <UserAvatar user={user as User} />
          </div>

          {/* Mobile */}
          <div className="flex items-center gap-x-2 lg:hidden">
            <UserAvatar user={user as User} />
            <MobileMenu />
          </div>
        </div>
      </nav>
    </header>
  );
};

export default Header;
