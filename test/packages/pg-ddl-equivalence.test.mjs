import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const appDirectory = new URL("../../apps/web/src/lib/db/migrations/", import.meta.url);
const moduleDirectory = new URL(
  "../../packages/persistence-pg/src/migrations/modules/",
  import.meta.url,
);
const appSql = readdirSync(appDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(new URL(name, appDirectory), "utf8"))
  .join("\n--> statement-breakpoint\n");
const moduleSql = readdirSync(moduleDirectory)
  .filter((name) => name.endsWith(".ts") && name !== "index.ts")
  .sort()
  .map((name) => {
    const source = readFileSync(new URL(name, moduleDirectory), "utf8");
    const match = source.match(/\bsql:\s*`([\s\S]*)`,\s*\n};\s*$/);
    assert.ok(match, `${name}: expected a literal migration SQL template`);
    return match[1];
  })
  .join("\n--> statement-breakpoint\n");

const appTables = new Set(["posts", "tags", "post_tags", "feedback", "feedback_replies"]);
const appEnums = new Set([
  "post_status",
  "post_type",
  "post_visibility",
  "feedback_priority",
  "feedback_status",
  "feedback_type",
]);

function statements(sql) {
  // 只折叠引号外的空白，不能把枚举值或默认字符串中的空格抹掉。
  return sql
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\s+/g, (token) => (/^\s/.test(token) ? " " : token))
        .trim(),
    )
    .filter(Boolean);
}

function isApplicationOnly(statement) {
  const table =
    statement.match(/^(?:CREATE TABLE|ALTER TABLE) "([^"]+)" /) ??
    statement.match(/^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "([^"]+)" /);
  if (table) return appTables.has(table[1]);
  const type = statement.match(/^CREATE TYPE "public"\."([^"]+)" AS ENUM\(/);
  return !!type && appEnums.has(type[1]);
}

function assertEquivalent(app, modules) {
  const application = statements(app);
  const platform = statements(modules);
  assert.ok(application.length && platform.length, "both migration chains must contain SQL");
  const sessionCreate = 'CREATE TABLE "session" (';
  const sessionAlter = 'ALTER TABLE "session" ADD COLUMN "impersonated_by" uuid;';
  assert.equal(
    application.filter((sql) => sql === sessionAlter).length,
    1,
    "legacy session must add impersonated_by exactly once as uuid",
  );
  assert.equal(platform.filter((sql) => sql.startsWith(sessionCreate)).length, 1);
  const packageSession = platform.find((sql) => sql.startsWith(sessionCreate));
  assert.equal(
    packageSession.split('"impersonated_by" uuid, ').length,
    2,
    "package session must inline the exact impersonated_by uuid column once",
  );
  const legacySession = application.find((sql) => sql.startsWith(sessionCreate));
  assert.ok(
    legacySession && !legacySession.includes('"impersonated_by"'),
    "legacy CREATE must not inline impersonated_by",
  );

  const remaining = application.filter((sql) => sql !== sessionAlter);
  for (const statement of platform) {
    // 只处理合同写明的这一列；其余列、约束、类型和索引均逐语句比较。
    const shared =
      statement === packageSession ? statement.replace('"impersonated_by" uuid, ', "") : statement;
    const index = remaining.indexOf(shared);
    assert.notEqual(index, -1, `package DDL missing or changed in application: ${shared}`);
    remaining.splice(index, 1);
  }
  for (const statement of remaining)
    assert.ok(isApplicationOnly(statement), `unapproved application-only DDL: ${statement}`);
}

test("the two current migration chains have equivalent shared DDL", () => {
  assertEquivalent(appSql, moduleSql);
});

test("an added shared-table DDL on either side is rejected without editing migrations", () => {
  const addition =
    '\n--> statement-breakpoint\nALTER TABLE "user" ADD COLUMN "phase0_guard_probe" text;';
  assert.throws(() => assertEquivalent(appSql + addition, moduleSql));
  assert.throws(() => assertEquivalent(appSql, moduleSql + addition));
  // 原始输入保持不变，变异只作用于内存副本。
  assertEquivalent(appSql, moduleSql);
});

test("an allowlisted-looking index name cannot hide a shared-table change", () => {
  const addition =
    '\n--> statement-breakpoint\nCREATE INDEX "posts_probe" ON "user" USING btree ("email");';
  assert.throws(() => assertEquivalent(appSql + addition, moduleSql));
});

test("the impersonated_by exception requires the exact uuid column and legacy ALTER", () => {
  assert.throws(() =>
    assertEquivalent(
      appSql,
      moduleSql.replace('"impersonated_by" uuid,', '"impersonated_by" text,'),
    ),
  );
  assert.throws(() =>
    assertEquivalent(
      appSql.replace('ALTER TABLE "session" ADD COLUMN "impersonated_by" uuid;', ""),
      moduleSql,
    ),
  );
});

test("whitespace normalization must preserve quoted values", () => {
  assert.throws(() => assertEquivalent(appSql, moduleSql.replace("'admin'", "'admin  '")));
});
