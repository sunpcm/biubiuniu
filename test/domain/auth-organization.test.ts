import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, count, eq, gt, sql } from "drizzle-orm";

import { closeDatabase, db } from "@/lib/db";
import { user as userTable, member, invitation, subscriptions } from "@/lib/db/schema";
import { createServerGuards } from "@/lib/auth/guards";

import { migrate, resetSyntheticData } from "./helpers";
import { assembleAuth, authBaseUrl, siteUrl } from "./auth-assembly";

const { auth, handler, mail } = assembleAuth();
const BASE_URL = authBaseUrl();
const SITE_URL = siteUrl();

function uniqueEmail(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}@example.invalid`;
}

async function sendOtp(email: string): Promise<string> {
  const res = await handler.POST(
    new Request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE_URL },
      body: JSON.stringify({ email, type: "sign-in" }),
    }),
  );
  assert.equal(res.status, 200, "send-verification-otp should succeed");
  const last = mail.last();
  assert.ok(last, "OTP email should be recorded");
  return last!.options.reactProps?.otp as string;
}

async function signInOtpApi(email: string, otp: string): Promise<string> {
  const res = await auth.api.signInEmailOTP({
    body: { email, otp },
    returnHeaders: true,
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  assert.ok(setCookie, "OTP sign-in should set a session cookie");
  return setCookie.split(";")[0];
}

async function signInEmail(email: string): Promise<string> {
  const otp = await sendOtp(email);
  return signInOtpApi(email, otp);
}

async function signInNewUser(prefix: string) {
  const email = uniqueEmail(prefix);
  const cookie = await signInEmail(email);
  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.ok(row, "sign-in should create the user");
  return { email, userId: row.id, cookie };
}

async function createTeamOrg(ownerCookie: string, ownerUserId: string) {
  const org = await auth.api.createOrganization({
    body: { name: "team", slug: `team-${crypto.randomUUID()}` },
    headers: { cookie: ownerCookie },
  });
  assert.ok(org, "createOrganization should succeed");
  await db.insert(subscriptions).values({
    userId: ownerUserId,
    organizationId: org.id,
    planId: "team-monthly",
    provider: "stripe",
    providerSubscriptionId: `sub-${crypto.randomUUID()}`,
    status: "active",
    interval: "month",
  });
  return org;
}

async function pendingAndMembers(organizationId: string) {
  const [{ value: memberCount }] = await db
    .select({ value: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId));
  const [{ value: pendingCount }] = await db
    .select({ value: count() })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    );
  return { memberCount, pendingCount };
}

function guardsFor(cookie: string) {
  return createServerGuards({
    auth,
    db,
    getHeaders: async () => new Headers({ cookie }),
  });
}

/**
 * Force every `invitation` insert during `run` to an identical, past
 * `created_at`. Two racing invitations therefore share a timestamp and sort
 * BEFORE the earlier seeded rows, so the old "newest by (createdAt, id)"
 * heuristic can never identify the intruder's own row — the exact
 * ordering-independent failure R04 removes. The trigger and function are
 * dropped in `finally` so the shared fixture stays clean.
 */
async function withForcedInvitationTimestamp<T>(run: () => Promise<T>): Promise<T> {
  const suffix = crypto.randomUUID().replace(/-/g, "");
  const fnName = `force_invitation_created_at_${suffix}`;
  const triggerName = `trg_force_invitation_created_at_${suffix}`;

  await db.execute(sql`
    create or replace function ${sql.raw(fnName)}()
    returns trigger as $fn$
    begin
      new.created_at := '2026-01-01 00:00:00+00'::timestamptz;
      return new;
    end;
    $fn$ language plpgsql
  `);
  await db.execute(sql`
    create trigger ${sql.raw(triggerName)}
    before insert on invitation
    for each row execute function ${sql.raw(fnName)}()
  `);

  try {
    return await run();
  } finally {
    await db.execute(sql`drop trigger if exists ${sql.raw(triggerName)} on invitation`);
    await db.execute(sql`drop function if exists ${sql.raw(fnName)}()`);
  }
}

before(async () => {
  await migrate();
  await resetSyntheticData();
});

after(async () => {
  await closeDatabase();
});

test("A09: sequential invitations respect the team seat cap", async () => {
  const { userId, cookie } = await signInNewUser("a09-seq-owner");
  const org = await createTeamOrg(cookie, userId);

  for (let i = 0; i < 4; i += 1) {
    await auth.api.createInvitation({
      body: {
        email: uniqueEmail(`a09-seq-${i}`),
        role: "member",
        organizationId: org.id,
      },
      headers: { cookie },
    });
  }

  await assert.rejects(
    () =>
      auth.api.createInvitation({
        body: {
          email: uniqueEmail("a09-seq-over"),
          role: "member",
          organizationId: org.id,
        },
        headers: { cookie },
      }),
    /seats|team plan|subscription/i,
  );

  const { memberCount, pendingCount } = await pendingAndMembers(org.id);
  assert.equal(memberCount, 1, "only the owner is a member");
  assert.equal(pendingCount, 4, "four pending invitations fill the 5-seat plan");
  assert.equal(memberCount + pendingCount, 5, "owner + pending must equal the seat cap");
});

test("A09: concurrent invitations never exceed the seat cap", async () => {
  const { userId, cookie } = await signInNewUser("a09-conc-owner");
  const org = await createTeamOrg(cookie, userId);

  const emails = Array.from({ length: 8 }, (_, i) => uniqueEmail(`a09-conc-${i}`));
  const results = await Promise.allSettled(
    emails.map((email) =>
      auth.api.createInvitation({
        body: { email, role: "member", organizationId: org.id },
        headers: { cookie },
      }),
    ),
  );

  const rejected = results.filter((r) => r.status === "rejected").length;
  assert.ok(rejected > 0, "at least one concurrent invitation must be rejected");

  const { memberCount, pendingCount } = await pendingAndMembers(org.id);
  assert.ok(
    memberCount + pendingCount <= 5,
    `seat cap violated: ${memberCount} members + ${pendingCount} pending`,
  );
});

test("A09: concurrent invitations with an identical createdAt converge to the seat cap", async () => {
  const { userId, cookie } = await signInNewUser("a09-same-ts-owner");
  const org = await createTeamOrg(cookie, userId);

  // Seed 3 pending invitations (owner + 3 = 4; exactly one seat remains).
  for (let i = 0; i < 3; i += 1) {
    await auth.api.createInvitation({
      body: {
        email: uniqueEmail(`a09-same-ts-seed-${i}`),
        role: "member",
        organizationId: org.id,
      },
      headers: { cookie },
    });
  }

  await withForcedInvitationTimestamp(async () => {
    const emails = Array.from({ length: 2 }, (_, i) => uniqueEmail(`a09-same-ts-race-${i}`));
    const results = await Promise.allSettled(
      emails.map((email) =>
        auth.api.createInvitation({
          body: { email, role: "member", organizationId: org.id },
          headers: { cookie },
        }),
      ),
    );

    const rejected = results.filter((r) => r.status === "rejected").length;
    assert.ok(
      rejected >= 1,
      "one over-cap invitation must be rejected even with an identical createdAt",
    );

    const { memberCount, pendingCount } = await pendingAndMembers(org.id);
    assert.ok(
      memberCount + pendingCount <= 5,
      `seat cap violated under identical createdAt: ${memberCount} members + ${pendingCount} pending`,
    );
  });
});

test("A09: concurrent accepts never exceed the seat cap", async () => {
  const { userId, cookie } = await signInNewUser("a09-conc-accept-owner");
  const org = await createTeamOrg(cookie, userId);

  // Seed more pending invitations than the 4 the hook would normally allow
  // (owner already occupies one of 5 seats), reproducing the post-race state
  // the accept-time compensation must converge from.
  const emails = Array.from({ length: 5 }, (_, i) => uniqueEmail(`a09-conc-acc-${i}`));
  const seeded: { id: string }[] = [];
  for (const email of emails) {
    const [row] = await db
      .insert(invitation)
      .values({
        organizationId: org.id,
        email,
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        inviterId: userId,
      })
      .returning({ id: invitation.id });
    seeded.push(row);
  }

  // Sign each recipient in sequentially (the recording mail keeps only the
  // last OTP, so concurrent OTP sends would race), then accept concurrently.
  const cookies: string[] = [];
  for (const email of emails) {
    cookies.push(await signInEmail(email));
  }

  const results = await Promise.allSettled(
    seeded.map((row, i) =>
      auth.api.acceptInvitation({
        body: { invitationId: row.id },
        headers: { cookie: cookies[i] },
      }),
    ),
  );

  const rejected = results.filter((r) => r.status === "rejected").length;
  assert.ok(rejected >= 1, "at least one concurrent accept must be rejected");

  const { memberCount } = await pendingAndMembers(org.id);
  assert.ok(memberCount <= 5, `seat cap violated: ${memberCount} members`);
});

test("A09: workspace context re-verifies membership after switch and removal", async () => {
  const owner = await signInNewUser("a09-ws-owner");
  const org = await createTeamOrg(owner.cookie, owner.userId);

  const memberEmail = uniqueEmail("a09-ws-member");
  const inv = await auth.api.createInvitation({
    body: { email: memberEmail, role: "member", organizationId: org.id },
    headers: { cookie: owner.cookie },
  });
  assert.ok(inv, "invitation should be created");

  const memberCookie = await signInEmail(memberEmail);
  await auth.api.acceptInvitation({
    body: { invitationId: inv.id },
    headers: { cookie: memberCookie },
  });

  const [memberRow] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, memberEmail));
  assert.ok(memberRow, "member user should exist");

  const guards = guardsFor(memberCookie);
  const afterAccept = await guards.getWorkspaceContext();
  assert.equal(
    afterAccept?.organizationId,
    org.id,
    "acceptInvitation activates the team workspace (BetterAuth 1.4.7)",
  );
  assert.equal(afterAccept?.userId, memberRow.id, "workspace subject is the member");

  // Explicitly switch back to the personal workspace (null).
  await auth.api.setActiveOrganization({
    body: { organizationId: null },
    headers: { cookie: memberCookie },
  });
  const personal = await guards.getWorkspaceContext();
  assert.equal(
    personal?.organizationId,
    null,
    "switching to personal clears the active organization",
  );
  assert.equal(personal?.userId, memberRow.id, "personal subject is still the member");

  // Switch back to the team.
  await auth.api.setActiveOrganization({
    body: { organizationId: org.id },
    headers: { cookie: memberCookie },
  });

  const active = await guards.getWorkspaceContext();
  assert.equal(active?.organizationId, org.id, "active organization is the team");
  assert.equal(active?.userId, memberRow.id, "workspace subject is the member");

  // Owner removes the member; the stale activeOrganizationId must degrade.
  await auth.api.removeMember({
    body: { memberIdOrEmail: memberEmail, organizationId: org.id },
    headers: { cookie: owner.cookie },
  });

  const degraded = await guards.getWorkspaceContext();
  assert.equal(degraded?.organizationId, null, "removed member degrades to personal workspace");
  assert.equal(degraded?.userId, memberRow.id, "personal subject is still the member");
});

test("A09: personal workspaces are isolated between users", async () => {
  const userA = await signInNewUser("a09-iso-a");
  const userB = await signInNewUser("a09-iso-b");

  const guardsA = guardsFor(userA.cookie);
  const guardsB = guardsFor(userB.cookie);

  const ctxA = await guardsA.getWorkspaceContext();
  const ctxB = await guardsB.getWorkspaceContext();

  assert.equal(ctxA?.organizationId, null);
  assert.equal(ctxB?.organizationId, null);
  assert.equal(ctxA?.userId, userA.userId);
  assert.equal(ctxB?.userId, userB.userId);
  assert.notEqual(ctxA?.userId, ctxB?.userId, "personal workspaces are distinct");
});
