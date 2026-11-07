/**
 * [INPUT]: Depends on @/lib/metadata for constructMetadata, next-intl for locale handling,
 *          ./Columns for column definitions, ./DataTable for FeedbackDataTable component
 * [OUTPUT]: Exports AdminFeedbackPage (default) and generateMetadata
 * [POS]: Admin feedback list page, renders the data table with server-side pagination
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { constructMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import { Locale } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { columns } from "./Columns";
import { FeedbackDataTable } from "./DataTable";

type Params = Promise<{ locale: string }>;

type MetadataProps = {
  params: Params;
};

export async function generateMetadata({
  params,
}: MetadataProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Feedback" });

  return constructMetadata({
    title: t("admin.title"),
    description: t("admin.description"),
    locale: locale as Locale,
    path: "/dashboard/admin/feedbacks",
  });
}

const PAGE_SIZE = 20;

export default function AdminFeedbackPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <FeedbackDataTable columns={columns} pageSize={PAGE_SIZE} />
    </div>
  );
}
