import { listPublishedPostsAction } from "@/actions/posts/posts";
import { getViewCountAction } from "@/actions/posts/views";
import { ContentRestrictionMessage } from "@/components/cms/ContentRestrictionMessage";
import { POST_CONFIGS } from "@/components/cms/post-config";
import { PostCard } from "@/components/cms/PostCard";
import { RelatedPosts } from "@/components/cms/RelatedPosts";
import { ViewCounter } from "@/components/cms/ViewCounter";
import { TableOfContents } from "@/components/tiptap/TableOfContents";
import { renderPostMarkdown } from "@/lib/cms/render-markdown";
import { Button } from "@/components/ui/button";
import { PRICING_PATH } from "@/config/public-paths";
import { Link as I18nLink, Locale, LOCALES } from "@/i18n/routing";
import { glossaryCms } from "@/lib/cms";
import { constructMetadata } from "@/lib/metadata";
import { PostBase } from "@/types/cms";
import dayjs from "dayjs";
import { ArrowLeftIcon, CalendarIcon, EyeIcon } from "lucide-react";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { notFound } from "next/navigation";

export const dynamicParams = true;

type Params = Promise<{
  locale: string;
  slug: string;
}>;

type MetadataProps = {
  params: Params;
};

export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const { metadata: postMetadata } = await glossaryCms.getPostMetadata(slug, locale);

  if (!postMetadata) {
    return constructMetadata({
      title: "404",
      description: "Page not found",
      noIndex: true,
      locale: locale as Locale,
      path: `/glossary/${slug}`,
    });
  }

  const metadataPath = slug.startsWith("/") ? slug : `/${slug}`;
  const fullPath = `/glossary${metadataPath}`;

  // Detect which locales have this glossary entry available
  const availableLocales: string[] = [];
  for (const checkLocale of LOCALES) {
    const { metadata: localeMetadata } = await glossaryCms.getPostMetadata(slug, checkLocale);
    if (localeMetadata) {
      availableLocales.push(checkLocale);
    }
  }

  return constructMetadata({
    title: postMetadata.title,
    description: postMetadata.description || undefined,
    images: postMetadata.featuredImageUrl ? [postMetadata.featuredImageUrl] : undefined,
    locale: locale as Locale,
    path: fullPath,
    noIndex: postMetadata.visibility !== "public",
    availableLocales: availableLocales.length > 0 ? availableLocales : undefined,
    useDefaultOgImage: false, // Use dynamic opengraph-image.tsx when no featured image
  });
}

export default async function GlossaryPage({ params }: { params: Params }) {
  const { slug, locale } = await params;
  const t = await getTranslations("Glossary");

  const { post, errorCode } = await glossaryCms.getBySlug(slug, locale);

  if (!post) {
    notFound();
  }

  // View count tracking
  const viewCountConfig = POST_CONFIGS.glossary.viewCount;
  let viewCount = 0;

  if (viewCountConfig.enabled && viewCountConfig.showInUI) {
    // Only get view count for display, incrementing is done in Client Component
    const viewCountResult = await getViewCountAction({
      slug,
      postType: "glossary",
      locale,
    });
    viewCount =
      viewCountResult.success && viewCountResult.data?.count ? viewCountResult.data.count : 0;
  }

  let showRestrictionMessageInsteadOfContent = false;
  let messageTitle = "";
  let messageContent = "";
  let actionText = "";
  let actionLink = "";

  if (errorCode) {
    showRestrictionMessageInsteadOfContent = true;
    const redirectUrl = `/glossary/${slug}`;

    if (errorCode === "unauthorized") {
      messageTitle = t("GlossaryDetail.accessRestricted");
      messageContent = t("GlossaryDetail.unauthorized");
      actionText = t("GlossaryDetail.signIn");
      actionLink = `/login?next=${encodeURIComponent(redirectUrl)}`;
    } else if (errorCode === "notSubscriber") {
      messageTitle = t("GlossaryDetail.premium");
      messageContent = t("GlossaryDetail.premiumContent");
      actionText = t("GlossaryDetail.upgrade");
      actionLink = PRICING_PATH;
    }
  }

  const tagsArray = post.tags
    ? post.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag)
    : [];

  const getVisibilityInfo = () => {
    switch (post.visibility) {
      case "subscribers":
        return {
          label: "Subscribers Only",
          bgColor: "bg-purple-600",
        };
      case "logged_in":
        return {
          label: "Members Only",
          bgColor: "bg-blue-600",
        };
      default:
        return {
          label: "Public",
          bgColor: "bg-green-600",
        };
    }
  };

  const visibilityInfo = getVisibilityInfo();

  const contentHtml =
    !showRestrictionMessageInsteadOfContent && post.content
      ? await renderPostMarkdown(post.content)
      : "";

  return (
    <div className="container mx-auto px-4 py-12">
      <ViewCounter
        slug={slug}
        postType="glossary"
        trackView={viewCountConfig.enabled}
        trackMode={viewCountConfig.mode}
      />
      <div className="flex gap-8">
        {/* Main Content */}
        <div className="min-w-0 flex-1">
          <div className="mb-8">
            <Button asChild variant="ghost" size="sm" className="group">
              <I18nLink
                href="/glossary"
                title={t("GlossaryDetail.backToGlossary")}
                prefetch={false}
              >
                <ArrowLeftIcon className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
                {t("GlossaryDetail.backToGlossary")}
              </I18nLink>
            </Button>
          </div>

          <header className="mb-12">
            {post.visibility !== "public" && (
              <div
                className={`${visibilityInfo.bgColor} mb-6 inline-flex rounded-full px-3 py-1 text-xs text-white`}
              >
                {visibilityInfo.label}
              </div>
            )}

            <h1 className="mb-6 text-4xl leading-tight font-bold md:text-5xl">{post.title}</h1>

            <div className="text-muted-foreground mb-8 flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dayjs(post.publishedAt).format("MMMM D, YYYY")}
              </div>

              {viewCountConfig.enabled && viewCountConfig.showInUI && viewCount > 0 && (
                <div className="flex items-center">
                  <EyeIcon className="mr-2 h-4 w-4" />
                  {t("GlossaryDetail.viewCount", { count: viewCount })}
                </div>
              )}

              {post.isPinned && (
                <div className="flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                  {t("GlossaryDetail.featured")}
                </div>
              )}
            </div>

            {post.description && (
              <div className="bg-muted mb-8 rounded-lg p-6 text-lg">{post.description}</div>
            )}
          </header>

          {post.featuredImageUrl && (
            <div className="relative my-10 aspect-video overflow-hidden rounded-xl shadow-md">
              <Image
                src={post.featuredImageUrl}
                alt={post.title}
                fill
                sizes="(max-width: 768px) 100vw, 1200px"
                priority
                className="object-cover"
              />
            </div>
          )}

          {tagsArray.length > 0 && (
            <div className="mb-10 flex flex-wrap gap-2">
              {tagsArray.map((tag) => (
                <div
                  key={tag}
                  className="bg-secondary/80 hover:bg-secondary rounded-full px-3 py-1 text-sm font-medium transition-colors"
                >
                  {tag}
                </div>
              ))}
            </div>
          )}

          {/* Mobile TOC */}
          {post.content && (
            <div className="mb-8 xl:hidden">
              <TableOfContents content={post.content} mobile />
            </div>
          )}

          {showRestrictionMessageInsteadOfContent ? (
            <ContentRestrictionMessage
              title={messageTitle}
              message={messageContent}
              actionText={actionText}
              actionLink={actionLink}
              backText={t("GlossaryDetail.backToGlossary")}
              backLink={`/glossary`}
            />
          ) : contentHtml ? (
            <article
              className="prose prose-sm dark:prose-invert prose-headings:font-bold prose-headings:tracking-tight prose-a:text-primary prose-img:rounded-xl prose-img:shadow-md prose-p:my-2 prose-p:leading-relaxed max-w-none"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          ) : null}

          {/* Related Posts */}
          {post.id && (
            <RelatedPosts
              postId={post.id}
              postType="glossary"
              limit={10}
              title="Related Glossary Entries"
              locale={locale}
              CardComponent={GlossaryEntryCard}
            />
          )}

          <div className="mt-16 border-t pt-8">
            <Button asChild variant="outline" size="sm">
              <I18nLink
                href="/glossary"
                title={t("GlossaryDetail.backToGlossary")}
                prefetch={false}
                className="inline-flex items-center"
              >
                <ArrowLeftIcon className="mr-2 h-4 w-4" />
                {t("GlossaryDetail.backToGlossary")}
              </I18nLink>
            </Button>
          </div>
        </div>

        {/* PC TOC - Sidebar */}
        {post.content && (
          <aside className="hidden w-64 shrink-0 xl:block">
            <div className="sticky top-48">
              <TableOfContents content={post.content} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

const GlossaryEntryCard = ({ post }: { post: PostBase }) => (
  <PostCard post={post} baseUrl="/glossary" />
);

export async function generateStaticParams() {
  const allParams: { locale: string; slug: string }[] = [];

  for (const locale of LOCALES) {
    const serverResult = await listPublishedPostsAction({
      locale: locale,
      pageSize: 1000,
      postType: "glossary",
    });
    if (serverResult.success && serverResult.data?.posts) {
      serverResult.data.posts.forEach((post: { slug: string | null }) => {
        const slugPart = post.slug?.replace(/^\//, "").replace(/^glossary\//, "");
        if (slugPart) {
          allParams.push({ locale, slug: slugPart });
        }
      });
    }
  }

  const uniqueParams = Array.from(
    new Map(allParams.map((p) => [`${p.locale}-${p.slug}`, p])).values(),
  );
  return uniqueParams;
}
