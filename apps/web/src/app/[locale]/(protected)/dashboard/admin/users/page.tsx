import { constructMetadata } from "@/lib/metadata";
import { requireValidatedLocale } from "@/i18n/validated-locale";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { columns } from "./Columns";
import { DataTable } from "./DataTable";

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
    namespace: "Users",
  });

  return constructMetadata({
    page: "Users",
    title: t("title"),
    description: t("description"),
    locale: validatedLocale,
    path: `/dashboard/admin/users`,
  });
}

const PAGE_SIZE = 100;

export default function AdminUsersPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <DataTable columns={columns} pageSize={PAGE_SIZE} />
    </div>
  );
}
