/**
 * [INPUT]: Depends on ./Columns for columns, ./DataTable for CouponsDataTable,
 *          @/lib/stripe for isStripeEnabled, @/lib/metadata for
 *          constructMetadata, next-intl/server for getTranslations
 * [OUTPUT]: Exports default AdminCouponsPage, generateMetadata
 * [POS]: The route entry of admin/coupons (Server Component). It only builds
 *        metadata and hands the table its data source; the Stripe availability
 *        flag is read here because that env-derived answer never reaches the
 *        client on its own
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { constructMetadata } from "@/lib/metadata";
import { isStripeEnabled } from "@/lib/stripe";
import { requireValidatedLocale } from "@/i18n/validated-locale";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { columns } from "./Columns";
import { CouponsDataTable } from "./DataTable";

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
    namespace: "Coupons",
  });

  return constructMetadata({
    title: t("title"),
    description: t("description"),
    locale: validatedLocale,
    path: `/dashboard/admin/coupons`,
  });
}

const PAGE_SIZE = 20;

export default function AdminCouponsPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <CouponsDataTable
        columns={columns}
        pageSize={PAGE_SIZE}
        stripeEnabled={isStripeEnabled}
      />
    </div>
  );
}
