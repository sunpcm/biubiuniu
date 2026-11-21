import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, mock, test } from "node:test";
import { eq } from "drizzle-orm";

import { closeDatabase, db } from "@/lib/db";
import {
  postTags,
  posts as postsTable,
  tags as tagsTable,
  user as userTable,
} from "@/lib/db/schema";
import { migrate, resetSyntheticData } from "./helpers";

interface Actor {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin" | "superadmin";
}

let actor: Actor | null = null;

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));

mock.module("@/lib/auth/server", {
  exports: {
    getSession: async () =>
      actor
        ? {
            user: {
              id: actor.id,
              email: actor.email,
              name: actor.name,
              role: actor.role,
            },
          }
        : null,
    isAdmin: async () => actor?.role === "admin" || actor?.role === "superadmin",
    isSuperAdmin: async () => actor?.role === "superadmin",
  },
});

mock.module(appRequire.resolve("next/cache"), {
  exports: {
    revalidatePath: () => undefined,
  },
});

let adminUser: Actor;
let normalUser: Actor;

async function createUser(prefix: string, role: Actor["role"]): Promise<Actor> {
  const [row] = await db
    .insert(userTable)
    .values({
      email: `${prefix}-${crypto.randomUUID()}@example.invalid`,
      name: `${prefix} user`,
      role,
    })
    .returning({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      role: userTable.role,
    });
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? `${prefix} user`,
    role: row.role,
  };
}

function postInput(slug: string, tagId?: string) {
  return {
    language: "en",
    title: "Transactional CMS post",
    slug,
    content: "Safe content",
    description: "A post used by the application regression",
    tags: tagId ? [{ id: tagId, name: "Regression" }] : [],
    featuredImageUrl: "",
    status: "draft" as const,
    visibility: "public" as const,
    isPinned: false,
  };
}

before(async () => {
  await migrate();
});

beforeEach(async () => {
  await resetSyntheticData();
  adminUser = await createUser("cms-admin", "superadmin");
  normalUser = await createUser("cms-user", "user");
  actor = null;
});

after(async () => {
  await closeDatabase();
});

test("CMS rejects anonymous and ordinary-user writes before touching posts", async () => {
  const { createPostAction } = await import("@/actions/posts/posts");

  actor = null;
  const anonymous = await createPostAction({
    data: postInput("anonymous-write"),
    postType: "blog",
  });
  if (anonymous.success) assert.fail("anonymous CMS write unexpectedly succeeded");
  assert.ok(anonymous.error);
  assert.match(anonymous.error, /Admin privileges/);

  actor = normalUser;
  const ordinary = await createPostAction({
    data: postInput("ordinary-write"),
    postType: "blog",
  });
  if (ordinary.success) assert.fail("ordinary CMS write unexpectedly succeeded");
  assert.ok(ordinary.error);
  assert.match(ordinary.error, /Admin privileges/);

  const rows = await db.select({ id: postsTable.id }).from(postsTable);
  assert.equal(rows.length, 0);
});

test("CMS post and tag associations commit together", async () => {
  const { createPostAction, updatePostAction } = await import("@/actions/posts/posts");
  actor = adminUser;
  const [tag] = await db
    .insert(tagsTable)
    .values({ name: `commit-${crypto.randomUUID()}`, postType: "blog" })
    .returning({ id: tagsTable.id });

  const result = await createPostAction({
    data: postInput(`commit-${crypto.randomUUID()}`, tag.id),
    postType: "blog",
  });
  if (!result.success) assert.fail(result.error);
  const postId = result.data?.postId;
  assert.ok(postId);

  const associations = await db
    .select({ postId: postTags.postId, tagId: postTags.tagId })
    .from(postTags)
    .where(eq(postTags.postId, postId));
  assert.deepEqual(associations, [{ postId, tagId: tag.id }]);

  const [replacementTag] = await db
    .insert(tagsTable)
    .values({ name: `replacement-${crypto.randomUUID()}`, postType: "blog" })
    .returning({ id: tagsTable.id });
  const updatedSlug = `updated-${crypto.randomUUID()}`;
  const updated = await updatePostAction({
    data: {
      ...postInput(updatedSlug, replacementTag.id),
      id: postId,
      title: "Committed CMS update",
      content: "Updated safe content",
    },
  });
  if (!updated.success) assert.fail(updated.error);

  const [storedPost] = await db
    .select({ title: postsTable.title, slug: postsTable.slug, content: postsTable.content })
    .from(postsTable)
    .where(eq(postsTable.id, postId));
  assert.deepEqual(storedPost, {
    title: "Committed CMS update",
    slug: updatedSlug,
    content: "Updated safe content",
  });
  const replacedAssociations = await db
    .select({ tagId: postTags.tagId })
    .from(postTags)
    .where(eq(postTags.postId, postId));
  assert.deepEqual(replacedAssociations, [{ tagId: replacementTag.id }]);
});

test("CMS rolls back the whole create when a tag association fails", async () => {
  const { createPostAction } = await import("@/actions/posts/posts");
  actor = adminUser;

  const result = await createPostAction({
    data: postInput(`rollback-${crypto.randomUUID()}`, crypto.randomUUID()),
    postType: "blog",
  });

  assert.equal(result.success, false);
  const rows = await db.select({ id: postsTable.id }).from(postsTable);
  assert.equal(rows.length, 0);
});

test("CMS rolls back update, tag deletion and replacement on association failure", async () => {
  const { createPostAction, updatePostAction } = await import("@/actions/posts/posts");
  actor = adminUser;

  const [tag] = await db
    .insert(tagsTable)
    .values({ name: `preserve-${crypto.randomUUID()}`, postType: "blog" })
    .returning({ id: tagsTable.id });
  const slug = `update-${crypto.randomUUID()}`;
  const created = await createPostAction({
    data: postInput(slug, tag.id),
    postType: "blog",
  });
  if (!created.success) assert.fail(created.error);
  const postId = created.data?.postId;
  assert.ok(postId);

  const result = await updatePostAction({
    data: {
      ...postInput(slug, crypto.randomUUID()),
      id: postId,
      title: "Title that must roll back",
      content: "Content that must roll back",
    },
  });
  assert.equal(result.success, false);

  const [post] = await db
    .select({ title: postsTable.title, content: postsTable.content })
    .from(postsTable)
    .where(eq(postsTable.id, postId));
  assert.equal(post.title, "Transactional CMS post");
  assert.equal(post.content, "Safe content");

  const associations = await db
    .select({ tagId: postTags.tagId })
    .from(postTags)
    .where(eq(postTags.postId, postId));
  assert.deepEqual(associations, [{ tagId: tag.id }]);
});
