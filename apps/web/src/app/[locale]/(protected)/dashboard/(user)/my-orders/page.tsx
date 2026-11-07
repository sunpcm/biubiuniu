/**
 * [INPUT]: Depends on @/lib/metadata for constructMetadata, next-intl/server for
 *          getTranslations, @/i18n/routing for the Locale type, ./DataTable
 *          (which in turn consumes ./Columns)
 * [OUTPUT]: Exports the MyOrdersPage page component and generateMetadata
 * [POS]: The entry of dashboard/(user)/my-orders — a standalone page for the
 *        user's order history, sharing its source with the billing page's
 *        purchase records (getMyOrders); this page carries the large paginated
 *        detail view
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { Locale } from "@/i18n/routing";
import { constructMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MyOrdersDataTable } from "./DataTable";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "MyOrders" });

  return constructMetadata({
    title: t("title"),
    description: t("description"),
    locale: locale as Locale,
    path: "/dashboard/my-orders",
  });
}

const PAGE_SIZE = 100;

export default function MyOrdersPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <MyOrdersDataTable pageSize={PAGE_SIZE} />
    </div>
  );
}
