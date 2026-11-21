# 根与 DB 公共装配说明

本文件记录 N3 准备子集中已完成的 root/DB 公共包接线，供后续 Auth/Commerce/UI
集成 owner 复核。

## 公共包映射

已消费的正式发布候选包（`@sunpcm/niu-*`，`0.1.0-next.0`）：

| 包 | 公开入口 |
| --- | --- |
| `@sunpcm/niu-db` | `createDatabase`、`createDatabaseConfig`（连接工厂，不读 env、不建连接） |
| `@sunpcm/niu-contracts` | 跨边界类型、标识、`PAYMENT_PROVIDERS` |
| `@sunpcm/niu-utils` | 纯工具（无 React/Next/PG/provider） |
| `@sunpcm/niu-ui` | 基础组件、主题、`styles.css` |
| `@sunpcm/niu-auth` | Better Auth 配置工厂、权限、身份/组织接口 |
| `@sunpcm/niu-commerce` | pricing/billing/credits/订阅/权益，provider 子路径 |
| `@sunpcm/niu-next` | `/auth`、`/client`、响应映射、Next 专用适配 |
| `@sunpcm/niu-persistence-pg` | `/schema/auth`、`/schema/commerce`、`/migrations`（`runMigrations`/`checkProfileCompatibility`） |

内部 `@niu/mail` 与 `@niu/*-config` 尚未进入正式发布候选，本轮保留原名；后续
N5 统一映射到 `@sunpcm/niu-mail` 与 `@sunpcm/niu-*-config`。

## 应用 DB 装配

- `apps/web/src/composition/db.ts` 是唯一装配位置：读取 `DATABASE_URL`，按平台/
  数据库类型生成显式配置，调用 `@sunpcm/niu-db` 的 `createDatabase`。
- `apps/web/src/lib/db/index.ts` 保留 `db`/`closeDatabase`/`isDatabaseEnabled`
  单例，供旧消费者继续 `import { db } from "@/lib/db"` 使用。
- `apps/web/src/lib/db/config.ts` 保留 `createDatabase`（返回 Drizzle 实例）的
  薄兼容导出，供 `scripts/create-superadmin.ts` 使用。
- 包（`@sunpcm/niu-db`）不读 `process.env`、不加载 dotenv、不在导入时建连接。

## Schema 复用

`apps/web/src/lib/db/schema.ts` 只声明 app 内 CMS/反馈业务表；Auth/Commerce
核心表通过 `export *` 复用 `@sunpcm/niu-persistence-pg/schema/auth` 与
`/schema/commerce`，导出名与推断类型保持一致。核心表不再在 app 内重复声明。

## 迁移路径与只读兼容

- 旧 canonical 链（`_n2_migration_journal`）继续由
  `apps/web/src/lib/db/migration-runner.ts` 的 `runMigrations` 执行；
  `apps/web/scripts/migrate.ts` 是 canonical 产品迁移入口。
- 新增 `apps/web/scripts/check-db-compat.ts`：显式只读校验旧
  `_n2_migration_journal` 两条 identity/checksum 与必要 schema，不建 journal、
  不写 `_niu` 元数据、不 DDL；未调用不冒称启动校验完成。
- 新 `_niu` profile 链由 `@sunpcm/niu-persistence-pg` 的 `runMigrations` 与
  `checkProfileCompatibility` 提供，与旧链独立，互不混用。

## 依赖边界固定检查

`scripts/dependency-boundaries.mjs` 固定检查：包图无环、无未声明依赖（第三方与
workspace 均按真正包根归一化，含 scoped/subpath，Node builtin 排除）、workspace
子路径须在 `exports` 声明、运行时 value 依赖不得只藏在 devDependencies、包不引用
`@/` 或相对路径逃逸到 app、core（contracts/utils/auth/commerce）根入口不泄漏
Next/React/PG/provider 且 provider/client 子路径合法可选依赖不误判、`ui` 不泄漏
server-only/Node/数据库。core 根入口按真实 JS/d.ts 的 import/re-export 闭包判定
可达文件（不按目录名猜），并拒绝根闭包直接读 `process.env`；导出目标缺 dist 或
缺 types 不默认 green，wildcard 导出展开并校验 JS/types 成对。
`test/packages/dependency-boundaries.test.mjs` 含第三方/子路径/builtin/runtime-vs-type/
根再导出 provider 绕过/缺 types/wildcard/合法 provider 隔离/Auth 根 React/产品 env/
反向相对路径等负向变异用例；主控全停后实际删/加边做 mutation 验证。
