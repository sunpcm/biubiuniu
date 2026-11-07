import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, count, eq } from "drizzle-orm";

import { closeDatabase, db } from "@/lib/db";
import { user as userTable, creditTransactions, creditBalances } from "@/lib/db/schema";
import { decideSignupGift } from "@/lib/signup-gift-gate";
import { createGrantSignupRewards } from "@/lib/auth/signup-rewards";
import { saveSignupBlocklist } from "@/lib/signup-blocklist";
import { creditsConfig } from "@/config/credits";
import { UNKNOWN_IP } from "@/lib/ip-shared";
import type { RedisSetOptions, RedisValue, UnifiedRedis } from "@/lib/redis/types";

import { migrate, resetSyntheticData } from "./helpers";
import { assembleAuth, authBaseUrl, siteUrl, InMemoryRedis } from "./auth-assembly";

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

async function signInNewUser(prefix: string) {
  const email = uniqueEmail(prefix);
  const otp = await sendOtp(email);
  await auth.api.signInEmailOTP({ body: { email, otp } });
  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.ok(row, "sign-in should create the user");
  return { email, userId: row.id };
}

async function createUserRow(prefix: string) {
  const email = uniqueEmail(prefix);
  const [row] = await db.insert(userTable).values({ email }).returning({ id: userTable.id });
  return { email, userId: row.id };
}

class FailingRedis implements UnifiedRedis {
  async get<T = unknown>(_key: string): Promise<T | null> {
    throw new Error("redis down");
  }
  async set(_key: string, _value: RedisValue, _options?: RedisSetOptions): Promise<void> {
    throw new Error("redis down");
  }
  async setNx(_key: string, _value: RedisValue, _exSeconds: number): Promise<boolean> {
    throw new Error("redis down");
  }
  async incr(_key: string): Promise<number> {
    throw new Error("redis down");
  }
  async expire(_key: string, _seconds: number): Promise<boolean> {
    throw new Error("redis down");
  }
  async sadd(_key: string, ..._members: RedisValue[]): Promise<number> {
    throw new Error("redis down");
  }
  async srem(_key: string, ..._members: RedisValue[]): Promise<number> {
    throw new Error("redis down");
  }
  async sismember(_key: string, _member: RedisValue): Promise<number> {
    throw new Error("redis down");
  }
}

function noopLogger() {
  return { warn: () => {}, error: () => {} };
}

type AssembledAuth = ReturnType<typeof assembleAuth>;

/** Drive a full HTTP OTP signup (send + verify) against a real assembled auth. */
async function httpOtpSignup(instance: AssembledAuth, email: string): Promise<Response> {
  const send = await instance.handler.POST(
    new Request(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE_URL },
      body: JSON.stringify({ email, type: "sign-in" }),
    }),
  );
  assert.equal(send.status, 200, "send-verification-otp should succeed");
  const otp = instance.mail.last()!.options.reactProps?.otp as string;
  assert.equal(typeof otp, "string", "recorded OTP should be a string");
  return instance.handler.POST(
    new Request(`${BASE_URL}/api/auth/sign-in/email-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE_URL },
      body: JSON.stringify({ email, otp }),
    }),
  );
}

before(async () => {
  await migrate();
  await resetSyntheticData();
});

after(async () => {
  await closeDatabase();
});

test("A08: signup reward is granted exactly once through the real signup hook", async () => {
  const { email, userId } = await signInNewUser("a08-once");

  const [{ value: bonusCount }] = await db
    .select({ value: count() })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.userId, userId), eq(creditTransactions.type, "signup_bonus")));
  assert.equal(bonusCount, 1, "first signup grants one welcome bonus");

  const [balance] = await db
    .select({ purchased: creditBalances.purchasedCredits })
    .from(creditBalances)
    .where(eq(creditBalances.userId, userId));
  assert.equal(
    balance?.purchased,
    creditsConfig.signupBonusCredits,
    "welcome bonus lands in the purchased bucket",
  );

  // Sign the existing account back in — no new user, so no second bonus.
  const otp = await sendOtp(email);
  await auth.api.signInEmailOTP({ body: { email, otp } });

  const [{ value: afterCount }] = await db
    .select({ value: count() })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.userId, userId), eq(creditTransactions.type, "signup_bonus")));
  assert.equal(afterCount, 1, "existing-account sign-in must not re-grant");
});

test("A08: missing signals and a null Redis still grant the gift", async () => {
  assert.equal((await decideSignupGift({}, null)).grant, true, "no signals -> grant");
  assert.equal(
    (await decideSignupGift({ ip: UNKNOWN_IP, deviceHash: undefined }, new InMemoryRedis())).grant,
    true,
    "unknown IP + no device -> grant",
  );
});

test("A08: a Redis failure lets the gift through", async () => {
  const decision = await decideSignupGift(
    { ip: "203.0.113.7", deviceHash: "a".repeat(32) },
    new FailingRedis(),
  );
  assert.equal(decision.grant, true, "gate failure must not withhold the gift");
});

test("A08: per-IP cap withholds after the configured limit", async () => {
  const redis = new InMemoryRedis();
  for (let i = 0; i < creditsConfig.signupGiftClusterCaps.perIp; i += 1) {
    assert.equal((await decideSignupGift({ ip: "198.51.100.9" }, redis)).grant, true);
  }
  const withheld = await decideSignupGift({ ip: "198.51.100.9" }, redis);
  assert.equal(withheld.grant, false);
  assert.equal(withheld.reason, "ip_cap");
});

test("A08: per-device cap withholds after the configured limit", async () => {
  const redis = new InMemoryRedis();
  const deviceHash = "b".repeat(32);
  for (let i = 0; i < creditsConfig.signupGiftClusterCaps.perDevice; i += 1) {
    assert.equal((await decideSignupGift({ deviceHash }, redis)).grant, true);
  }
  const withheld = await decideSignupGift({ deviceHash }, redis);
  assert.equal(withheld.grant, false);
  assert.equal(withheld.reason, "device_cap");
});

test("A08: reward orchestration grants on Redis failure and withholds on cap", async () => {
  const userA = await createUserRow("a08-fault");
  const grantA = createGrantSignupRewards({
    redis: new FailingRedis(),
    notifySignupGiftWithheld: async () => {},
    logger: noopLogger(),
  });
  await grantA({ userId: userA.userId, email: userA.email, ip: "198.51.100.11" });

  const [aCount] = await db
    .select({ value: count() })
    .from(creditTransactions)
    .where(
      and(eq(creditTransactions.userId, userA.userId), eq(creditTransactions.type, "signup_bonus")),
    );
  assert.equal(aCount.value, 1, "Redis failure should still grant the bonus");

  // Pre-load the IP past its cap, then run orchestration: it must withhold.
  const redis = new InMemoryRedis();
  const userB = await createUserRow("a08-cap");
  const withheldReasons: string[] = [];
  const grantB = createGrantSignupRewards({
    redis,
    notifySignupGiftWithheld: async (params) => {
      withheldReasons.push(params.reason);
    },
    logger: noopLogger(),
  });
  for (let i = 0; i <= creditsConfig.signupGiftClusterCaps.perIp; i += 1) {
    await decideSignupGift({ ip: "198.51.100.12" }, redis);
  }
  await grantB({ userId: userB.userId, email: userB.email, ip: "198.51.100.12" });

  const [bCount] = await db
    .select({ value: count() })
    .from(creditTransactions)
    .where(
      and(eq(creditTransactions.userId, userB.userId), eq(creditTransactions.type, "signup_bonus")),
    );
  assert.equal(bCount.value, 0, "over-cap cluster must not grant the bonus");
  assert.ok(withheldReasons.includes("ip_cap"), "withholding should be observed");
});

test("A08: real signup is rejected by a blocklisted email with no user or gift", async () => {
  const email = uniqueEmail("a08-block");
  const redis = new InMemoryRedis();
  await saveSignupBlocklist({ prefixes: [], suffixes: [], exact: [email], ips: [] }, redis);
  const instance = assembleAuth({ redis, getClientIP: async () => UNKNOWN_IP });

  const [{ value: before }] = await db
    .select({ value: count() })
    .from(creditTransactions)
    .where(eq(creditTransactions.type, "signup_bonus"));

  const res = await httpOtpSignup(instance, email);
  assert.equal(res.status, 403, "blocklisted email must be rejected");

  const rows = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.equal(rows.length, 0, "blocklisted signup must not create a user");

  const [{ value: after }] = await db
    .select({ value: count() })
    .from(creditTransactions)
    .where(eq(creditTransactions.type, "signup_bonus"));
  assert.equal(after, before, "blocklisted signup must not grant a welcome bonus");
});

test("A08: real signup respects the per-IP gift cap through the hook wiring", async () => {
  const redis = new InMemoryRedis();
  const ip = "198.51.100.21";
  for (let i = 0; i < creditsConfig.signupGiftClusterCaps.perIp; i += 1) {
    await decideSignupGift({ ip }, redis);
  }

  const instance = assembleAuth({
    redis,
    getClientIP: async () => ip,
    getCookie: async () => undefined,
  });
  const email = uniqueEmail("a08-ipcap-real");
  const res = await httpOtpSignup(instance, email);
  assert.equal(res.status, 200, "over-cap signup must still register");

  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.ok(row, "over-cap signup must still create the user");

  const [{ value: bonusCount }] = await db
    .select({ value: count() })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.userId, row.id), eq(creditTransactions.type, "signup_bonus")));
  assert.equal(bonusCount, 0, "over-cap signup must not grant the welcome bonus");
});

test("A08: real signup with a null Redis still grants the gift", async () => {
  const instance = assembleAuth({
    redis: null,
    getClientIP: async () => "203.0.113.8",
    getCookie: async () => undefined,
  });
  const email = uniqueEmail("a08-null-redis-real");
  const res = await httpOtpSignup(instance, email);
  assert.equal(res.status, 200, "null-Redis signup must register");

  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.ok(row, "null-Redis signup must create the user");

  const [{ value: bonusCount }] = await db
    .select({ value: count() })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.userId, row.id), eq(creditTransactions.type, "signup_bonus")));
  assert.equal(bonusCount, 1, "null-Redis signup must still grant the welcome bonus");
});

test("A08: real signup with a failing Redis still grants the gift", async () => {
  const instance = assembleAuth({
    redis: new FailingRedis(),
    getClientIP: async () => "203.0.113.9",
    getCookie: async () => "a".repeat(32),
  });
  const email = uniqueEmail("a08-fail-redis-real");
  const res = await httpOtpSignup(instance, email);
  assert.equal(res.status, 200, "failing-Redis signup must register");

  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  assert.ok(row, "failing-Redis signup must create the user");

  const [{ value: bonusCount }] = await db
    .select({ value: count() })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.userId, row.id), eq(creditTransactions.type, "signup_bonus")));
  assert.equal(bonusCount, 1, "failing-Redis signup must still grant the welcome bonus");
});
