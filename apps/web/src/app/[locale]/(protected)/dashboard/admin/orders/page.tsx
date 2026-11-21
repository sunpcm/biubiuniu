/**
 * [INPUT]: Depends on ./Columns for columns, ./DataTable for OrdersDataTable,
 *          @/lib/metadata for constructMetadata, next-intl/server for
 *          getTranslations
 * [OUTPUT]: Exports default AdminOrdersPage, generateMetadata
 * [POS]: The route entry of admin/orders (Server Component), responsible only
 *        for metadata and assembly
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { constructMetadata } from "@/lib/metadata";
import { requireValidatedLocale } from "@/i18n/validated-locale";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { columns } from "./Columns";
import { OrdersDataTable } from "./DataTable";

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
    namespace: "Orders",
  });

  return constructMetadata({
    title: t("title"),
    description: t("description"),
    locale: validatedLocale,
    path: `/dashboard/admin/orders`,
  });
}

const PAGE_SIZE = 100;

export default function AdminOrdersPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <OrdersDataTable columns={columns} pageSize={PAGE_SIZE} />
    </div>
  );
}
