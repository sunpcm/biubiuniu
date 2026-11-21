export const BLOGS_IMAGE_PATH = "blog-images";
export const GLOSSARY_IMAGE_PATH = "glossary-images";

export const ADMIN_UPLOAD_IMAGE_PATH = "admin-uploaded-images";

export const AVATARS_PATH = "avatars";

/** Anonymous writable scratch prefix. Anonymous presigned uploads are only
 *  allowed under this directory; they must never reach user avatars or admin
 *  CMS material. */
export const PUBLIC_UPLOAD_SCRATCH_PATH = "public-uploads";

/** Object prefixes that may be downloaded without authentication (read-only
 *  public material such as blog and glossary images). */
export const PUBLIC_READ_PREFIXES = [
  BLOGS_IMAGE_PATH,
  GLOSSARY_IMAGE_PATH,
] as const;

/** Object prefixes that admin CMS uploads may target. */
export const ADMIN_IMAGE_PREFIXES = [
  ADMIN_UPLOAD_IMAGE_PATH,
  BLOGS_IMAGE_PATH,
  GLOSSARY_IMAGE_PATH,
] as const;

/** ISO code (lowercase) of the site's primary currency: the figure shown and
 *  sorted in money columns when a user paid in several currencies, and the
 *  fallback when a formatter gets no currency. Providers disagree on case
 *  (Stripe "usd", PayPal "USD"), so everything compares lowercased. */
export const DEFAULT_CURRENCY = (
  process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "usd"
).toLowerCase();

/** User avatar directory (shared by actions/users/settings for uploads and for
 *  deleting the replaced avatar; account deletion cleanup
 *  (lib/storage/account-purge) enumerates a user's avatar objects by this prefix) */
export const userAvatarsPath = (userId: string) => `${AVATARS_PATH}/${userId}`;

export interface R2Category {
  name: string;
  prefix: string;
}

export const R2_CATEGORIES: R2Category[] = [
  { name: "All", prefix: "" },
  {
    name: "Admin Uploads",
    prefix: `${ADMIN_UPLOAD_IMAGE_PATH}/`,
  },
  {
    name: "Blogs Images",
    prefix: `${BLOGS_IMAGE_PATH}/`,
  },
  {
    name: "Glossary Images",
    prefix: `${GLOSSARY_IMAGE_PATH}/`,
  },
];
