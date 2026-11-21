/**
 * [INPUT]: Depends on @/lib/metadata for constructMetadata, next-intl for i18n
 * [OUTPUT]: Exports MyFeedbacksPage server component with metadata generation
 * [POS]: Entry point for user feedback dashboard, renders FeedbackList
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { constructMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import { Locale } from "@/i18n/routing";
import { getTranslations } from "next-intl/server";
import { FeedbackList } from "./FeedbackList";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Feedback" });

  return constructMetadata({
    title: t("title"),
    description: t("description"),
    locale: locale as Locale,
    path: "/dashboard/my-feedbacks",
  });
}

export default function MyFeedbacksPage() {
  return (
    <div className="space-y-4">
      <FeedbackList />
    </div>
  );
}
