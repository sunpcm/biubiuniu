import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { count, eq } from "drizzle-orm";

import { closeDatabase, db } from "@/lib/db";
import {
  user as userTable,
  session as sessionTable,
  verification as verificationTable,
  organization,
  member,
  invitation,
  subscriptions,
  creditTransactions,
} from "@/lib/db/schema";
import { grantPurchasedCredits } from "@/lib/credits/ledger";
import { createServerGuards } from "@/lib/auth/guards";

import { migrate, resetSyntheticData } from "./helpers";
import { assembleAuth, authBaseUrl, siteUrl } from "./auth-assembly";

const { auth, handler, mail } = assembleAuth();
const BASE_URL = authBaseUrl();
const SITE_URL = siteUrl();

function uniqueEmail(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}@example.invalid`;
}

function jsonPost(path: string, body: unknown, cookie?: string) {
  return new Request(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: SITE_URL,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function sendOtp(email: string): Promise<string> {
  const res = await handler.POST(
    jsonPost("/api/auth/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    }),
  );
  assert.equal(res.status, 200, "send-verification-otp should succeed");
  const last = mail.last();
  assert.ok(last, "OTP email should be recorded");
  const otp = last!.options.reactProps?.otp;
  assert.equal(typeof otp, "string", "recorded OTP should be a string");
  return otp;
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

async function signInNewUser(prefix: string) {
  const email = uniqueEmail(prefix);
  const otp = await sendOtp(email);
  const cookie = await signInOtpApi(email, otp);
  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.ok(row, "sign-in should create the user");
  return { email, userId: row.id, cookie };
}

async function signInAndPromote(prefix: string, role: "admin" | "superadmin") {
  const { email, userId } = await signInNewUser(prefix);
  await db.update(userTable).set({ role }).where(eq(userTable.id, userId));
  // Sign back in after the role change so the session cookie carries the
  // promoted role (mirrors the historical r1 test setup).
  const otp = await sendOtp(email);
  return signInOtpApi(email, otp);
}

function guardsFor(cookie: string) {
  return createServerGuards({
    auth,
    db,
    getHeaders: async () => new Headers({ cookie }),
  });
}

before(async () => {
  await migrate();
  await resetSyntheticData();
});

after(async () => {
  await closeDatabase();
});

test("A07: OTP creates a new account and sets a session", async () => {
  const { email, userId } = await signInNewUser("a07-otp-new");
  const [row] = await db
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.equal(row.id, userId);
  assert.equal(row.email, email);

  const [{ value: sessionCount }] = await db
    .select({ value: count() })
    .from(sessionTable)
    .where(eq(sessionTable.userId, userId));
  assert.equal(sessionCount, 1);
});

test("A07: OTP signs an existing account back in without duplicating the user", async () => {
  const { email, userId } = await signInNewUser("a07-otp-existing");
  const otp = await sendOtp(email);
  const cookie = await signInOtpApi(email, otp);
  assert.ok(cookie);

  const rows = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, userId);
});

test("A07: OTP rejects a wrong code", async () => {
  const { email } = await signInNewUser("a07-otp-wrong");
  const otp = await sendOtp(email);
  const wrong = otp === "000000" ? "000001" : "000000";
  const res = await handler.POST(jsonPost("/api/auth/sign-in/email-otp", { email, otp: wrong }));
  assert.equal(res.status, 400, "wrong OTP should be rejected with 400");
});

test("A07: OTP signs in through the real HTTP handler", async () => {
  const email = uniqueEmail("a07-otp-http");
  const otp = await sendOtp(email);
  const res = await handler.POST(jsonPost("/api/auth/sign-in/email-otp", { email, otp }));
  assert.equal(res.status, 200, "HTTP OTP sign-in should succeed");
  assert.ok(res.headers.get("set-cookie"), "HTTP OTP sign-in should set a session cookie");

  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.ok(row, "HTTP OTP sign-in should create the user");
});

test("A07: OTP rejects an expired code", async () => {
  const { email } = await signInNewUser("a07-otp-expired");
  const otp = await sendOtp(email);
  await db
    .update(verificationTable)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(verificationTable.identifier, `sign-in-otp-${email}`));

  const res = await handler.POST(jsonPost("/api/auth/sign-in/email-otp", { email, otp }));
  assert.equal(res.status, 400, "expired OTP should be rejected with 400");
});

test("A07: Magic link sends a URL and verifies into a session", async () => {
  const email = uniqueEmail("a07-magic");
  const res = await handler.POST(jsonPost("/api/auth/sign-in/magic-link", { email }));
  assert.equal(res.status, 200, "magic-link send should succeed");

  const last = mail.last();
  assert.ok(last, "magic-link email should be recorded");
  const url = last!.options.reactProps?.url;
  assert.equal(typeof url, "string", "recorded magic-link URL should be a string");

  const verify = await handler.GET(new Request(url, { redirect: "manual" }));
  assert.ok(
    verify.status >= 300 && verify.status < 400,
    `magic-link verify should redirect, got ${verify.status}`,
  );
  assert.ok(verify.headers.get("set-cookie"), "magic-link verify should set a session cookie");

  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.ok(row, "magic-link verify should create the user");
});

test("r1: built-in /admin/set-role is disabled at the HTTP layer (404)", async () => {
  const adminCookie = await signInAndPromote("r1-admin", "admin");
  await signInNewUser("r1-target");

  const res = await handler.POST(
    new Request(`${BASE_URL}/api/auth/admin/set-role`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: SITE_URL,
        cookie: adminCookie,
      },
      body: JSON.stringify({ userId: "ignored", role: "superadmin" }),
    }),
  );
  assert.equal(res.status, 404, "disabledPaths must return 404 for /admin/set-role");
});

test("r1: built-in /admin/impersonate-user remains reachable for superadmin", async () => {
  const saCookie = await signInAndPromote("r1-sa", "superadmin");
  const { userId: targetId } = await signInNewUser("r1-impersonate-target");

  const res = await handler.POST(
    new Request(`${BASE_URL}/api/auth/admin/impersonate-user`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: SITE_URL,
        cookie: saCookie,
      },
      body: JSON.stringify({ userId: targetId }),
    }),
  );
  assert.equal(res.status, 200, "impersonate-user must stay reachable for superadmin");
  const body = await res.json();
  assert.equal(body.user.id, targetId, "impersonation session must target the requested user");
});

test("A05: anonymous callers are rejected from admin impersonation", async () => {
  const res = await handler.POST(
    new Request(`${BASE_URL}/api/auth/admin/impersonate-user`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE_URL },
      body: JSON.stringify({ userId: "does-not-matter" }),
    }),
  );
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

test("A05: a plain user cannot impersonate", async () => {
  const { userId: targetId } = await signInNewUser("a05-target");
  const { cookie } = await signInNewUser("a05-plain");

  const res = await handler.POST(
    new Request(`${BASE_URL}/api/auth/admin/impersonate-user`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: SITE_URL,
        cookie,
      },
      body: JSON.stringify({ userId: targetId }),
    }),
  );
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

test("A06: fresh guard drops admin privileges after demotion", async () => {
  const { userId, cookie } = await signInNewUser("a06-demote");
  await db.update(userTable).set({ role: "admin" }).where(eq(userTable.id, userId));
  const guards = guardsFor(cookie);
  assert.equal(await guards.isAdmin(), true, "fresh session should see the admin role");

  await db.update(userTable).set({ role: "user" }).where(eq(userTable.id, userId));
  assert.equal(await guards.isAdmin(), false, "fresh session must see the demotion immediately");
});

test("A06: fresh guard returns null after session revocation", async () => {
  const { userId, cookie } = await signInNewUser("a06-revoke");
  const guards = guardsFor(cookie);
  assert.ok(
    (await guards.getFreshSession())?.user,
    "fresh session should resolve before revocation",
  );

  await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
  assert.equal(await guards.getFreshSession(), null, "revoked session must not resolve fresh");
  assert.equal(await guards.getWorkspaceContext(), null, "revoked session has no workspace");
});

test("A06: a banned user is denied fresh privileges and workspace immediately", async () => {
  const { userId, cookie } = await signInNewUser("a06-ban");
  await db.update(userTable).set({ role: "admin" }).where(eq(userTable.id, userId));
  const guards = guardsFor(cookie);
  assert.equal(await guards.isAdmin(), true, "admin role should resolve before the ban");

  await db.update(userTable).set({ banned: true }).where(eq(userTable.id, userId));

  assert.equal(
    await guards.getFreshSession(),
    null,
    "a banned user must not resolve a fresh session",
  );
  assert.equal(await guards.isAdmin(), false, "a banned admin must be denied admin privileges");
  assert.equal(
    await guards.isSuperAdmin(),
    false,
    "a banned user must be denied superadmin privileges",
  );
  assert.equal(await guards.getWorkspaceContext(), null, "a banned user has no workspace context");
});

test("A06: an expired ban no longer blocks the user", async () => {
  const { userId, cookie } = await signInNewUser("a06-ban-expired");
  await db
    .update(userTable)
    .set({ banned: true, banExpires: new Date(Date.now() - 1000) })
    .where(eq(userTable.id, userId));
  const guards = guardsFor(cookie);
  const fresh = await guards.getFreshSession();
  assert.ok(fresh?.user, "an expired ban must not block the session");
  const ctx = await guards.getWorkspaceContext();
  assert.equal(ctx?.userId, userId, "an expired ban keeps the workspace");
});

test("A16: a live personal subscription blocks account deletion", async () => {
  const { userId, cookie } = await signInNewUser("a16-sub");
  await db.insert(subscriptions).values({
    userId,
    planId: "pro-monthly",
    provider: "stripe",
    providerSubscriptionId: `sub-${crypto.randomUUID()}`,
    status: "active",
    interval: "month",
  });

  await assert.rejects(
    () => auth.api.deleteUser({ body: { callbackURL: "/" }, headers: { cookie } }),
    /active subscription/i,
  );

  const [still] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, userId));
  assert.ok(still, "blocked deletion must leave the user row intact");
});

test("A16: owning an organization blocks account deletion", async () => {
  const { cookie } = await signInNewUser("a16-owner");
  await auth.api.createOrganization({
    body: { name: "owned", slug: `owned-${crypto.randomUUID()}` },
    headers: { cookie },
  });

  await assert.rejects(
    () => auth.api.deleteUser({ body: { callbackURL: "/" }, headers: { cookie } }),
    /own a team|transfer ownership/i,
  );
});

test("A16: financial rows survive account deletion (SET NULL)", async () => {
  const { userId, cookie } = await signInNewUser("a16-retain");
  await grantPurchasedCredits({ userId, amount: 100, note: "seed-for-deletion" });

  await auth.api.deleteUser({ body: { callbackURL: "/" }, headers: { cookie } });

  const [gone] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, userId));
  assert.equal(gone, undefined, "user should be deleted");

  const retained = await db
    .select({ id: creditTransactions.id, userId: creditTransactions.userId })
    .from(creditTransactions)
    .where(eq(creditTransactions.note, "seed-for-deletion"));
  assert.ok(retained.length > 0, "financial ledger must survive account deletion");
  assert.ok(
    retained.every((row) => row.userId === null),
    "financial ledger should be de-identified via SET NULL",
  );
});

test("A16: a team subscription blocks organization deletion", async () => {
  const { userId, cookie } = await signInNewUser("a16-org-sub");
  const org = await auth.api.createOrganization({
    body: { name: "team-org", slug: `team-org-${crypto.randomUUID()}` },
    headers: { cookie },
  });
  assert.ok(org);
  await db.insert(subscriptions).values({
    userId,
    organizationId: org.id,
    planId: "team-monthly",
    provider: "stripe",
    providerSubscriptionId: `sub-${crypto.randomUUID()}`,
    status: "active",
    interval: "month",
  });

  await assert.rejects(
    () =>
      auth.api.deleteOrganization({
        body: { organizationId: org.id },
        headers: { cookie },
      }),
    /active subscription/i,
  );

  const [still] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, org.id));
  assert.ok(still, "blocked deletion must leave the organization row intact");
});

test("A16: billing history blocks organization deletion", async () => {
  const { cookie } = await signInNewUser("a16-org-history");
  const org = await auth.api.createOrganization({
    body: { name: "hist-org", slug: `hist-org-${crypto.randomUUID()}` },
    headers: { cookie },
  });
  assert.ok(org);
  await grantPurchasedCredits({
    userId: null,
    organizationId: org.id,
    amount: 50,
    note: "org-history",
  });

  await assert.rejects(
    () =>
      auth.api.deleteOrganization({
        body: { organizationId: org.id },
        headers: { cookie },
      }),
    /billing history/i,
  );
});

test("R03: a banned user cannot create an organization through the SDK", async () => {
  const { userId, cookie } = await signInNewUser("r03-sdk-org");
  await db.update(userTable).set({ banned: true }).where(eq(userTable.id, userId));

  const slug = `r03-blocked-${crypto.randomUUID()}`;
  await assert.rejects(
    () =>
      auth.api.createOrganization({
        body: { name: "blocked", slug },
        headers: { cookie },
      }),
    /banned/i,
  );

  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug));
  assert.equal(org, undefined, "a banned user must not create an organization");

  const members = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.userId, userId));
  assert.equal(members.length, 0, "a banned user must not gain a membership");
});

test("R03: a banned user is rejected from organization create over HTTP", async () => {
  const { userId, cookie } = await signInNewUser("r03-http-org");
  await db.update(userTable).set({ banned: true }).where(eq(userTable.id, userId));

  const slug = `r03-http-${crypto.randomUUID()}`;
  const res = await handler.POST(
    jsonPost("/api/auth/organization/create", { name: "blocked", slug }, cookie),
  );
  assert.equal(res.status, 403, "a banned user must be rejected from org create");

  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug));
  assert.equal(org, undefined, "no organization may be inserted");
});

test("R03: a banned owner cannot invite a member", async () => {
  const { userId, cookie } = await signInNewUser("r03-invite-owner");
  const org = await auth.api.createOrganization({
    body: { name: "team", slug: `team-${crypto.randomUUID()}` },
    headers: { cookie },
  });
  await db.insert(subscriptions).values({
    userId,
    organizationId: org.id,
    planId: "team-monthly",
    provider: "stripe",
    providerSubscriptionId: `sub-${crypto.randomUUID()}`,
    status: "active",
    interval: "month",
  });

  await db.update(userTable).set({ banned: true }).where(eq(userTable.id, userId));

  await assert.rejects(
    () =>
      auth.api.createInvitation({
        body: { email: uniqueEmail("r03-invite"), role: "member", organizationId: org.id },
        headers: { cookie },
      }),
    /banned/i,
  );

  const invitations = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(eq(invitation.organizationId, org.id));
  assert.equal(invitations.length, 0, "a banned owner must not create an invitation");
});

test("R03: an expired ban no longer blocks organization creation", async () => {
  const { userId, cookie } = await signInNewUser("r03-expired");
  await db
    .update(userTable)
    .set({ banned: true, banExpires: new Date(Date.now() - 1000) })
    .where(eq(userTable.id, userId));

  const org = await auth.api.createOrganization({
    body: { name: "allowed", slug: `allowed-${crypto.randomUUID()}` },
    headers: { cookie },
  });
  assert.ok(org, "an expired ban must not block organization creation");
});

test("R03: a banned user can still sign out", async () => {
  const { userId, cookie } = await signInNewUser("r03-signout");
  await db.update(userTable).set({ banned: true }).where(eq(userTable.id, userId));

  const res = await handler.POST(jsonPost("/api/auth/sign-out", {}, cookie));
  assert.equal(res.status, 200, "sign-out must remain reachable for a banned user");

  const sessions = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(eq(sessionTable.userId, userId));
  assert.equal(sessions.length, 0, "sign-out must delete the banned user's session");
});

test("R03-r1: HTTP get-session is not blocked for a banned user", async () => {
  const { userId, cookie } = await signInNewUser("r03-http-session");
  await db.update(userTable).set({ banned: true }).where(eq(userTable.id, userId));

  const res = await handler.GET(
    new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { origin: SITE_URL, cookie },
    }),
  );
  assert.equal(res.status, 200, "get-session must not be 403 for a banned user");
});

test("R03-r1: SDK get-session resolves a session for a banned user", async () => {
  const { userId, cookie } = await signInNewUser("r03-sdk-session");
  await db.update(userTable).set({ banned: true }).where(eq(userTable.id, userId));

  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
    query: { disableCookieCache: true, disableRefresh: true },
  });
  assert.ok(session?.user, "SDK get-session must resolve the session without 403");
});
