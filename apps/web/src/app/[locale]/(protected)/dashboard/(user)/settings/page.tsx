import { getSession } from "@/lib/auth/server";
import { user as userSchema } from "@/lib/db/schema";
import { constructMetadata } from "@/lib/metadata";
import { requireValidatedLocale } from "@/i18n/validated-locale";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Settings from "./Setting";

type User = typeof userSchema.$inferSelect;

type Params = Promise<{ locale: string }>;

type MetadataProps = {
  params: Params;
};

export async function generateMetadata({
  params,
}: MetadataProps): Promise<Metadata> {
  const { locale } = await params;
  const validatedLocale = requireValidatedLocale(locale);
  const t = await getTranslations({
    locale: validatedLocale,
    namespace: "Settings",
  });

  return constructMetadata({
    page: "Settings",
    title: t("title"),
    description: t("description"),
    locale: validatedLocale,
    path: `/dashboard/settings`,
  });
}

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <Settings user={session.user as User} />;
}
