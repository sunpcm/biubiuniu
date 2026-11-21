"use server";

/**
 * [INPUT]: Depends on @/lib/auth/server's isAdmin, @/lib/signup-blocklist's read/write
 *          channel, @/lib/action-response, zod
 * [OUTPUT]: Exports getSignupBlocklistAdmin (the current rules, to populate the Sheet
 *          form) and updateSignupBlocklistAdmin (zod validation → Redis persistence;
 *          the signup hook reads live, so it takes effect at once, no revalidate),
 *          both admin-only; the rules are four groups: email prefix / suffix /
 *          exact plus IP
 * [POS]: The signup-blocklist operations entry of actions/users, consumed by
 *        admin/users' SignupBlocklistSheet, sibling to admin.ts (user management)
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { actionResponse, type ActionResult } from "@/lib/action-response";
import { isAdmin } from "@/lib/auth/server";
import { getErrorMessage } from "@/lib/error-utils";
import { redis } from "@/lib/redis";
import {
  getSignupBlocklist,
  saveSignupBlocklist,
  type SignupBlocklistConfig,
} from "@/lib/signup-blocklist";
import { z } from "zod";

// One rule ≤254 chars (the email address limit); each group gets a generous count
// cap to guard against pasting oversized text by mistake
const RuleSchema = z.string().trim().min(1).max(254);
const ConfigSchema = z.object({
  prefixes: z.array(RuleSchema).max(1000),
  suffixes: z.array(RuleSchema).max(1000),
  exact: z.array(RuleSchema).max(5000),
  ips: z.array(RuleSchema).max(5000),
});

export async function getSignupBlocklistAdmin(): Promise<
  ActionResult<SignupBlocklistConfig>
> {
  if (!(await isAdmin())) return actionResponse.forbidden();
  const config = await getSignupBlocklist(redis);
  return actionResponse.success(config);
}

export async function updateSignupBlocklistAdmin(
  input: SignupBlocklistConfig
): Promise<ActionResult> {
  if (!(await isAdmin())) return actionResponse.forbidden();

  const parsed = ConfigSchema.safeParse(input);
  if (!parsed.success) {
    return actionResponse.badRequest(parsed.error.issues[0]?.message);
  }

  try {
    // The save path lowercases and de-duplicates; the signup hook reads Redis live
    // on every request, so saving takes effect immediately
    await saveSignupBlocklist(parsed.data, redis);
    return actionResponse.success();
  } catch (error) {
    return actionResponse.error(getErrorMessage(error));
  }
}
