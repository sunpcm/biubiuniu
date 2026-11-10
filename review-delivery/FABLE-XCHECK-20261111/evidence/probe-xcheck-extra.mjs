// 交叉复核补充探针（FABLE-XCHECK-20261111）。只读评审产物，不属于产品测试，不改任何产品文件。
// 只做合成数据操作；身份 guard 与上一轮探针相同：库名必须以 fable_probe_ 开头、与期望值一致、且为空库。
//   X1 组织任务卡在 unknown：组织删除被哪条外键拒绝；发起人账号是否仍可删除。
//   X2 C5 热路径实测：一张 5 MiB 输入图的任务，列表 / 单查 / 状态推进各自从 PG 拉回多少字节。
//   X3 unknown 之后同一 requestKey 重放：返回旧任务、不新建、不再扣费（用户无法靠重试自救）。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { runMigrations } from "@sunpcm/niu-persistence-pg/migrations";
import { createPgCommerceStore } from "@sunpcm/niu-persistence-pg/commerce";
import { createNanoCoordinator } from "@sunpcm/niu-persistence-pg/nano";
import { member, organization, user as userTable } from "@sunpcm/niu-persistence-pg/schema/auth";
import { createCommerce } from "@sunpcm/niu-commerce";

const url = process.env.FABLE_PROBE_PG_URL;
const expectedDb = process.env.FABLE_PROBE_EXPECTED_DB;
if (!url || !expectedDb || !expectedDb.startsWith("fable_probe_")) {
  console.error("SKIP: FABLE_PROBE_PG_URL / FABLE_PROBE_EXPECTED_DB(fable_probe_*) 未注入，未验证");
  process.exit(2);
}
const PRODUCT = "fable-probe";
const sql = postgres(url, { max: 4, onnotice() {} });
const [{ database }] = await sql`select current_database() as database`;
assert.equal(database, expectedDb, "身份 guard 失败：拒绝在非预期库上执行");
const empty = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
assert.equal(empty[0].n, 0, "探针要求空库，拒绝在已有 schema 的库上执行");
await runMigrations({ url, profile: "nano_payments", guard: (db) => assert.equal(db, expectedDb) });

const db = drizzle(sql);
const store = createPgCommerceStore(db);
const commerce = createCommerce({
  productId: PRODUCT,
  catalog: { getPlanById: () => undefined, findPlanByProviderPriceId: () => undefined },
  clock: { now: () => new Date() },
  identity: { async getFreshPrincipal() { return null; }, async isLiveMember() { return true; } },
  store,
  logger: { warn() {}, error() {} },
  schedulePostCommit() {},
  notifier: { async onOrderCommitted() {} },
});
const coordinator = createNanoCoordinator({ db, store, commerce, productId: PRODUCT });
const results = {};
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

async function newUser(tag, credits = 0) {
  const id = randomUUID();
  await db.insert(userTable).values({ id, email: `${tag}-${id}@example.invalid` });
  if (credits) await commerce.grantPurchasedCredits({ userId: id, amount: credits, note: "probe-seed" });
  return id;
}
async function toUnknown(taskId, tag) {
  const claim = { leaseOwner: `dead-${tag}`, leaseToken: randomUUID() };
  await coordinator.markLeased(taskId, claim, new Date(Date.now() + 200));
  await coordinator.markDispatching(taskId, tag, claim);
  return coordinator.markUnknown(taskId);
}

// X1
try {
  const actor = await newUser("x1");
  const orgId = randomUUID();
  await db.insert(organization).values({ id: orgId, name: "probe-org", slug: `probe-${orgId}` });
  await db.insert(member).values({ id: randomUUID(), organizationId: orgId, userId: actor, role: "owner" });
  await commerce.grantPurchasedCredits({ userId: null, organizationId: orgId, amount: 2, note: "probe-seed" });
  const { task } = await coordinator.admit({
    productId: PRODUCT, subject: { userId: null, organizationId: orgId }, actorUserId: actor,
    feature: "nano-image", requestKey: "x1", contentSummary: "sum-x1", cost: 1,
    inputRef: { prompt: "p", imageData: null, mimeType: null },
  });
  assert.equal((await toUnknown(task.id, "x1")).status, "unknown");
  let orgErr = null;
  try { await sql`delete from organization where id = ${orgId}`; } catch (e) { orgErr = e; }
  assert.equal(orgErr?.code, "23503");
  const firstBlocker = String(orgErr.constraint_name);
  // 列出所有指向 organization 且会拒绝删除的外键（r = RESTRICT，a = NO ACTION）。
  const blockers = await sql`
    select conrelid::regclass::text || '.' || conname as fk
    from pg_constraint
    where contype = 'f' and confrelid = 'organization'::regclass and confdeltype in ('r', 'a')
    order by 1`;
  // 发起人：member 行级联删除，active job 不挂 user_id，所以账号能删。
  await sql`delete from "user" where id = ${actor}`;
  const [left] = await sql`select count(*)::int as n from "user" where id = ${actor}`;
  assert.equal(left.n, 0);
  results.X1 = { deleteOrganization: "23503", firstBlocker, allRestrictingFks: blockers.map((b) => b.fk), actorUserDeleted: true };
} catch (error) {
  results.X1 = `未完成（记为未验证）：${error?.message ?? error}`;
}

// X2
{
  const userId = await newUser("x2", 5);
  const imageData = Buffer.alloc(5 * 1024 * 1024, 7).toString("base64");
  const { task } = await coordinator.admit({
    productId: PRODUCT, subject: { userId, organizationId: null }, actorUserId: userId,
    feature: "nano-image", requestKey: "x2", contentSummary: "sum-x2", cost: 1,
    inputRef: { prompt: "p", imageData, mimeType: "image/png" },
  });
  const t0 = performance.now();
  const page = await coordinator.listBySubject(`user:${userId}`, { cursor: null, limit: 20 });
  const tList = performance.now() - t0;
  const t1 = performance.now();
  const one = await coordinator.get(task.id);
  const tGet = performance.now() - t1;
  const claim = { leaseOwner: "x2", leaseToken: randomUUID() };
  const leased = await coordinator.markLeased(task.id, claim, new Date(Date.now() + 60_000));
  const t2 = performance.now();
  const projected = await sql`select id, status, cost, created_at, updated_at from nano_tasks where id = ${task.id}`;
  const tProj = performance.now() - t2;
  results.X2 = {
    inputBase64Bytes: imageData.length,
    listBySubject_1row: { bytes: bytes(page.tasks), ms: Math.round(tList) },
    get_poll: { bytes: bytes(one), ms: Math.round(tGet) },
    markLeased_returning: { bytes: bytes(leased) },
    projected_select: { bytes: bytes(projected), ms: Math.round(tProj) },
    note: "列表 DTO 实际只用 id/status/cost/时间；前端轮询默认每秒一次 get",
  };
}

// X3
{
  const userId = await newUser("x3", 2);
  const input = {
    productId: PRODUCT, subject: { userId, organizationId: null }, actorUserId: userId,
    feature: "nano-image", requestKey: "x3", contentSummary: "sum-x3", cost: 1,
    inputRef: { prompt: "p", imageData: null, mimeType: null },
  };
  const first = await coordinator.admit(input);
  await toUnknown(first.task.id, "x3");
  const replay = await coordinator.admit(input);
  assert.equal(replay.created, false);
  assert.equal(replay.task.id, first.task.id);
  assert.equal(replay.task.status, "unknown");
  const [bal] = await sql`select subscription_credits + purchased_credits as total from credit_balances where user_id = ${userId}`;
  assert.equal(Number(bal.total), 1);
  results.X3 = "unknown 后同 requestKey 重放：created=false，返回同一 unknown 任务，余额仍为 1（不新建、不再扣、也不退）";
}

console.log(JSON.stringify({ probe: "xcheck-extra", database, results }, null, 2));
await sql.end();
