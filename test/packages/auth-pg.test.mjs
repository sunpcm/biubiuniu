import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pgAuthSrc = join(
  repoRoot,
  "packages",
  "persistence-pg",
  "src",
  "auth",
  "index.ts",
);

// Fixed identity contract for this task's dedicated databases. The expected
// database name must match the current_database() and carry the N3-only prefix,
// so a reference / N2 / disposable database can never be written to.
const AUTH_TEST_ROLE = "nexty_overnight_test";
const AUTH_TEST_DB_PREFIX = "nexty_overnight_20261105_n3_";

const authOnlyUrl = process.env.AUTH_PG_TEST_URL;
const authOnlyDb = process.env.AUTH_PG_TEST_DB;
const creditsUrl = process.env.AUTH_CREDITS_PG_TEST_URL;
const creditsDb = process.env.AUTH_CREDITS_PG_TEST_DB;

/**
 * Pure config gate. Returns a skip reason only when the URL is absent. A URL
 * with a missing or wrong-prefix expected database is resolved later as a hard
 * failure (not a skip), so "URL present but identity unknown" never runs.
 */
function resolveTaskDbConfig(url, expectedDb, envName) {
  if (!url) return { skip: `${envName} not set` };
  return { url, expectedDb };
}

function assertValidTaskDbConfig(cfg, envName) {
  if (!cfg.expectedDb) {
    throw new Error(`${envName} is set but ${envName.replace(/_URL$/, "_DB")} is required`);
  }
  if (typeof cfg.expectedDb !== "string" || !cfg.expectedDb.startsWith(AUTH_TEST_DB_PREFIX)) {
    throw new Error(`${envName} database must start with ${AUTH_TEST_DB_PREFIX}`);
  }
}

/** Pure identity row check: current database and role must be exactly expected. */
function assertIdentityRow(row, expectedDb) {
  if (!row || row.database_name !== expectedDb) {
    throw new Error(`database mismatch: expected ${expectedDb}, got ${row?.database_name}`);
  }
  if (row.role_name !== AUTH_TEST_ROLE) {
    throw new Error(`role mismatch: expected ${AUTH_TEST_ROLE}, got ${row.role_name}`);
  }
}

/** Read-only identity guard. Issues exactly one SELECT, never DML/DDL. */
async function assertTaskIdentity(query, expectedDb) {
  const [row] = await query`select current_database() as database_name, current_user as role_name`;
  assertIdentityRow(row, expectedDb);
}

async function connect(url) {
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const authSchema = await import("@sunpcm/niu-persistence-pg/schema/auth");

  const authTables = {
    user: authSchema.user,
    session: authSchema.session,
    account: authSchema.account,
    verification: authSchema.verification,
    organization: authSchema.organization,
    member: authSchema.member,
    invitation: authSchema.invitation,
  };

  const pg = postgres(url);
  const db = drizzle(pg, { schema: authTables });
  return { pg, db, authSchema, authTables };
}

async function assertBillingTables(pg, expectBilling) {
  const tables = await pg`
    select table_name
    from information_schema.tables
    where table_schema = current_schema()
      and table_name in ('subscriptions', 'credit_transactions')
  `;
  const names = new Set(tables.map((row) => row.table_name));
  if (expectBilling) {
    assert.ok(names.has("subscriptions"), "expected subscriptions table");
    assert.ok(names.has("credit_transactions"), "expected credit_transactions table");
  } else {
    assert.equal(names.size, 0, "auth-only DB must not contain Commerce billing tables");
  }
}

function uniqueEmail(prefix) {
  return `${prefix}-${randomUUID()}@example.invalid`;
}

const authOnlyCfg = resolveTaskDbConfig(authOnlyUrl, authOnlyDb, "AUTH_PG_TEST_URL");
const creditsCfg = resolveTaskDbConfig(creditsUrl, creditsDb, "AUTH_CREDITS_PG_TEST_URL");

// ---------------------------------------------------------------------------
// Non-PG guard units (always run). Prove missing identity / wrong DB / wrong
// role fail before any DML/DDL and that an absent URL is the only skip path.
// ---------------------------------------------------------------------------

test("task DB config: absent URL skips; present URL with missing/wrong identity fails", () => {
  assert.deepEqual(resolveTaskDbConfig(undefined, undefined, "X_URL"), {
    skip: "X_URL not set",
  });

  assert.throws(
    () => assertValidTaskDbConfig({ url: "u", expectedDb: undefined }, "X_URL"),
    /X_DB is required/,
  );
  assert.throws(
    () => assertValidTaskDbConfig({ url: "u", expectedDb: "reference" }, "X_URL"),
    /must start with nexty_overnight_20261105_n3_/,
  );
  assert.throws(
    () => assertValidTaskDbConfig({ url: "u", expectedDb: "nexty_overnight_20261105_n2_x" }, "X_URL"),
    /must start with nexty_overnight_20261105_n3_/,
  );

  assertValidTaskDbConfig(
    { url: "u", expectedDb: "nexty_overnight_20261105_n3_auth" },
    "X_URL",
  );
});

test("identity guard: wrong database or role fails with a single read and no writes", async () => {
  function recorder(identityRow) {
    const statements = [];
    const query = (strings, ...values) => {
      statements.push({ sql: strings.join("?"), values });
      return Promise.resolve([identityRow]);
    };
    return { query, statements };
  }

  const wrongDb = recorder({ database_name: "reference", role_name: AUTH_TEST_ROLE });
  await assert.rejects(
    assertTaskIdentity(wrongDb.query, "nexty_overnight_20261105_n3_auth"),
    /database mismatch/,
  );
  assert.equal(wrongDb.statements.length, 1);
  assert.match(wrongDb.statements[0].sql, /select current_database/i);

  const wrongRole = recorder({ database_name: "nexty_overnight_20261105_n3_auth", role_name: "postgres" });
  await assert.rejects(
    assertTaskIdentity(wrongRole.query, "nexty_overnight_20261105_n3_auth"),
    /role mismatch/,
  );
  assert.equal(wrongRole.statements.length, 1);

  const ok = recorder({ database_name: "nexty_overnight_20261105_n3_auth", role_name: AUTH_TEST_ROLE });
  await assertTaskIdentity(ok.query, "nexty_overnight_20261105_n3_auth");
  assert.equal(ok.statements.length, 1);
  assert.match(ok.statements[0].sql, /select current_database/i);
});

test("auth PG adapter source never imports the Commerce schema", async () => {
  const src = await readFile(pgAuthSrc, "utf8");
  assert.doesNotMatch(src, /schema\/commerce\.js/);
  assert.doesNotMatch(src, /import\s*\{[^}]*\bsubscriptions\b[^}]*\}/);
  assert.doesNotMatch(src, /import\s*\{[^}]*\bcreditTransactions\b[^}]*\}/);
  assert.match(src, /AuthPgBillingQueries/);
  assert.match(src, /billingQueries/);
});

// ---------------------------------------------------------------------------
// Auth-only PG fixtures. Guard runs before any seed; on guard failure only the
// connection is closed (no DELETE). The seed/cleanup try is entered only after
// identity + billing-table guards pass.
// ---------------------------------------------------------------------------

test(
  "auth-only PG: no billing tables and real ban/member reads; reclaim rejects without billing",
  { skip: authOnlyCfg.skip ?? false },
  async () => {
    assertValidTaskDbConfig(authOnlyCfg, "AUTH_PG_TEST_URL");
    const { pg, db } = await connect(authOnlyCfg.url);
    const { createAuthPolicyStore } = await import(
      "@sunpcm/niu-persistence-pg/auth"
    );

    const userId = randomUUID();
    const orgId = randomUUID();
    const memberId = randomUUID();

    try {
      await assertTaskIdentity(pg, authOnlyCfg.expectedDb);
      await assertBillingTables(pg, false);

      try {
        await pg`insert into "user" (id, email, banned) values (${userId}, ${uniqueEmail("auth-only")}, true)`;
        await pg`insert into "organization" (id, name, slug) values (${orgId}, 'Test Org', ${"test-org-" + orgId})`;
        await pg`insert into "member" (id, organization_id, user_id, role) values (${memberId}, ${orgId}, ${userId}, 'member')`;

        const store = createAuthPolicyStore({ db, billingQueries: null });

        const ban = await store.getBanStatus(userId);
        assert.equal(ban.banned, true);

        const live = await store.isLiveMember(orgId, userId);
        assert.equal(live, true);

        const owner = await store.isOrganizationOwner(userId);
        assert.equal(owner, false);

        const members = await store.countMembers(orgId);
        assert.equal(members, 1);

        await assert.rejects(
          store.reclaimMemberSeatIfOverCap({ organizationId: orgId, addedId: memberId }),
          /billing/i,
        );
      } finally {
        await pg`delete from "member" where id = ${memberId}`;
        await pg`delete from "organization" where id = ${orgId}`;
        await pg`delete from "user" where id = ${userId}`;
      }
    } finally {
      await pg.end();
    }
  },
);

test(
  "auth-only PG: Teams endpoints unregistered when organization is not selected",
  { skip: authOnlyCfg.skip ?? false },
  async () => {
    assertValidTaskDbConfig(authOnlyCfg, "AUTH_PG_TEST_URL");
    const { pg, db, authTables } = await connect(authOnlyCfg.url);
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    const { createAuth } = await import("@sunpcm/niu-auth");
    const { createAuthPolicyStore } = await import(
      "@sunpcm/niu-persistence-pg/auth"
    );

    const policyStore = createAuthPolicyStore({ db, billingQueries: null });
    const adapter = drizzleAdapter(db, { provider: "pg", schema: authTables });

    const baseDeps = {
      site: { name: "test", url: "http://test.local" },
      adapter,
      policyStore,
      secret: "test-secret",
      billing: null,
      mail: {},
      signupGuard: {
        isEmailBlocked: async () => false,
        isIpBlocked: async () => false,
      },
      redis: null,
      requestSignal: {
        getClientIP: async () => "unknown",
        getCookie: async () => undefined,
      },
    };

    try {
      await assertTaskIdentity(pg, authOnlyCfg.expectedDb);
      await assertBillingTables(pg, false);

      const withoutTeams = createAuth({ ...baseDeps, capabilities: {} });
      const missing = await withoutTeams.handler(
        new Request("http://test.local/api/auth/organization/list", { method: "GET" }),
      );
      assert.equal(missing.status, 404);

      const withTeams = createAuth({
        ...baseDeps,
        billing: {
          getOrgSeatCap: async () => ({ seats: 5, hasTeamSubscription: true }),
          hasLivePersonalSubscription: async () => false,
          getOrganizationDeletionBlockers: async () => ({
            hasTeamSubscription: false,
            hasBillingHistory: false,
          }),
        },
        mail: { sendOrganizationInvitation: async () => {} },
        capabilities: { organization: true },
      });
      const registered = await withTeams.handler(
        new Request("http://test.local/api/auth/organization/list", { method: "GET" }),
      );
      assert.notEqual(registered.status, 404);
    } finally {
      await pg.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Auth+Credits fixtures. Seed/cleanup uses raw SQL; every billing/seat/deletion
// read goes through the production Commerce query factory.
// ---------------------------------------------------------------------------

async function connectCredits() {
  const { pg, db, authTables } = await connect(creditsCfg.url);
  const { createPgCommerceBillingQueries } = await import(
    "@sunpcm/niu-persistence-pg/commerce"
  );
  const { createAuthPolicyStore } = await import(
    "@sunpcm/niu-persistence-pg/auth"
  );

  const seatCatalog = (planId) => {
    if (!planId) return 1;
    return { "team-2": 2, "team-5": 5 }[planId] ?? 1;
  };
  const billingQueries = createPgCommerceBillingQueries({ seatCatalog });
  const store = createAuthPolicyStore({ db, billingQueries });
  const billingPort = {
    getOrgSeatCap: (organizationId) =>
      billingQueries.getOrgSeatCap(db, organizationId),
    hasLivePersonalSubscription: (userId) =>
      billingQueries.hasLivePersonalSubscription(db, userId),
    getOrganizationDeletionBlockers: (organizationId) =>
      billingQueries.getOrganizationDeletionBlockers(db, organizationId),
  };

  return { pg, db, authTables, billingQueries, store, billingPort, seatCatalog };
}

test(
  "auth+credits PG: compensation deletes only the just-added member and keeps owner + existing",
  { skip: creditsCfg.skip ?? false },
  async () => {
    assertValidTaskDbConfig(creditsCfg, "AUTH_CREDITS_PG_TEST_URL");
    const { pg, store } = await connectCredits();
    const ownerUserId = randomUUID();
    const existingUserId = randomUUID();
    const addedUserId = randomUUID();
    const orgId = randomUUID();
    const ownerMemberId = randomUUID();
    const existingMemberId = randomUUID();
    const addedMemberId = randomUUID();

    try {
      await assertTaskIdentity(pg, creditsCfg.expectedDb);
      await assertBillingTables(pg, true);

      try {
        await pg`insert into "user" (id, email) values (${ownerUserId}, ${uniqueEmail("comp-owner")})`;
        await pg`insert into "user" (id, email) values (${existingUserId}, ${uniqueEmail("comp-existing")})`;
        await pg`insert into "user" (id, email) values (${addedUserId}, ${uniqueEmail("comp-added")})`;
        await pg`insert into "organization" (id, name, slug) values (${orgId}, 'Team', ${"team-" + orgId})`;
        await pg`insert into "subscriptions" (organization_id, plan_id, provider, provider_subscription_id, status, interval) values (${orgId}, 'team-2', 'stripe', ${"sub-" + randomUUID()}, 'active', 'month')`;
        await pg`insert into "member" (id, organization_id, user_id, role) values (${ownerMemberId}, ${orgId}, ${ownerUserId}, 'owner')`;
        await pg`insert into "member" (id, organization_id, user_id, role) values (${existingMemberId}, ${orgId}, ${existingUserId}, 'member')`;
        await pg`insert into "member" (id, organization_id, user_id, role) values (${addedMemberId}, ${orgId}, ${addedUserId}, 'member')`;

        const rejected = await store.reclaimMemberSeatIfOverCap({
          organizationId: orgId,
          addedId: addedMemberId,
        });
        assert.equal(rejected, 2, "two-seat plan reports over-cap at 3 members");

        const remaining = await pg`select id from "member" where organization_id = ${orgId}`;
        assert.deepEqual(
          new Set(remaining.map((row) => row.id)),
          new Set([ownerMemberId, existingMemberId]),
        );
      } finally {
        await pg`delete from "member" where organization_id = ${orgId}`;
        await pg`delete from "subscriptions" where organization_id = ${orgId}`;
        await pg`delete from "organization" where id = ${orgId}`;
        await pg`delete from "user" where id in (${ownerUserId}, ${existingUserId}, ${addedUserId})`;
      }
    } finally {
      await pg.end();
    }
  },
);

test(
  "auth+credits PG: getOrgSeatCap reads the open transaction but not the root connection",
  { skip: creditsCfg.skip ?? false },
  async () => {
    assertValidTaskDbConfig(creditsCfg, "AUTH_CREDITS_PG_TEST_URL");
    const { pg, db, billingQueries } = await connectCredits();
    const { sql } = await import("drizzle-orm");
    const orgId = randomUUID();
    const userId = randomUUID();
    const subId = randomUUID();

    try {
      await assertTaskIdentity(pg, creditsCfg.expectedDb);
      await assertBillingTables(pg, true);

      try {
        await pg`insert into "user" (id, email) values (${userId}, ${uniqueEmail("tx-vis")})`;
        await pg`insert into "organization" (id, name, slug) values (${orgId}, 'Team', ${"team-" + orgId})`;
        await pg`insert into "subscriptions" (id, organization_id, plan_id, provider, provider_subscription_id, status, interval, created_at) values (${subId}, ${orgId}, 'team-2', 'stripe', ${"sub-" + subId}, 'active', 'month', '2026-01-01T00:00:00Z')`;

        const rootBefore = await billingQueries.getOrgSeatCap(db, orgId);
        assert.equal(rootBefore.seats, 2);

        await assert.rejects(
          db.transaction(async (tx) => {
            const newerId = randomUUID();
            await tx.execute(sql`
              insert into "subscriptions" (id, organization_id, plan_id, provider, provider_subscription_id, status, interval, created_at)
              values (${newerId}, ${orgId}, 'team-5', 'stripe', ${"sub-" + newerId}, 'active', 'month', '2026-01-02T00:00:00Z')
            `);

            const txSeats = await billingQueries.getOrgSeatCap(tx, orgId);
            assert.equal(txSeats.seats, 5, "transaction must see its own uncommitted row");

            const rootDuring = await billingQueries.getOrgSeatCap(db, orgId);
            assert.equal(rootDuring.seats, 2, "root connection must not see the uncommitted row");

            throw new Error("force-rollback");
          }),
          /force-rollback/,
        );

        const rootAfter = await billingQueries.getOrgSeatCap(db, orgId);
        assert.equal(rootAfter.seats, 2, "rollback must leave no seat residue");
        const subCount = await pg`select count(*)::int as c from "subscriptions" where organization_id = ${orgId}`;
        assert.equal(subCount[0].c, 1, "rollback must leave no subscription residue");
      } finally {
        await pg`delete from "subscriptions" where organization_id = ${orgId}`;
        await pg`delete from "organization" where id = ${orgId}`;
        await pg`delete from "user" where id = ${userId}`;
      }
    } finally {
      await pg.end();
    }
  },
);

test(
  "auth+credits PG: live/dunning entitlement and personal/org deletion protection",
  { skip: creditsCfg.skip ?? false },
  async () => {
    assertValidTaskDbConfig(creditsCfg, "AUTH_CREDITS_PG_TEST_URL");
    const { pg, db, authTables, billingQueries, store, billingPort } =
      await connectCredits();
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    const { createAuth } = await import("@sunpcm/niu-auth");

    const adapter = drizzleAdapter(db, { provider: "pg", schema: authTables });

    let lastOtp;
    const mail = {
      sendVerificationOtp: async ({ otp }) => {
        lastOtp = otp;
      },
      sendOrganizationInvitation: async () => {},
      sendWelcome: async () => {},
      sendMagicLink: async () => {},
    };

    const baseDeps = {
      site: { name: "test", url: "http://test.local" },
      adapter,
      policyStore: store,
      billing: billingPort,
      mail,
      signupGuard: {
        isEmailBlocked: async () => false,
        isIpBlocked: async () => false,
      },
      redis: null,
      requestSignal: {
        getClientIP: async () => "unknown",
        getCookie: async () => undefined,
      },
      secret: "test-secret",
      baseURL: "http://test.local",
    };

    const auth = createAuth({
      ...baseDeps,
      capabilities: { emailOTP: true, organization: true, billing: true },
    });

    const BASE = "http://test.local";

    async function sendOtp(email) {
      const res = await auth.handler(
        new Request(`${BASE}/api/auth/email-otp/send-verification-otp`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE },
          body: JSON.stringify({ email, type: "sign-in" }),
        }),
      );
      assert.equal(res.status, 200, "send-verification-otp should succeed");
      assert.equal(typeof lastOtp, "string", "OTP should be recorded");
      return lastOtp;
    }

    async function signIn(email) {
      const otp = await sendOtp(email);
      const res = await auth.api.signInEmailOTP({
        body: { email, otp },
        returnHeaders: true,
      });
      const setCookie = res.headers.get("set-cookie") ?? "";
      assert.ok(setCookie, "OTP sign-in should set a session cookie");
      return setCookie.split(";")[0];
    }

    const createdUserIds = [];
    const createdOrgIds = [];
    const createdSubIds = [];

    try {
      await assertTaskIdentity(pg, creditsCfg.expectedDb);
      await assertBillingTables(pg, true);

      try {
        for (const status of ["active", "trialing", "past_due", "unpaid"]) {
          const email = uniqueEmail(`live-${status}`);
          const cookie = await signIn(email);
          const [row] = await pg`select id from "user" where email = ${email}`;
          const userId = row.id;
          createdUserIds.push(userId);
          const subId = randomUUID();
          createdSubIds.push(subId);
          await pg`insert into "subscriptions" (id, user_id, plan_id, provider, provider_subscription_id, status, interval) values (${subId}, ${userId}, 'pro-monthly', 'stripe', ${"sub-" + subId}, ${status}, 'month')`;
          assert.equal(
            await billingQueries.hasLivePersonalSubscription(db, userId),
            true,
            `${status} must block deletion`,
          );
          await assert.rejects(
            () => auth.api.deleteUser({ body: { callbackURL: "/" }, headers: { cookie } }),
            /active subscription/i,
          );
        }

        for (const status of ["canceled", "expired"]) {
          const email = uniqueEmail(`terminal-${status}`);
          const cookie = await signIn(email);
          const [row] = await pg`select id from "user" where email = ${email}`;
          const userId = row.id;
          createdUserIds.push(userId);
          const subId = randomUUID();
          createdSubIds.push(subId);
          await pg`insert into "subscriptions" (id, user_id, plan_id, provider, provider_subscription_id, status, interval) values (${subId}, ${userId}, 'pro-monthly', 'stripe', ${"sub-" + subId}, ${status}, 'month')`;
          assert.equal(
            await billingQueries.hasLivePersonalSubscription(db, userId),
            false,
            `${status} must not block deletion`,
          );
        }

        {
          const ownerEmail = uniqueEmail("org-live-owner");
          const cookie = await signIn(ownerEmail);
          const org = await auth.api.createOrganization({
            body: { name: "team", slug: `team-${randomUUID()}` },
            headers: { cookie },
          });
          createdOrgIds.push(org.id);
          const subId = randomUUID();
          createdSubIds.push(subId);
          await pg`insert into "subscriptions" (id, organization_id, plan_id, provider, provider_subscription_id, status, interval) values (${subId}, ${org.id}, 'team-2', 'stripe', ${"sub-" + subId}, 'active', 'month')`;
          assert.equal(
            (await billingQueries.getOrganizationDeletionBlockers(db, org.id)).hasTeamSubscription,
            true,
            "live team plan must block organization deletion",
          );
          await assert.rejects(
            () =>
              auth.api.deleteOrganization({
                body: { organizationId: org.id },
                headers: { cookie },
              }),
            /active subscription/i,
          );
        }

        {
          const ownerEmail = uniqueEmail("org-history-owner");
          const cookie = await signIn(ownerEmail);
          const org = await auth.api.createOrganization({
            body: { name: "hist", slug: `hist-${randomUUID()}` },
            headers: { cookie },
          });
          createdOrgIds.push(org.id);
          const subId = randomUUID();
          createdSubIds.push(subId);
          await pg`insert into "subscriptions" (id, organization_id, plan_id, provider, provider_subscription_id, status, interval) values (${subId}, ${org.id}, 'team-2', 'stripe', ${"sub-" + subId}, 'expired', 'month')`;
          const blockers = await billingQueries.getOrganizationDeletionBlockers(db, org.id);
          assert.equal(blockers.hasTeamSubscription, false);
          assert.equal(blockers.hasBillingHistory, true);
          await assert.rejects(
            () =>
              auth.api.deleteOrganization({
                body: { organizationId: org.id },
                headers: { cookie },
              }),
            /billing history/i,
          );
        }
      } finally {
        for (const orgId of createdOrgIds) {
          await pg`delete from "member" where organization_id = ${orgId}`;
          await pg`delete from "subscriptions" where organization_id = ${orgId}`;
          await pg`delete from "credit_transactions" where organization_id = ${orgId}`;
          await pg`delete from "organization" where id = ${orgId}`;
        }
        if (createdSubIds.length) {
          await pg`delete from "subscriptions" where id in ${pg(createdSubIds)}`;
        }
        if (createdUserIds.length) {
          await pg`delete from "user" where id in ${pg(createdUserIds)}`;
        }
      }
    } finally {
      await pg.end();
    }
  },
);
