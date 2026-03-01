import { getRelatedPostsAction } from "@/actions/posts/posts";
import { PostType } from "@/lib/db/schema";
import { PostBase, PublicPost } from "@/types/cms";
import dayjs from "dayjs";
import { ReactElement } from "react";

interface RelatedPostsProps {
  postId: string;
  postType: PostType;
  locale: string;
  limit?: number;
  title?: string;
  CardComponent: React.ComponentType<{ post: PostBase }>;
}

function mapPublicPostToBlogPost(post: PublicPost): PostBase {
  return {
    locale: post.language,
    title: post.title,
    description: post.description ?? "",
    featuredImageUrl: post.featuredImageUrl ?? "/placeholder.svg",
    slug: post.slug,
    publishedAt: (post.publishedAt && dayjs(post.publishedAt).toDate()) || new Date(),
    status: post.status ?? "published",
    visibility: post.visibility ?? "public",
    isPinned: post.isPinned ?? false,
    content: "",
  };
}

export async function RelatedPosts({
  postId,
  postType,
  locale,
  limit = 10,
  title = "Related Posts",
  CardComponent,
}: RelatedPostsProps): Promise<ReactElement | null> {
  const relatedResult = await getRelatedPostsAction({
    postId,
    postType,
    locale,
    limit,
  });

  if (!relatedResult.success || !relatedResult.data?.posts) {
    return null;
  }

  const relatedPosts = relatedResult.data.posts;

  if (relatedPosts.length === 0) {
    return null;
  }

  const posts = relatedPosts.map(mapPublicPostToBlogPost);

  return (
    <div className="mt-16 border-t pt-8">
      <h2 className="mb-6 text-2xl font-bold md:text-3xl">{title}</h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <CardComponent key={post.slug} post={post} />
        ))}
      </div>
    </div>
  );
}
