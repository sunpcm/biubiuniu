import LocaleSwitcher from "@/components/LocaleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import HeaderLinks from "@/components/header/HeaderLinks";
import MobileMenu from "@/components/header/MobileMenu";
import { Separator } from "@niu/ui/separator";
import { SidebarTrigger } from "@niu/ui/sidebar";

export default async function SidebarInsetHeader() {
  return (
    <header className="sticky top-0 z-50 w-full px-4 py-2 backdrop-blur-md">
      <nav className="mx-auto flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <HeaderLinks />
        </div>

        <div className="flex flex-1 items-center justify-end gap-x-2">
          {/* PC */}
          <div className="hidden items-center gap-x-2 lg:flex">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>

          {/* Mobile */}
          <div className="flex lg:hidden">
            <MobileMenu />
          </div>
        </div>
      </nav>
    </header>
  );
}
