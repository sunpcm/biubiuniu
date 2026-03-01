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
    <header className="sticky top-0 z-50 px-6 py-2 backdrop-blur-md">
      <nav className="mx-auto flex w-full items-center justify-between">
        <div className="flex items-center space-x-6 md:space-x-12">
          <I18nLink
            href="/"
            title={t("title")}
            prefetch={true}
            className="flex items-center space-x-1"
          >
            <Image src="/logo.png" alt="Logo" width={100} height={0} />
            {/* <span className={cn("text-md font-medium")}>{t("title")}</span> */}
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
