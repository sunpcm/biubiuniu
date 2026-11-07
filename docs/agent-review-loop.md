# Agent Review Loop

本文记录当前可执行的检查、各包测试边界和公开仓内尚未覆盖的 runner，并分段保留 N0/N1 历史基线。它不把历史未执行项写成零失败，也不把静态核对写成测试通过；独立 Review、N3 整体验收和外部集成验收均待主控独立验收。

## 固定运行时

- Node：当前 `process.execPath`，版本 `v24.15.0`。
- pnpm：默认从当前 `PATH` 查找并为 `10.26.0`；需要时可用 `ENGINEERING_PNPM_EXECUTABLE` 显式注入。
- 查找 tar 时默认使用当前 `PATH`；可用 `ENGINEERING_TAR_EXECUTABLE` 显式注入。
- 安装时设置 `HUSKY=0`。测试默认使用系统临时目录，不依赖某个报告目录预先存在。

工程测试的 scratch 和安装参数均可注入：

| 变量                            | 作用                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `ENGINEERING_TEST_SCRATCH_ROOT` | scratch 的父目录；测试在其下新建唯一子目录。未设置时使用 `os.tmpdir()`。           |
| `ENGINEERING_KEEP_SCRATCH`      | 为 `1`/`true`/`yes` 时保留本次 scratch；默认只删除带本次 owner marker 的 scratch。 |
| `ENGINEERING_PNPM_INSTALL_MODE` | `online`、`prefer-offline` 或 `offline`；默认 `online`。                           |
| `ENGINEERING_PNPM_STORE_DIR`    | 可选的 pnpm store 目录。                                                           |
| `ENGINEERING_PNPM_EXECUTABLE`   | 可选的 pnpm 可执行文件路径或命令名。                                               |
| `ENGINEERING_TAR_EXECUTABLE`    | 可选的 tar 可执行文件路径或命令名。                                                |

测试不会删除已有的 tarball、消费者或其他历史目录。需要保留本次外部消费产物时，设置现有父目录与 `ENGINEERING_KEEP_SCRATCH=1`；新产物位于测试新建的唯一子目录。

## 可运行入口

| 范围         | 入口                                     | 性质                                                                                                           |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 根工程       | `pnpm test:engineering`                  | 真实 Node `node:test`：私有边界、`.env` 忽略、tarball 合同、Workspace 外消费、Tailwind 插件、Turbo CLI hash    |
| 根 routing   | `pnpm test:routing`                      | 真实 Node `node:test` 通过 Next adapter 加载应用 proxy，覆盖 absolute rewrite、redirect、外部 target 与 origin |
| 根 domain    | `pnpm test:domain`                       | Node 24 module mocks + `tsx`；运行 `test/domain/*.test.ts`，领域 PG 与迁移用例需主控按下方变量表注入隔离连接 |
| 包产物       | `pnpm test:packages`                     | `build:packages` 先按 `@sunpcm/niu-*` 构建 dist，再执行 `check:boundaries`，最后跑 `test/packages/*.test.mjs`；真实 PG 变量缺失则对应用例 skip |
| 根总测试     | `pnpm test`                              | 串行运行 `test:engineering`、`test:routing`、`test:domain` 和 `test:packages`                                   |
| 根 lint      | `pnpm exec turbo run lint`               | 只覆盖存在 `lint` script 的包                                                                                  |
| 根 typecheck | `pnpm exec turbo run typecheck`          | 只覆盖存在 `typecheck` script 的包                                                                             |
| 根 build     | `pnpm exec turbo run build`              | 当前覆盖 Web 和所有声明 `build` 的 `@sunpcm/niu-*` 业务包，不只有 Web；配置包与 `@niu/mail` 没有 build script |
| Web          | `pnpm --filter @niu/web lint`            | ESLint `src`                                                                                                   |
| Web          | `pnpm --filter @niu/web typecheck`       | `tsc -p tsconfig.json --noEmit`                                                                                |
| Web          | `pnpm --filter @niu/web build`           | Next.js production build through official Webpack (`next build --webpack`)                                     |
| Web          | `pnpm --filter @niu/web build:turbopack` | Explicit optional Next.js production build through Turbopack (`next build --turbopack`)                        |
| Web          | `pnpm --filter @niu/web db:migrate`      | Canonical migration CLI (`tsx scripts/migrate.ts`); requires a controller-injected `DATABASE_URL`              |
| UI 包产物    | `pnpm --filter @sunpcm/niu-ui test`      | 包内 `node --test ../../test/packages/ui-artifact.test.mjs`：产物、ESM 声明、CSS 与 client 边界               |
| Utils 包产物 | `pnpm --filter @sunpcm/niu-utils test`   | 包内 `node --test ../../test/packages/utils.test.mjs`：ESM 声明、根导入与工具函数                             |

Turbo dry-run 可使用：

```bash
pnpm exec turbo run build --filter=@niu/web --dry=json
```

`test:engineering` 会实际调用该 CLI。源码变异测试串行执行；每个文件都使用同一份完整公共环境，分别记录原始 hash、临时追加字符后的 hash 和精确恢复后的 hash，并断言满足 `原始 hash != 变更后 hash` 且 `原始 hash == 恢复后 hash`。测试还独立断言 `NEXT_PUBLIC_*` 改变 hash、`RESEND_API_KEY` 的值不进入 hash 或 dry-run 输出，以及 `.next/cache/**` 被排出缓存输出。

源码变异测试运行期间不得并行执行 `build`、`typecheck` 或其他读取同一工作树的检查；根入口已固定 `--test-concurrency=1`，四个变异仍按串行循环逐一完成并恢复。

N2 开始设统一停写门，并沿用于 N3 及后续批次：产品 writer、文档 writer 和其他所有并行 writer 先完成写入并停手，主控再代跑源码变异、PG、build、全树 typecheck 和 root engineering。本卡只做单文档静态对照，不执行冻结后的全树检查，也不把局部静态检查写成全树通过。

## Runner 清单

### 根与 Web

- 历史：N0 没有完整领域测试基线；N1 新增 `test:engineering`；N2 接入 `test:routing` 与 `test:domain`。这些“当时没有 runner”的记录只描述对应批次，不代表当前树仍没有 runner。
- 当前：公开仓内根 `package.json` 已接线 `test:engineering`、`test:routing`、`test:domain`、`test:packages` 及串行组合 `pnpm test`，`test/packages/*.test.mjs` 和 `test/domain/*.test.ts` 亦已存在。根入口和 `test/` 内没有自动 Next E2E runner，也没有调用真实 provider 业务 API 的 runner；这不等于主控从未进行手动浏览器验收。主控报告目录（写集外禁读）可能保存手动 HTTP/browser/真实 SDK 签名 fixture；它属于报告证据，不能与公开仓 runner 混写，本流程不推断其是否存在、内容或结果。仓内 `test/domain/provider-signature.test.ts`、`test/domain/provider-contracts.test.ts` 与 `test/packages/commerce-core.test.mjs` 有本地真实 SDK / HMAC 签名 fixture，用于合成 payload 的本地签验与适配；真实 provider API 和真实业务 API 未验，运行结果待主控独立验收。
- 根：`scripts/dependency-boundaries.mjs` 与 `test/packages/dependency-boundaries.test.mjs` 固定检查包图无环、无未声明依赖（第三方与 workspace 均按真正包根归一化，含 scoped/subpath，Node builtin 排除）、workspace 子路径须在 `exports` 声明、运行时 value 依赖不得只藏在 devDependencies、无 `@/` 或相对路径逃逸到 app/别包、core（contracts/utils/auth/commerce）根入口不泄漏 Next/PG/SDK 且 provider/client 子路径合法可选依赖不误判、UI 不泄漏 server-only/Node/数据库、导出目标缺 dist 不默认 green；负向变异按统一停写门留待主控全停后代跑，本卡未执行。
- N2 attempt-04 新增 `test:routing`；它在 Node adapter 层验证 proxy header 语义，但不替代生产 build、HTTP 或浏览器 E2E。
- `apps/web`：存在 `dev`、`build`、`build:turbopack`、`start`、`lint`、`typecheck`、`analyze`、`db:migrate`。默认 `build` 与 `analyze` 都显式使用官方 Webpack；Turbopack 只通过独立脚本显式选择，构建失败时不会静默切换。
- `db:migrate` 是 N2 的 canonical 产品迁移入口：`apps/web/scripts/migrate.ts` 读取显式 `DATABASE_URL`，调用 `src/lib/db/migration-runner.ts` 的 `runMigrations`，不做本地库兜底。CLI 当前不自行加载 `.env`，变量由运行环境或主控受控注入。
- 根 `test:domain` 在 Node 24 下使用 `node --experimental-test-module-mocks --import tsx --test --test-concurrency=1 test/domain/*.test.ts`，并通过 `TSX_TSCONFIG_PATH=test/domain/tsconfig.json` 加载测试路径；它不包含 `routing.test.mjs`。`test:routing` 仍是独立的 `.test.mjs` 入口，不能并入或替代 domain 漂移。
- 当前 PG runner 所需变量只列名称，不保存 URL 或凭据：`test/domain/helpers.ts` 与领域 PG 用例使用 `DATABASE_URL`；`test/domain/migration.test.ts` 另用 `MIGRATION_C01_DATABASE_URL`、`MIGRATION_FAULT_DATABASE_URL`；`test/packages/auth-pg.test.mjs` 用 `AUTH_PG_TEST_URL`、`AUTH_PG_TEST_DB`、`AUTH_CREDITS_PG_TEST_URL`、`AUTH_CREDITS_PG_TEST_DB`；`test/packages/commerce-pg.test.mjs` 及 `test/domain/commerce-instance-isolation.test.ts` 用 `COMMERCE_PG_DATABASE_URL`、`COMMERCE_PG_FOREIGN_DATABASE_URL`、`COMMERCE_PG_EXPECTED_DATABASE`、`COMMERCE_PG_EXPECTED_ROLE`；`test/packages/pg-profiles-pg.test.mjs` 用 `PG_PROFILES_TEST_URL`、`PG_PROFILES_TEST_EXPECTED_DATABASE`、`PG_PROFILES_TEST_EXPECTED_ROLE`。
- 隔离身份与 guard 先于写入：参考库为 `nexty_overnight_20261105_test`，C01 空库为 `nexty_overnight_20261105_migration_c01`，故障/修复空库为 `nexty_overnight_20261105_migration_fault_c01`；N3 专用库名前缀为 `nexty_overnight_20261105_n3_`，测试角色均为 `nexty_overnight_test`。配置检查先核变量齐全、expected database/role 与库名前缀、禁用库名；随后连接身份用 `current_database()` / `current_user()` 核对，配置不全或身份不符时 fail closed。只有 guard 通过后才允许 DDL、migration、DML、seed 或 cleanup；未注入连接变量时 PG 用例只 skip，不记为通过。
- DDL/DML/cleanup 边界：`migration.test.ts` 仅在 guard 后 `drop schema` / `create schema`；`helpers.ts` 仅在事务内校验身份后 `truncate ... restart identity cascade`；`auth-pg.test.mjs` 的 seed/delete 与 `pg-profiles-pg.test.mjs` 的 drop/type cleanup 同样受 guard 约束。上述执行都留待全部 writer 停写后由主控在隔离 PG 代跑，本卡未执行。
- 当前根 `package.json` 已把 `better-auth`、`drizzle-orm`、`next`、`postgres`、React、Stripe 等列为直接 devDependency；lock 的受控 frozen install 是前序记录，本卡未复跑。不得用 `NODE_PATH`、手工 symlink、根临时 tsconfig 或源码 alias 绕过真实依赖和 peer-context 解析。
- `apps/web/src/lib/logger`：所有公开日志方法的 message 与结构化 payload 先经过共享不可变脱敏层，再写入 Pino 与 Sentry；覆盖 Authorization/Cookie、token/API secret、connection string 和嵌套 Error。原始 Pino 实例不对外暴露。自由文本只识别带 Bearer/Basic、凭据键值或 URL userinfo 等明确格式，无法识别没有标签的任意字符串秘密。
- Web 的 `.env.example` 是构建/运行时变量入口；本地实际值应放被忽略的 `.env.local`。历史：N1 构建只使用主控提供的合成 `runtime/build-test.env`；当前值仍由主控受控注入，本卡不读取任何真实 `.env`。
- `test/domain/*` 当前还包含 application、auth、commerce、credits、fulfillment、permissions、provider-contracts 与 provider-signature runner；部分 CMS、反馈权限、统计和动作错误用例需要上述隔离 PG，配置、脱敏、HTML 清理、本地 SDK 签名及无基础设施凭据行为使用普通 Node / module mock 测试。单独运行应用文件不替代全部 writer 停写后的 root 回归。

### 可发布候选包

- 历史（N0/N1）：当时的 `@niu/auth`、`@niu/db`、`@niu/mail`、`@niu/ui`、`@niu/utils` 只有 `lint` / `typecheck`（`@niu/db` 另有 Drizzle CLI script），没有 auth 行为、schema/migration/事务、邮件模板渲染或发送、组件/可访问性/浏览器及 utils 单测 runner；N1 也不对空测试库执行迁移。这是当时的 runner 缺口，不是当前树的事实。
- 当前业务候选包以各自 `package.json` 为准，主要使用 `@sunpcm/niu-*`；根 `build:packages` 的 `--filter="@sunpcm/niu-*"` 只覆盖这一命名集合。`@niu/mail` 与 `@niu/*` 配置包仍用旧命名，`@niu/web` 是 private app；它们不在该 filter 内。
- Auth / Commerce：`@sunpcm/niu-auth` 有 `build`、`lint`、`typecheck`、`prepack`，`test/packages/auth-core.test.mjs`、`auth-next.test.mjs`、`auth-pg.test.mjs` 分别覆盖核心策略、Next 适配与 PG adapter；`@sunpcm/niu-commerce` 有 `build`、`lint`、`typecheck`，`commerce-core.test.mjs`、`commerce-pg.test.mjs` 覆盖核心业务与 PG 事务。`test/domain/` 另有 auth、commerce 和 provider-contracts runner。
- Next / Utils / UI：`@sunpcm/niu-next` 有 `build`、`lint`、`typecheck`、`prepack`，`auth-next.test.mjs` 按其 manifest 检查 server root 与独立 client 子路径；`@sunpcm/niu-utils` 有 `build`、`lint`、`typecheck`、包内 `test`、`prepack`，对应 `utils.test.mjs`；`@sunpcm/niu-ui` 有 `build`、`lint`、`typecheck`、包内 `test`、`prepack`，对应 `ui-artifact.test.mjs`。`test/packages` 内没有 UI 组件运行时/浏览器 runner。
- DB / PG / Contracts：`@sunpcm/niu-db`、`@sunpcm/niu-persistence-pg` 和 `@sunpcm/niu-contracts` 有 `build`、`lint`、`typecheck`；根测试文件 `db-factory.test.mjs`、`drizzle-peer-contract.test.mjs`、`pg-profiles.test.mjs`、`pg-profiles-pg.test.mjs`、`dependency-boundaries.test.mjs` 覆盖连接工厂、peer/产物合同、migration profile 与包边界；`auth-pg.test.mjs` 和 `commerce-pg.test.mjs` 通过 `@sunpcm/niu-persistence-pg` 的 schema 子路径接入 PG。
- `@niu/mail` 当前有 `lint`、`typecheck`，没有 `build` 或包内 `test`；`test/domain/application-mail-contract.test.ts` 是邮件合同 runner，`test/packages` 内没有模板渲染/发送 runner。`@sunpcm/niu-auth`、`@sunpcm/niu-commerce`、`@sunpcm/niu-next`、`@sunpcm/niu-db`、`@sunpcm/niu-persistence-pg`、`@sunpcm/niu-contracts` 没有包内 `test` script，其同名族测试由根 `test:packages` 统一选取。以上只描述 runner 接线，本卡未执行测试、未声明任何结果。

### 配置包

- `@niu/eslint-config`、`@niu/postcss-config`、`@niu/tailwind-config`、`@niu/tsconfig`：当前 `package.json` 没有 scripts，没有独立 runner，不能写成测试通过。
- `@sunpcm/niu-prettier-config`：没有包内 script 或镜像式包内测试；根 `test:engineering` 的入口包含实际 `pnpm pack` 和 Workspace 外消费者检查，涉及 plugin 依赖、文件白名单、registry、peer 范围和格式化行为。本卡未执行，结果待主控独立验收。

### fixtures、templates 与生成器

- 当前树没有 `fixtures/` 或 `templates/` 包；`pnpm-workspace.yaml` 已纳入两类目录，工程测试会拒绝其中任何非 `private: true` 的 `package.json`。
- Plop 生成的包不再写 `echo "no tests"`。生成新包后如果没有测试，应明确记录缺口，不得补一个恒真占位 script。

## 测试边界

- `pnpm test:engineering` 不是业务 E2E，不证明 Auth、积分、支付、Nano、数据库事务或真实 provider 行为。仓内本地真实 SDK 签名 / HMAC fixture 与真实 provider API、真实业务 API 分属不同层级；后者未验。主控报告目录写集外禁读，其中是否有手动 HTTP/browser 验收证据、证据内容与结果均待主控独立验收，不能编造。
- 外部消费者使用本地产 tarball，不是私有 registry 发布；registry 只验证 manifest 路由，没有上传或权限回读。
- Prettier 消费测试在唯一 scratch 中打包并安装；安装模式与可选 store 由上文变量配置，不写死开发者机器路径或历史交付目录。
- 构建检查可使用主控合成的 `runtime/build-test.env`。禁止读取或复制源目录真实 `.env`、凭据和用户数据。
- 历史：N1 的空 PostgreSQL 仅作为隔离身份，不创建 schema、不跑 Drizzle migration、不执行领域 DDL。当前：`test/domain` 与 `test/packages` 已定义按 guard 执行 schema/migration/DDL/DML/cleanup 的 PG runner；连接变量缺失时相应用例 skip，注入后的执行由主控在全部 writer 停写后代跑，本卡未执行，也未宣称 PG 测试绿。

## 本批坑清单

1. Turbo 旧配置没有 `$TURBO_DEFAULT$`，导致 `apps/web/proxy.ts`、`gtag.js` 等包根文件不进入默认 hash。现在保留默认输入，同时显式包含根级文件和共享配置。
2. `$ANALYZE` 是环境变量，不是文件输入；已从 `inputs` 移除并在 `env` 声明。
3. `.next/**` 会把 `.next/cache/**` 带入缓存产物；现用否定模式排除。
4. Turbo strict mode 会过滤未声明的变量。公共输出变量按 `env` 参与 hash，运行时秘密按 `passThroughEnv` 传递但不参与 hash。
5. Prettier 插件仅放在配置包 `dependencies` 仍不够：Prettier 会从消费者根解析字符串插件。配置现在使用 `require.resolve(...)` 指向配置包实际依赖，并已由外部 consumer 证明。
6. 当前 worktree 有 Auth 迁移 WIP。实施和检查必须保留这些改动，不能 reset、stash 或用 HEAD 重建。
7. 历史（N1）：`apps/web/next-env.d.ts` 和 lockfile 属于既有 WIP；当时只合并必要工程配置，不把原 WIP 归为 N1 新成果。

## 当前结论口径

- 历史记录（前序批次）：工程测试、pack allowlist、外部 tarball 消费、Tailwind 插件、Turbo hash 对照曾在本机通过；本卡未复跑，不能据此声明当前 N3 测试绿。
- 历史记录：主控公开受控子集 Auth + application + migration + permissions 的 78/78 状态只到 pre-GPT 冻结，只能作为当时该子集事实，不能写成全 N2 或当前 N3 通过；本卡不读报告确认。
- 历史：N2 当时 Commerce 尚未完成、整体未批准。当前：N3 attempt-01 只完成本单文档的 runner 事实刷新与静态对照，整体测试与 Review 结果待主控独立验收；本卡不提供 N3 批准。
- 不可声明：领域业务测试已通过、真实 PostgreSQL 迁移已执行、私有 registry 发布、Next 冷构建等价性、浏览器/Vite 消费、生产或真实业务 provider API 已验证。
- 任何最终检查失败都应以实际命令和退出码记录；未运行项保持“待代跑”或“未覆盖”。
