// 合成 PG 探针：C1（unknown 不释放 active job + RESTRICT）与 C2（SIGTERM 中断派发 → unknown）。
//
// 只读评审产物，不属于产品测试；不改任何产品文件。
// 运行前提（全部满足才运行，否则直接退出 2）：
//   FABLE_PROBE_PG_URL       指向一个新建的、空的隔离合成库
//   FABLE_PROBE_EXPECTED_DB  期望的 current_database()，必须以 fable_probe_ 开头
// 运行方式（仓库根目录，Node 24.15.0，已执行 pnpm build:packages）：
//   node review-delivery/FABLE-ARCH-20261110/evidence/probe-c1-c2-unknown.mjs
// 子进程模式（内部使用）：同一文件带参数 --child 运行。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql as dsql } from "drizzle-orm";
import { runMigrations } from "@sunpcm/niu-persistence-pg/migrations";
import { createPgCommerceStore } from "@sunpcm/niu-persistence-pg/commerce";
import { createNanoCoordinator } from "@sunpcm/niu-persistence-pg/nano";
import { nanoActiveJobs, nanoTasks } from "@sunpcm/niu-persistence-pg/schema/nano";
import { user as userTable } from "@sunpcm/niu-persistence-pg/schema/auth";
import { createCommerce } from "@sunpcm/niu-commerce";

const url = process.env.FABLE_PROBE_PG_URL;
const expectedDb = process.env.FABLE_PROBE_EXPECTED_DB;
if (!url || !expectedDb || !expectedDb.startsWith("fable_probe_")) {
  console.error("SKIP: FABLE_PROBE_PG_URL / FABLE_PROBE_EXPECTED_DB(fable_probe_*) 未注入，未验证");
  process.exit(2);
}
const PRODUCT = "fable-probe";

function makeCommerce(db) {
  const store = createPgCommerceStore(db);
  const commerce = createCommerce({
    productId: PRODUCT,
    catalog: { getPlanById: () => undefined, findPlanByProviderPriceId: () => undefined },
    clock: { now: () => new Date() },
    identity: { async getFreshPrincipal() { return null; }, async isLiveMember() { return false; } },
    store,
    logger: { warn() {}, error() {} },
    schedulePostCommit() {},
    notifier: { async onOrderCommitted() {} },
  });
  return { store, commerce, coordinator: createNanoCoordinator({ db, store, commerce, productId: PRODUCT }) };
}

async function balanceOf(sql, userId) {
  const rows = await sql`select subscription_credits + purchased_credits as total from credit_balances where user_id = ${userId}`;
  return rows.length ? Number(rows[0].total) : 0;
}

// ---------- 子进程：模拟 next start 下的进程内派发 + SIGTERM ----------
if (process.argv.includes("--child")) {
  const taskId = process.argv[process.argv.indexOf("--child") + 1];
  const sql = postgres(url, { max: 2 });
  const db = drizzle(sql);
  const { coordinator } = makeCommerce(db);
  // 与 apps/web/src/lib/nano/dispatch.ts:154-167 相同的推进顺序（lease → dispatching → provider）。
  const claim = { leaseOwner: `child-${process.pid}`, leaseToken: randomUUID() };
  // 与 apps/web/src/lib/nano/bootstrap.ts:71-73 相同：SIGTERM 只做 stop()（这里无 timer 可停）。
  process.once("SIGTERM", () => {});
  // 与 next@16.3.3 dist/server/lib/start-server.js:385-390 相同：等待 HTTP 结束后 process.exit(143)；
  // 本子进程没有 HTTP 请求，所以立即退出。
  process.on("SIGTERM", () => process.exit(143));
  await coordinator.markLeased(taskId, claim, new Date(Date.now() + 1_000));
  await coordinator.markDispatching(taskId, "probe-rk", claim);
  process.stdout.write("DISPATCHING\n");
  // 永不返回的 provider 调用（代表 Google 生成中的 10–120 秒窗口）。
  await new Promise(() => {});
}

// ---------- 父进程 ----------
const sql = postgres(url, { max: 4 });
const [{ database }] = await sql`select current_database() as database`;
assert.equal(database, expectedDb, "身份 guard 失败：拒绝在非预期库上执行");
const empty = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
assert.equal(empty[0].n, 0, "探针要求空库，拒绝在已有 schema 的库上执行");

const report = await runMigrations({ url, profile: "nano_payments", guard: (db) => assert.equal(db, expectedDb) });
console.log("migrated modules:", report.applied?.map?.((m) => m.name ?? m) ?? report);

const db = drizzle(sql);
const { commerce, coordinator } = makeCommerce(db);
const results = {};

async function newUserWithCredits(tag) {
  const id = randomUUID();
  await db.insert(userTable).values({ id, email: `${tag}-${id}@example.invalid` });
  await commerce.grantPurchasedCredits({ userId: id, amount: 2, note: "probe-seed" });
  return id;
}
function admitInput(userId, rk) {
  return {
    productId: PRODUCT,
    subject: { userId, organizationId: null },
    actorUserId: userId,
    feature: "nano-image",
    requestKey: rk,
    contentSummary: `sum-${rk}`,
    cost: 1,
    inputRef: { prompt: "p", imageData: "AA==", mimeType: "image/png" },
  };
}

// C1-a：进程丢失后 stale sweep → unknown；active job 仍在；余额已扣；用户删除被 RESTRICT 拒绝。
{
  const userId = await newUserWithCredits("c1a");
  const { task } = await coordinator.admit(admitInput(userId, "c1a"));
  const claim = { leaseOwner: "dead-owner", leaseToken: randomUUID() };
  await coordinator.markLeased(task.id, claim, new Date(Date.now() + 500));
  await coordinator.markDispatching(task.id, "c1a", claim);
  const later = new Date(Date.now() + 5_000);
  const stale = await coordinator.listStaleInFlight(later, 10);
  assert.ok(stale.some((t) => t.id === task.id));
  const unknown = await coordinator.markUnknown(task.id);
  assert.equal(unknown.status, "unknown");
  const active = await db.select().from(nanoActiveJobs).where(eq(nanoActiveJobs.taskId, task.id));
  assert.equal(active.length, 1, "unknown 未删除 active job");
  assert.equal(await balanceOf(sql, userId), 1, "积分已扣且未退");
  let deleteError = null;
  try { await sql`delete from "user" where id = ${userId}`; } catch (e) { deleteError = e; }
  assert.ok(deleteError, "期望用户删除失败");
  assert.equal(deleteError.code, "23503");
  assert.match(String(deleteError.constraint_name ?? deleteError.message), /nano_active_jobs_user_id/);
  // 无 claim 的 fail / complete / cancel 都不能把 unknown 推到终态。
  await assert.rejects(coordinator.fail(task.id), /Cannot fail/);
  await assert.rejects(coordinator.complete(task.id, { resultRef: "{}", resultSummary: "x" }), /Cannot complete/);
  await assert.rejects(coordinator.cancel(task.id), /Cannot cancel/);
  // 二次 stale sweep 不再选中 unknown（listStaleInFlight 只看 dispatching/running）。
  const again = await coordinator.listStaleInFlight(new Date(Date.now() + 60_000), 10);
  assert.ok(!again.some((t) => t.id === task.id));
  results.C1a = "unknown 保留 active job；余额 2→1 未退；DELETE user 23503；无 claim 的 fail/complete/cancel 全部拒绝";
}

// C1-b：原 owner 仍持有 claim 时，迟到结果可以 stage + complete，unknown → succeeded 并释放 active job。
{
  const userId = await newUserWithCredits("c1b");
  const { task } = await coordinator.admit(admitInput(userId, "c1b"));
  const claim = { leaseOwner: "slow-owner", leaseToken: randomUUID() };
  await coordinator.markLeased(task.id, claim, new Date(Date.now() + 500));
  await coordinator.markDispatching(task.id, "c1b", claim);
  await coordinator.markUnknown(task.id); // 另一个扫描者
  const staged = await coordinator.stageResult(task.id, JSON.stringify({ images: [], text: null }), "0 image(s)", claim);
  assert.ok(staged);
  const done = await coordinator.complete(task.id, { resultRef: staged.resultRef, resultSummary: "0 image(s)" }, claim);
  assert.equal(done.status, "succeeded");
  const active = await db.select().from(nanoActiveJobs).where(eq(nanoActiveJobs.taskId, task.id));
  assert.equal(active.length, 0);
  results.C1b = "同一 claim 的迟到结果可把 unknown 推到 succeeded 并删除 active job（仅限原进程仍存活）";
}

// C1-c：原 owner 以 claim 走 fail（确定 4xx 在 unknown 之后到达），unknown → failed 并退款。
{
  const userId = await newUserWithCredits("c1c");
  const { task } = await coordinator.admit(admitInput(userId, "c1c"));
  const claim = { leaseOwner: "slow-owner-2", leaseToken: randomUUID() };
  await coordinator.markLeased(task.id, claim, new Date(Date.now() + 500));
  await coordinator.markDispatching(task.id, "c1c", claim);
  await coordinator.markUnknown(task.id);
  const failed = await coordinator.fail(task.id, claim);
  assert.equal(failed.status, "failed");
  assert.equal(await balanceOf(sql, userId), 2);
  results.C1c = "持 claim 的 fail 可把 unknown 推到 failed 并退款（同样只限原进程）";
}

// C2：子进程在 dispatching 中收到 SIGTERM → 进程退出 → lease 过期 → stale sweep 变 unknown。
{
  const userId = await newUserWithCredits("c2");
  const { task } = await coordinator.admit(admitInput(userId, "c2"));
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", task.id], {
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (b) => { if (String(b).includes("DISPATCHING")) resolve(); });
    child.on("exit", (code) => reject(new Error(`child exited early ${code}`)));
  });
  const exitCode = await new Promise((resolve) => { child.removeAllListeners("exit"); child.on("exit", (c, s) => resolve(c ?? s)); child.kill("SIGTERM"); });
  assert.equal(exitCode, 143);
  const [row] = await db.select().from(nanoTasks).where(eq(nanoTasks.id, task.id));
  assert.equal(row.status, "dispatching");
  const stale = await coordinator.listStaleInFlight(new Date(Date.now() + 5_000), 10);
  assert.ok(stale.some((t) => t.id === task.id));
  const unknown = await coordinator.markUnknown(task.id);
  assert.equal(unknown.status, "unknown");
  assert.equal(await balanceOf(sql, userId), 1);
  results.C2 = `SIGTERM 后子进程 exit=${exitCode}，行停在 dispatching；lease 过期后被扫成 unknown，积分未退`;
}

console.log(JSON.stringify({ probe: "c1-c2-unknown", database, results }, null, 2));
await sql.end();
