import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { closeDatabase, db } from "@/lib/db";
import { user as userTable, orders, creditTransactions } from "@/lib/db/schema";
import { createDomainCommerce } from "./commerce-assembly";
import type { OneTimePaymentInput } from "@/lib/billing/types";
import { eq } from "drizzle-orm";
import { databaseUrl, migrate, resetSyntheticData } from "./helpers";

const FLAG_TABLE = "test_credit_write_block";
const TRIGGER_FN = "test_block_credit_write_fn";
const TRIGGER = "test_block_credit_write_trg";

const domain = createDomainCommerce();
const { fulfillOneTimePurchase } = domain.fulfillment;

function sql() {
  return postgres(databaseUrl(), { max: 1 });
}

async function setBlock(enabled: boolean) {
  const client = sql();
  try {
    if (enabled) {
      await client.unsafe(`insert into ${FLAG_TABLE} (id) values (1) on conflict (id) do nothing`);
    } else {
      await client.unsafe(`delete from ${FLAG_TABLE} where id = 1`);
    }
  } finally {
    await client.end();
  }
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}@example.invalid`;
}

async function createUser(prefix: string) {
  const [row] = await db
    .insert(userTable)
    .values({ email: uniqueEmail(prefix) })
    .returning({ id: userTable.id });
  return row.id;
}

function oneTimeInput(providerOrderId: string, userId: string): OneTimePaymentInput {
  return {
    provider: "stripe",
    subject: { userId, organizationId: null },
    planId: "credit-pack-100",
    credits: 100,
    amountTotal: 1000,
    currency: "usd",
    providerOrderId,
  };
}

before(async () => {
  await migrate();

  const client = sql();
  try {
    await client.unsafe(`create table if not exists ${FLAG_TABLE} (id integer primary key)`);
    await client.unsafe(
      `create or replace function ${TRIGGER_FN}() returns trigger as $$ begin if exists (select 1 from ${FLAG_TABLE} where id = 1) then raise exception 'credit write blocked by test'; end if; return new; end; $$ language plpgsql`,
    );
    await client.unsafe(`drop trigger if exists ${TRIGGER} on credit_transactions`);
    await client.unsafe(
      `create trigger ${TRIGGER} before insert on credit_transactions for each row execute function ${TRIGGER_FN}()`,
    );
  } finally {
    await client.end();
  }
});

after(async () => {
  const client = sql();
  try {
    await client.unsafe(`drop trigger if exists ${TRIGGER} on credit_transactions`);
    await client.unsafe(`drop function if exists ${TRIGGER_FN}()`);
    await client.unsafe(`drop table if exists ${FLAG_TABLE}`);
  } catch {
    // best-effort cleanup
  } finally {
    await client.end();
  }
  await closeDatabase();
});

function creditWriteBlockedCause(error: unknown): { code: string; message: string } {
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (
      depth > 0 &&
      record.code === "P0001" &&
      typeof record.message === "string" &&
      record.message.includes("credit write blocked by test")
    ) {
      return { code: record.code, message: record.message };
    }
    current = record.cause;
    depth += 1;
  }
  throw new Error("expected Postgres cause P0001: credit write blocked by test");
}

test("credit write failure rolls back order/balance/ledger; recovery applies once", async () => {
  await resetSyntheticData();
  await setBlock(false);
  const userA = await createUser("atomicity");
  const providerOrderId = `atomicity-${crypto.randomUUID()}`;

  await setBlock(true);
  await assert.rejects(
    () => fulfillOneTimePurchase(oneTimeInput(providerOrderId, userA)),
    (error: unknown) => {
      const cause = creditWriteBlockedCause(error);
      assert.equal(cause.code, "P0001");
      assert.match(cause.message, /credit write blocked by test/);
      return true;
    },
  );

  // Zero write: no order, no ledger, no balance.
  const orderRows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.providerOrderId, providerOrderId));
  assert.equal(orderRows.length, 0);

  const ledgerRows = await db.select({ id: creditTransactions.id }).from(creditTransactions);
  assert.equal(ledgerRows.length, 0);

  assert.equal((await domain.credits.getUserCredits(userA)).totalCredits, 0);

  await setBlock(false);

  const result = await fulfillOneTimePurchase(oneTimeInput(providerOrderId, userA));
  assert.equal(result.created, true);
  assert.equal((await domain.credits.getUserCredits(userA)).purchasedCredits, 100);

  // Replay is idempotent — the same event grants only once.
  const replay = await fulfillOneTimePurchase(oneTimeInput(providerOrderId, userA));
  assert.equal(replay.created, false);
  assert.equal((await domain.credits.getUserCredits(userA)).purchasedCredits, 100);
});
