import { listPostsAction } from "@/actions/posts/posts";
import { PostDataTable } from "@/components/cms/PostDataTable";
import { Locale } from "@/i18n/routing";
import { constructMetadata } from "@/lib/metadata";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { columns } from "./Columns";

const PAGE_SIZE = 100;

type Params = Promise<{ locale: string }>;

type MetadataProps = {
  params: Params;
};

export async function generateMetadata({
  params,
}: MetadataProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "DashboardBlogs",
  });

  return constructMetadata({
    title: t("title"),
    description: t("description"),
    locale: locale as Locale,
    path: `/dashboard/admin/blogs`,
  });
}

export default function AdminBlogsPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-6">
      <PostDataTable
        config={{
          postType: "blog",
          columns,
          listAction: listPostsAction,
          createUrl: "/dashboard/admin/blogs/new",
          enableTags: true,
          searchPlaceholder: "Search blogs...",
        }}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
