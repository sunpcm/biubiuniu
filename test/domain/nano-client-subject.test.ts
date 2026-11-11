/**
 * Client-side Nano identity scoping. The server authorizes task reads by the
 * balance-owning subject, so the remembered "last task" must be keyed the same
 * way: a workspace switch by the same user is a different subject.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { nanoSubjectKey } from "@sunpcm/niu-feature-nano";
import {
  NANO_LEGACY_LOCAL_TASK_KEY,
  nanoClientSubjectKey,
  nanoLocalTaskKey,
} from "@/components/nano/contract";

test("client subject key mirrors the server subject key", () => {
  assert.equal(nanoClientSubjectKey(null, null), null);
  assert.equal(nanoClientSubjectKey(undefined, "o1"), null);
  assert.equal(
    nanoClientSubjectKey("u1", null),
    nanoSubjectKey({ userId: "u1", organizationId: null }),
  );
  assert.equal(
    nanoClientSubjectKey("u1", "o1"),
    nanoSubjectKey({ userId: null, organizationId: "o1" }),
  );
});

test("the remembered task is scoped per subject and never reuses the legacy key", () => {
  const personal = nanoLocalTaskKey(nanoClientSubjectKey("u1", null)!);
  const team = nanoLocalTaskKey(nanoClientSubjectKey("u1", "o1")!);
  const other = nanoLocalTaskKey(nanoClientSubjectKey("u2", null)!);
  assert.equal(new Set([personal, team, other, NANO_LEGACY_LOCAL_TASK_KEY]).size, 4);
  assert.equal(NANO_LEGACY_LOCAL_TASK_KEY, "nexty:nano:last-task-id:v1");
});
