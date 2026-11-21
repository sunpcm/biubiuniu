/**
 * Ban law. Thin re-export of `@sunpcm/niu-auth`; the page-level fresh guard and
 * the SDK/HTTP write boundary consume the same predicate and path allowlists.
 */
export {
  isBanActive,
  BANNED_USER_ALLOWED_PATHS,
  BANNED_USER_READ_ONLY_PATHS,
} from "@sunpcm/niu-auth";
