# 统一迁移 runner 与 canonical journal

本文记录 N2 migration 单元把产品 CLI 与领域测试统一到同一个 canonical runner 的实现，以及兼容路径、checksum 语义和自测边界。它不是独立验收结论，PG 回归由主控受控代跑。

## 文件

- `apps/web/src/lib/db/migration-types.ts`：`MigrationFile`、`MigrationSource`、`MigrationReport`、`MigrationRunnerOptions` 等类型。
- `apps/web/src/lib/db/migration-source.ts`：严格消费 `meta/_journal.json` 的冻结顺序，派生文件名并计算两种 checksum；缺/坏 meta、缺声明 SQL、重复身份、异常 tag path 都立即失败，不兜底目录排序。
- `apps/web/src/lib/db/migration-runner.ts`：canonical runner（advisory lock + journal + DDL + 验证，同一事务）。
- `apps/web/scripts/migrate.ts`：产品 CLI 入口。
- `test/domain/helpers.ts`：`migrate()` 改为消费 runner，不再复制第二套算法。
- `test/domain/migration.test.ts`：新建、重复、并发、checksum drift、DDL 失败、journal 写失败、修复重跑、参考库兼容校验。
- `test/domain/migration-source.test.ts`：把真实资源复制到自有 scratch，覆盖缺声明资源、损坏/空 meta、重复身份、异常 tag path 与正常副本读取（无 PG 依赖）。

## Checksum 语义

- 身份 checksum 是 drizzle 语句流 hash：`raw.split("--> statement-breakpoint").map(trim).filter(Boolean).join(";\n")` 的 SHA-256，不是 raw 文件 hash。
- 每个 `MigrationFile` 同时携带 `checksum`（语句流 hash，journal 身份）和 `rawChecksum`（raw 字节 hash，补充完整性），后者进入 `MigrationReport.files` 与 CLI 输出，但不写入 journal，避免改动参考库既有 journal schema。
- 身份按文件 name（含 `.sql`）写入 `_n2_migration_journal`，绝不用 `user` 表是否存在作为跳过依据；`user` / `session.impersonated_by` 只作为应用后的验证信号。
- 默认源严格消费已冻结的 meta/资源顺序：`_journal.json` 不可读、空 entries、任一声明 SQL 缺失、tag 重复或 tag 派生为非 basename 路径都抛错，绝不让缺失旧 SQL 从待校验清单消失；不补写/改名历史文件。

## Runner 事务与故障语义

- 每次运行在单事务内：`pg_advisory_xact_lock` 串行化并发写者，检查 guard，建 journal（`if not exists`），逐文件比对 checksum，执行 DDL，写 journal，最后验证 `user` 与 `session.impersonated_by`。
- 已存在且 checksum 一致则跳过；checksum 漂移抛错。DDL 失败、journal 写失败或验证失败整轮回滚，不留下半迁移或没有 DDL 的 journal 行。
- 资源可注入（`source`、`journalWrite`），仅测试故障 fixture 使用；生产默认走同一文件系统 source 与参数化 INSERT。
- 产品 CLI 只消费 `_n2_migration_journal`，不落另一个 drizzle-kit migrate 账本。旧两条 SQL 文件名 / tag / meta / raw bytes 原样读取，不重命名。

## 运行方式

canonical 产品入口已接到 `apps/web/package.json` 的 `db:migrate`。由主控在 Node 24、pnpm 10.26 的冻结环境中注入 `DATABASE_URL` 后运行：

```bash
pnpm --filter @niu/web db:migrate
```

CLI 不自行加载 `.env`；`DATABASE_URL` 由运行环境或主控受控注入。不要绕过 package script 直接复制另一套迁移命令。

领域测试需要下面三个环境变量（全部由主控 runtime 合成注入，不打印、不落仓库）：

- `DATABASE_URL`：参考库 `nexty_overnight_20261105_test`（只兼容校验，不清表/重建）。
- 额外的 `MIGRATION_C01_DATABASE_URL`：空库 `nexty_overnight_20261105_migration_c01`（新建/重复/并发）。
- 额外的 `MIGRATION_FAULT_DATABASE_URL`：空库 `nexty_overnight_20261105_migration_fault_c01`（drift/DDL/写失败/修复）。

三个连接均使用测试角色 `nexty_overnight_test`。两个任务空库由测试用 `drop schema public cascade; create schema public` 做自有资源清理；参考库不被清表或重建。

`migration-source.test.ts` 无 PG/env 依赖，只复制资源到 `os.tmpdir()` 自有 scratch 并清理，不变异真实历史 SQL/meta。

## 接线建议（app 集成人员）

> 历史接线草案曾建议显式追加两个迁移测试文件并新增名为 `migrate` 的 app script；当前实际接线已由根 `test:domain` 的 `test/domain/*.test.ts` glob 和 app 的 `db:migrate` 取代，该旧建议不再执行。

当前接线已完成：

- `apps/web/package.json` 使用 `"db:migrate": "tsx scripts/migrate.ts"`。
- 根 `test:domain` 自动匹配 `test/domain/*.test.ts`，不再维护容易漂移的手工文件列表；`test/domain/routing.test.mjs` 仍由独立的 `test:routing` 运行。
- 迁移 PG 回归只在全部 writer 停写后，由主控合成注入前文三个数据库变量并统一运行。

本单元只收口公开文档，不修改产品/测试/package/lock/schema，也不以文档修改替代 PG 或全树验收。
