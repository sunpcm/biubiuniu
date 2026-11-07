/* global URL, crypto, process */
import assert from "node:assert/strict";
import test from "node:test";

// Controller runs this after persistence-pg has been built. Imports are the
// public package entry, not the private TypeScript source. Without
// COMMERCE_PG_DATABASE_URL the case is skipped and must not be reported as
// acceptance. A URL without the expected database and role fails closed.
const databaseUrl = process.env.COMMERCE_PG_DATABASE_URL?.trim() ?? "";
const expectedDatabase = process.env.COMMERCE_PG_EXPECTED_DATABASE?.trim() ?? "";
const expectedRole = process.env.COMMERCE_PG_EXPECTED_ROLE?.trim() ?? "";
const REQUIRED_ROLE = "nexty_overnight_test";
const N3_DATABASE_PREFIX = "nexty_overnight_20261105_n3_";
const FORBIDDEN_DATABASES = new Set([
  "nexty_overnight_20261105_test",
  "nexty_overnight_20261105_migration_c01",
  "nexty_overnight_20261105_migration_fault_c01",
]);
const FORBIDDEN_DATABASE_RE =
  /reference|disposable|(?:^|_)n2(?:_|$)|migration_c01|migration_fault/i;

function databaseNameFromUrl(value) {
  try {
    return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

function usernameFromUrl(value) {
  try {
    return decodeURIComponent(new URL(value).username);
  } catch {
    return "";
  }
}

function rejectDatabaseName(name, label) {
  if (
    !name.startsWith(N3_DATABASE_PREFIX) ||
    FORBIDDEN_DATABASES.has(name) ||
    FORBIDDEN_DATABASE_RE.test(name)
  ) {
    throw new Error(
      `${label} ${name} is not an N3 commerce database; reference and N2 disposable databases are refused`,
    );
  }
}

function assertCommercePgConfig() {
  if (!databaseUrl) return;
  if (!expectedDatabase || !expectedRole) {
    throw new Error(
      "COMMERCE_PG_DATABASE_URL is set but COMMERCE_PG_EXPECTED_DATABASE and COMMERCE_PG_EXPECTED_ROLE are required",
    );
  }
  if (expectedRole !== REQUIRED_ROLE) {
    throw new Error(`COMMERCE_PG_EXPECTED_ROLE must be ${REQUIRED_ROLE}`);
  }
  rejectDatabaseName(expectedDatabase, "COMMERCE_PG_EXPECTED_DATABASE");
  const urlDatabase = databaseNameFromUrl(databaseUrl);
  if (urlDatabase && urlDatabase !== expectedDatabase) {
    throw new Error(
      "COMMERCE_PG_DATABASE_URL database does not match COMMERCE_PG_EXPECTED_DATABASE",
    );
  }
  if (urlDatabase) rejectDatabaseName(urlDatabase, "COMMERCE_PG_DATABASE_URL database");
  const username = usernameFromUrl(databaseUrl);
  if (username && username !== REQUIRED_ROLE) {
    throw new Error(`COMMERCE_PG_DATABASE_URL user must be ${REQUIRED_ROLE}`);
  }
}

function assertCommercePgIdentity(row) {
  const database = row?.database;
  const role = row?.role;
  if (database !== expectedDatabase || role !== expectedRole || role !== REQUIRED_ROLE) {
    throw new Error(`commerce PG identity mismatch: database=${database} role=${role}`);
  }
  rejectDatabaseName(database, "current_database()");
}

assertCommercePgConfig();

test(
  "PG billing queries and commerce join share the caller transaction",
  {
    skip: databaseUrl
      ? false
      : "COMMERCE_PG_DATABASE_URL is not injected; controller runs this after schema freeze",
  },
  async () => {
    const postgres = (await import("postgres")).default;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const [identity] = await sql`select current_database() as database, current_user as role`;
      assertCommercePgIdentity(identity);
      const { drizzle } = await import("drizzle-orm/postgres-js");
      const { eq } = await import("drizzle-orm");
      const {
        bindPgCommerceUnit,
        coordinatePgCommerce,
        createPgCommerceBillingQueries,
        createPgCommerceStore,
      } = await import("@sunpcm/niu-persistence-pg/commerce");
      const { createCommerce } = await import("../../packages/commerce/dist/index.js");
      const schema = await import("@sunpcm/niu-persistence-pg/schema/commerce");
      const auth = await import("@sunpcm/niu-persistence-pg/schema/auth");
      const db = drizzle(sql);
      const queries = createPgCommerceBillingQueries({
        seatCatalog: (planId) => (planId === "team" ? 5 : 1),
      });
      const userId = crypto.randomUUID();
      const memberId = crypto.randomUUID();
      const organizationId = crypto.randomUUID();
      const subscriptionId = `pg-sub-${crypto.randomUUID()}`;
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.insert(auth.user).values({ id: userId, email: `${userId}@example.invalid` });
          await tx.insert(auth.user).values({ id: memberId, email: `${memberId}@example.invalid` });
          await tx
            .insert(auth.organization)
            .values({ id: organizationId, name: "PG team", slug: `pg-${organizationId}` });
          await tx.insert(schema.orders).values({
            organizationId,
            planId: "team",
            orderType: "one_time",
            status: "pending",
            amountTotal: 100,
            currency: "usd",
            provider: "stripe",
            providerOrderId: `pending-${subscriptionId}`,
          });
          assert.deepEqual(await queries.getOrganizationDeletionBlockers(tx, organizationId), {
            hasTeamSubscription: false,
            hasBillingHistory: false,
          });
          await tx.insert(schema.creditTransactions).values({
            organizationId,
            type: "purchase",
            amount: 1,
            subscriptionCreditsAfter: 0,
            purchasedCreditsAfter: 1,
          });
          assert.deepEqual(await queries.getOrganizationDeletionBlockers(tx, organizationId), {
            hasTeamSubscription: false,
            hasBillingHistory: true,
          });
          await tx.insert(schema.subscriptions).values({
            userId,
            organizationId,
            planId: "team",
            provider: "stripe",
            providerSubscriptionId: subscriptionId,
            status: "active",
            interval: "month",
            monthlyCredits: 20,
          });
          assert.equal(await queries.hasLivePersonalSubscription(tx, userId), true);
          assert.equal(await queries.hasLivePersonalSubscription(tx, memberId), false);
          assert.deepEqual(await queries.getOrgSeatCap(tx, organizationId), {
            seats: 5,
            hasTeamSubscription: true,
          });
          const unit = bindPgCommerceUnit(tx);
          assert.equal(await unit.billing.userHasLiveSubscription(userId, ["active"]), true);
          throw new Error("rollback outer");
        }),
        /rollback outer/,
      );
      assert.deepEqual(await queries.getOrgSeatCap(db, organizationId), {
        seats: 1,
        hasTeamSubscription: false,
      });
      assert.equal(await queries.hasLivePersonalSubscription(db, userId), false);
      assert.deepEqual(await queries.getOrganizationDeletionBlockers(db, organizationId), {
        hasTeamSubscription: false,
        hasBillingHistory: false,
      });

      const store = createPgCommerceStore(db);
      let flushed = 0;
      let discarded = 0;
      const committedTasks = [];
      const notices = [];
      const commerce = createCommerce({
        productId: "pg-commerce",
        catalog: { getPlanById: () => undefined, findPlanByProviderPriceId: () => undefined },
        clock: { now: () => new Date("2026-01-31T04:00:00.000Z") },
        identity: {
          async getFreshPrincipal() {
            return null;
          },
          async isLiveMember() {
            return false;
          },
        },
        store,
        logger: { warn() {}, error() {} },
        schedulePostCommit(task) {
          flushed += 1;
          committedTasks.push(task);
        },
        notifier: {
          async onOrderCommitted(notice) {
            notices.push(notice);
          },
        },
      });
      const control = {
        runtime: {
          deps: { store },
          flushOuter(unit) {
            commerce.runtime.flushOuter(unit);
          },
          discardOuter(unit) {
            discarded += 1;
            commerce.runtime.discardOuter(unit);
          },
        },
      };
      await assert.rejects(
        coordinatePgCommerce(store, control, async ({ handle, unit }) => {
          await handle.insert(auth.user).values({ id: userId, email: `${userId}@example.invalid` });
          await handle
            .insert(auth.organization)
            .values({ id: organizationId, name: "PG team", slug: `pg-${organizationId}` });
          await handle.insert(schema.subscriptions).values({
            userId,
            organizationId,
            planId: "team",
            provider: "stripe",
            providerSubscriptionId: subscriptionId,
            status: "active",
            interval: "month",
            monthlyCredits: 20,
          });
          assert.deepEqual(await queries.getOrgSeatCap(handle, organizationId), {
            seats: 5,
            hasTeamSubscription: true,
          });
          await store.transaction(async (nested) => {
            assert.equal(nested, unit);
            assert.equal(await nested.billing.organizationHasBillingHistory(organizationId), true);
          }, unit);
          await commerce.join(unit).syncSubscription({
            provider: "stripe",
            providerSubscriptionId: subscriptionId,
            subject: { userId, organizationId },
            planId: "team",
            status: "past_due",
            interval: "month",
            monthlyCredits: 20,
          });
          assert.equal(
            (await queries.getOrgSeatCap(handle, organizationId)).hasTeamSubscription,
            true,
          );
          throw new Error("rollback coordinate");
        }),
        /rollback coordinate/,
      );
      assert.equal(flushed, 0);
      assert.equal(discarded, 1);
      const [surviving] = await db
        .select({ id: schema.subscriptions.id })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.providerSubscriptionId, subscriptionId));
      assert.equal(surviving, undefined);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

test(
  "PG commerce refuses root, foreign, other-instance, and closed units before any write",
  {
    skip: databaseUrl
      ? false
      : "COMMERCE_PG_DATABASE_URL is not injected; controller runs this after schema freeze",
  },
  async () => {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { eq } = await import("drizzle-orm");
    const { bindPgCommerceUnit, coordinatePgCommerce, createPgCommerceStore } =
      await import("@sunpcm/niu-persistence-pg/commerce");
    const { createCommerce } = await import("../../packages/commerce/dist/index.js");
    const schema = await import("@sunpcm/niu-persistence-pg/schema/commerce");
    const auth = await import("@sunpcm/niu-persistence-pg/schema/auth");
    const sql = postgres(databaseUrl, { max: 1 });
    const foreignUrl = process.env.COMMERCE_PG_FOREIGN_DATABASE_URL?.trim() ?? "";
    if (foreignUrl) {
      const foreignName = databaseNameFromUrl(foreignUrl);
      const foreignUser = usernameFromUrl(foreignUrl);
      if (foreignName) rejectDatabaseName(foreignName, "COMMERCE_PG_FOREIGN_DATABASE_URL database");
      if (foreignUser && foreignUser !== REQUIRED_ROLE) {
        throw new Error(`COMMERCE_PG_FOREIGN_DATABASE_URL user must be ${REQUIRED_ROLE}`);
      }
    }
    const foreignSql = foreignUrl ? postgres(foreignUrl, { max: 1 }) : null;
    const userId = crypto.randomUUID();
    const orderId = `own-${userId}`;
    let verifiedIdentity = false;
    try {
      const [identity] = await sql`select current_database() as database, current_user as role`;
      assertCommercePgIdentity(identity);
      verifiedIdentity = true;
      const db = drizzle(sql);
      await db.insert(auth.user).values({ id: userId, email: `${userId}@example.invalid` });
      const store = createPgCommerceStore(db);
      assert.equal(store.adopt, undefined);
      let flushed = 0;
      const committedTasks = [];
      const notices = [];
      const commerce = createCommerce({
        productId: "pg-commerce-owner",
        catalog: { getPlanById: () => undefined, findPlanByProviderPriceId: () => undefined },
        clock: { now: () => new Date("2026-02-01T00:00:00.000Z") },
        identity: {
          async getFreshPrincipal() {
            return null;
          },
          async isLiveMember() {
            return false;
          },
        },
        store,
        logger: { warn() {}, error() {} },
        schedulePostCommit(task) {
          flushed += 1;
          committedTasks.push(task);
        },
        notifier: {
          async onOrderCommitted(notice) {
            notices.push(notice);
          },
        },
      });
      const purchase = {
        provider: "stripe",
        providerOrderId: orderId,
        subject: { userId, organizationId: null },
        planId: "pack",
        credits: 1,
        amountTotal: 100,
        currency: "usd",
      };
      async function purchased() {
        const [balance] = await db
          .select({ purchased: schema.creditBalances.purchasedCredits })
          .from(schema.creditBalances)
          .where(eq(schema.creditBalances.userId, userId));
        const [order] = await db
          .select({ id: schema.orders.id })
          .from(schema.orders)
          .where(eq(schema.orders.providerOrderId, orderId));
        return { purchased: balance?.purchased ?? 0, order: order?.id ?? null };
      }
      const unboundWrite = () =>
        bindPgCommerceUnit(db).balances.write(
          { userId, organizationId: null },
          { subscription: 0, purchased: 1 },
          new Date(),
        );
      await assert.rejects(unboundWrite, /does not belong/);
      await assert.rejects(
        () => commerce.join(bindPgCommerceUnit(db)).fulfillOneTimePurchase(purchase),
        /does not belong/,
      );
      const other = createPgCommerceStore(db);
      await other.coordinate(
        {
          runtime: { deps: { store: other }, flushOuter() {}, discardOuter() {} },
        },
        async ({ handle }) => {
          await assert.rejects(
            () =>
              bindPgCommerceUnit(handle).balances.write(
                { userId, organizationId: null },
                { subscription: 0, purchased: 1 },
                new Date(),
              ),
            /does not belong/,
          );
          await assert.rejects(
            () => commerce.join(bindPgCommerceUnit(handle)).fulfillOneTimePurchase(purchase),
            /does not belong/,
          );
        },
      );
      await other.transaction(async (unit) => {
        await assert.rejects(
          () => commerce.join(unit).fulfillOneTimePurchase(purchase),
          /does not belong/,
        );
      });
      let closed;
      await store.transaction(async (unit) => {
        closed = unit;
      });
      await assert.rejects(
        () => commerce.join(closed).fulfillOneTimePurchase(purchase),
        /does not belong/,
      );
      assert.deepEqual(await purchased(), { purchased: 0, order: null });
      assert.equal(flushed, 0);

      if (foreignSql) {
        const [foreignIdentity] =
          await foreignSql`select current_database() as database, current_user as role`;
        if (foreignIdentity.role !== REQUIRED_ROLE) {
          throw new Error(`foreign commerce role must be ${REQUIRED_ROLE}`);
        }
        rejectDatabaseName(foreignIdentity.database, "foreign current_database()");
        if (foreignIdentity.database === identity.database) {
          throw new Error("COMMERCE_PG_FOREIGN_DATABASE_URL must be a different N3 database");
        }
        const foreignDb = drizzle(foreignSql);
        const foreignStore = createPgCommerceStore(foreignDb);
        await assert.rejects(
          () =>
            bindPgCommerceUnit(foreignDb).balances.write(
              { userId, organizationId: null },
              { subscription: 0, purchased: 1 },
              new Date(),
            ),
          /does not belong/,
        );
        await foreignStore.coordinate(
          {
            runtime: { deps: { store: foreignStore }, flushOuter() {}, discardOuter() {} },
          },
          async ({ handle }) => {
            await assert.rejects(
              () =>
                bindPgCommerceUnit(handle).balances.write(
                  { userId, organizationId: null },
                  { subscription: 0, purchased: 1 },
                  new Date(),
                ),
              /does not belong/,
            );
          },
        );
        await foreignStore.transaction(async (unit) => {
          await assert.rejects(
            () => commerce.join(unit).fulfillOneTimePurchase(purchase),
            /does not belong/,
          );
        });
        const [foreignBalance] = await foreignDb
          .select({ purchased: schema.creditBalances.purchasedCredits })
          .from(schema.creditBalances)
          .where(eq(schema.creditBalances.userId, userId));
        assert.equal(foreignBalance, undefined);
        assert.deepEqual(await purchased(), { purchased: 0, order: null });
      }

      const committed = await coordinatePgCommerce(store, commerce, async ({ unit }) => {
        assert.equal(flushed, 0);
        return commerce.join(unit).fulfillOneTimePurchase(purchase);
      });
      assert.equal(committed.created, true);
      assert.equal(flushed, 1);
      assert.equal(committedTasks.length, 1);
      assert.deepEqual(notices, []);
      await committedTasks.shift()();
      assert.deepEqual(notices, [
        {
          orderType: "one_time",
          planId: "pack",
          creditsGranted: 1,
          amountTotal: 100,
          currency: "usd",
          userId,
        },
      ]);
      assert.deepEqual(await purchased(), { purchased: 1, order: (await purchased()).order });
      const afterCommit = await purchased();
      assert.equal(afterCommit.purchased, 1);
      assert.ok(afterCommit.order);

      let failedFlush = 0;
      const failedTasks = [];
      const failedNotices = [];
      const failing = createCommerce({
        productId: "pg-commerce-owner-fail",
        catalog: { getPlanById: () => undefined, findPlanByProviderPriceId: () => undefined },
        clock: { now: () => new Date("2026-02-01T00:00:00.000Z") },
        identity: {
          async getFreshPrincipal() {
            return null;
          },
          async isLiveMember() {
            return false;
          },
        },
        store,
        logger: { warn() {}, error() {} },
        schedulePostCommit(task) {
          failedFlush += 1;
          failedTasks.push(task);
        },
        notifier: {
          async onOrderCommitted(notice) {
            failedNotices.push(notice);
          },
        },
      });
      const failedOrder = `fail-${userId}`;
      await assert.rejects(
        coordinatePgCommerce(store, failing, async ({ unit }) => {
          await failing
            .join(unit)
            .fulfillOneTimePurchase({ ...purchase, providerOrderId: failedOrder });
          throw new Error("rollback order and ledger");
        }),
        /rollback order and ledger/,
      );
      assert.equal(failedFlush, 0);
      assert.equal(failedTasks.length, 0);
      assert.deepEqual(failedNotices, []);
      const [failed] = await db
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(eq(schema.orders.providerOrderId, failedOrder));
      assert.equal(failed, undefined);
      assert.equal((await purchased()).purchased, 1);
    } finally {
      if (verifiedIdentity) {
        const db = drizzle(sql);
        await db
          .delete(schema.creditTransactions)
          .where(eq(schema.creditTransactions.userId, userId));
        await db.delete(schema.creditBalances).where(eq(schema.creditBalances.userId, userId));
        await db.delete(schema.orders).where(eq(schema.orders.userId, userId));
        await db.delete(auth.user).where(eq(auth.user.id, userId));
      }
      await sql.end({ timeout: 5 });
      if (foreignSql) await foreignSql.end({ timeout: 5 });
    }
  },
);
