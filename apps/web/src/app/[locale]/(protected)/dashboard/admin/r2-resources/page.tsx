import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ADMIN_UPLOAD_IMAGE_PATH, BLOGS_IMAGE_PATH } from "@/config/common";
import { constructMetadata } from "@/lib/metadata";
import { requireValidatedLocale } from "@/i18n/validated-locale";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ImagesDataTable } from "./ImagesDataTable";

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
    namespace: "R2Files",
  });

  return constructMetadata({
    page: "R2 Resources",
    title: t("title"),
    description: t("description"),
    locale: validatedLocale,
    path: `/dashboard/admin/r2-resources`,
  });
}

const CATEGORIES = [
  { name: "All", prefix: "" },
  {
    name: "Admin Uploads",
    prefix: `${ADMIN_UPLOAD_IMAGE_PATH}/`,
  },
  { name: "Blogs Images", prefix: `${BLOGS_IMAGE_PATH}/` },
  { name: "Text to Image", prefix: "text-to-images/" },
  { name: "Image to Image", prefix: "image-to-images/" },
  { name: "Image to Video", prefix: "image-to-videos/" },
];

const PAGE_SIZE = 100;

export default function Page() {
  const defaultCategory = CATEGORIES[0].prefix;
  const r2PublicUrl = process.env.R2_PUBLIC_URL;

  return (
    <div className="flex flex-col flex-1 min-h-0 mt-6">
      <Tabs defaultValue={defaultCategory} className="flex flex-col flex-1 min-h-0">
        <TabsList>
          {CATEGORIES.map((cat) => (
            <TabsTrigger key={cat.prefix} value={cat.prefix}>
              {cat.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {CATEGORIES.map((cat) => (
          <TabsContent
            key={cat.prefix}
            value={cat.prefix}
            className="mt-0 flex flex-col flex-1 min-h-0"
          >
            <ImagesDataTable
              categoryPrefix={cat.prefix}
              r2PublicUrl={r2PublicUrl}
              pageSize={PAGE_SIZE}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
