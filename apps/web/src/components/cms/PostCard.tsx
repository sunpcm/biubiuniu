import { Link as I18nLink } from "@/i18n/routing";
import { PostBase } from "@/types/cms";
import dayjs from "dayjs";
import { ArrowRightIcon, EyeIcon, LockIcon, PinIcon, UserIcon } from "lucide-react";
import Image from "next/image";

interface PostCardProps {
  post: PostBase;
  baseUrl: string;
  showDescription?: boolean;
  showCover?: boolean;
}

function getVisibilityInfo(visibility: string) {
  switch (visibility) {
    case "subscribers":
      return {
        label: "Subscribers",
        icon: <LockIcon className="h-3 w-3" />,
        bgColor: "bg-purple-600/90",
        borderColor: "from-purple-500 to-purple-600",
      };
    case "logged_in":
      return {
        label: "Members",
        icon: <UserIcon className="h-3 w-3" />,
        bgColor: "bg-blue-600/90",
        borderColor: "from-blue-500 to-blue-600",
      };
    default:
      return {
        label: "Public",
        icon: <EyeIcon className="h-3 w-3" />,
        bgColor: "bg-green-600/90",
        borderColor: "from-primary to-primary/70",
      };
  }
}

function PostCardCover({ post, baseUrl, showDescription }: Omit<PostCardProps, "showCover">) {
  const visibilityInfo = getVisibilityInfo(post.visibility || "public");

  return (
    <I18nLink
      href={`${baseUrl}/${post.slug}`}
      title={post.title}
      prefetch={false}
      className="group block h-full focus:outline-none"
    >
      <div className="bg-card flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:border-gray-800">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden">
          <Image
            src={post.featuredImageUrl || "/placeholder.svg"}
            alt={post.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />

          <div className="absolute top-3 right-3 flex gap-2">
            {post.isPinned && (
              <div className="rounded-full bg-amber-500/90 p-1.5 text-white" title="Pinned Post">
                <PinIcon className="h-3.5 w-3.5" />
              </div>
            )}
            <div
              className={`${visibilityInfo.bgColor} flex items-center gap-1 rounded-full px-2 py-1 text-xs text-white`}
              title={visibilityInfo.label}
            >
              {visibilityInfo.icon}
              <span className="text-xs">{visibilityInfo.label}</span>
            </div>
          </div>

          <div className="absolute bottom-3 left-3 rounded-full bg-slate-900/80 px-2.5 py-1 text-xs text-white">
            {dayjs(post.publishedAt).format("MMM D, YYYY")}
          </div>
        </div>

        <div className="flex flex-1 flex-col p-4">
          <h2 className="group-hover:text-primary mb-2 line-clamp-2 text-lg font-medium transition-colors">
            {post.title}
          </h2>

          {showDescription && post.description && (
            <p className="text-muted-foreground mt-auto line-clamp-2 text-sm">{post.description}</p>
          )}
        </div>
      </div>
    </I18nLink>
  );
}

function PostCardCompact({ post, baseUrl, showDescription }: Omit<PostCardProps, "showCover">) {
  const visibilityInfo = getVisibilityInfo(post.visibility || "public");

  return (
    <I18nLink
      href={`${baseUrl}/${post.slug}`}
      title={post.title}
      prefetch={false}
      className="group block w-full focus:outline-none"
    >
      <article className="hover:bg-muted/40 hover:border-border/40 flex flex-col gap-2 rounded-lg border border-transparent p-4 transition-all duration-200 group-hover:scale-[1.005] sm:flex-row sm:items-center sm:gap-6">
        {/* Date & Meta - Fixed width on desktop */}
        <div className="text-muted-foreground/70 flex items-center gap-3 text-xs sm:w-32 sm:shrink-0">
          <time dateTime={post.publishedAt.toISOString()} className="font-mono">
            {dayjs(post.publishedAt).format("MMM D, YYYY")}
          </time>
        </div>

        {/* Content - Flexible */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-foreground group-hover:text-primary line-clamp-1 flex items-center gap-2 text-base font-medium transition-colors sm:text-lg">
            {post.title}
            {post.isPinned && <PinIcon className="h-3.5 w-3.5 text-amber-500/80" />}
            {post.visibility !== "public" && (
              <div title={visibilityInfo.label} className="text-muted-foreground">
                {visibilityInfo.icon}
              </div>
            )}
          </h2>

          {showDescription && post.description && (
            <p className="text-muted-foreground mt-auto line-clamp-2 text-sm">{post.description}</p>
          )}
        </div>

        {/* Status Icons - Right side */}
        <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <ArrowRightIcon className="text-muted-foreground/50 h-4 w-4 -translate-x-1 transition-transform group-hover:translate-x-0" />
        </div>
      </article>
    </I18nLink>
  );
}

export function PostCard({
  post,
  baseUrl,
  showDescription = true,
  showCover = true,
}: PostCardProps) {
  if (showCover) {
    return <PostCardCover post={post} baseUrl={baseUrl} showDescription={showDescription} />;
  }

  return <PostCardCompact post={post} baseUrl={baseUrl} showDescription={showDescription} />;
}
