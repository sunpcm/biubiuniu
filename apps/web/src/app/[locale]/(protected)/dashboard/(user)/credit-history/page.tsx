/**
 * [INPUT]: Depends on @/lib/metadata's constructMetadata, next-intl/server's
 *          getTranslations, ./CreditHistoryDataTable
 * [OUTPUT]: Exports the CreditHistoryPage page component and generateMetadata
 * [POS]: The entry point of dashboard/(user)/credit-history — the standalone
 *        page for personal credit transactions, sharing its source with the
 *        billing page's credit records (getMyCreditHistory); this page carries
 *        the large paginated detail view
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { constructMetadata } from "@/lib/metadata";
import { requireValidatedLocale } from "@/i18n/validated-locale";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CreditHistoryDataTable } from "./CreditHistoryDataTable";

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
    namespace: "CreditHistory",
  });

  return constructMetadata({
    page: "CreditHistory",
    title: t("title"),
    description: t("description"),
    locale: validatedLocale,
    path: `/dashboard/credit-history`,
  });
}

const PAGE_SIZE = 100;

export default function CreditHistoryPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <CreditHistoryDataTable pageSize={PAGE_SIZE} />
    </div>
  );
}
