/**
 * [INPUT]: Depends on @/config/common's userAvatarsPath (source of truth for
 *          the key path convention), @/lib/cloudflare/r2's listR2Objects/deleteFile
 * [OUTPUT]: exports purgeUserArtifacts (account-deletion cleanup: enumerates
 *           the user's directory prefixes and deletes every R2 object of that
 *           user — currently only avatars/{userId}/ avatars; generated
 *           artifacts are not persisted under an R2 user prefix and kie-tmp is
 *           an ownerless scratch area, so neither is covered here)
 * [POS]: The account-deletion cleaner of lib/storage, consumed by
 *        actions/users/admin's deleteUserAccount; must run before the row is
 *        deleted (path enumeration does not depend on the DB, but the order is
 *        deliberate: purge objects first, then delete the row — a throw aborts
 *        the account deletion)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { userAvatarsPath } from '@/config/common'
import { deleteFile, listR2Objects } from '@/lib/cloudflare/r2'

// User assets are nested under userId as a directory level (avatars/{userId}/),
// so enumerating by directory prefix hits exactly all objects of a single user
// and can never touch another's. Extend this when adding user-scoped R2 prefixes.
const userArtifactPrefixes = (userId: string) => [`${userAvatarsPath(userId)}/`]

/**
 * Account-deletion cleanup: delete every R2 object under the user's prefixes.
 *
 * Must run BEFORE the user row is deleted. A thrown error aborts the account
 * deletion; retry converges because DeleteObject is idempotent.
 * When R2 is unconfigured (local development) there is nothing to delete —
 * return immediately.
 */
export async function purgeUserArtifacts(
  userId: string
): Promise<{ deletedObjects: number }> {
  let deletedObjects = 0

  if (process.env.R2_BUCKET_NAME) {
    for (const prefix of userArtifactPrefixes(userId)) {
      // Page sequentially with a continuation token. The token is a cursor in
      // key order, so deleting already-listed objects does not affect later pages.
      let continuationToken: string | undefined
      do {
        const result = await listR2Objects({
          prefix,
          pageSize: 1000,
          continuationToken,
        })
        if (result.error) {
          throw new Error(
            `Failed to list user artifacts (${prefix}): ${result.error}`
          )
        }

        for (const object of result.objects) {
          await deleteFile(object.key)
          deletedObjects++
        }
        continuationToken = result.nextContinuationToken
      } while (continuationToken)
    }
  }

  console.log(
    `[account-purge] deleted ${deletedObjects} R2 objects for user ${userId}`
  )
  return { deletedObjects }
}
