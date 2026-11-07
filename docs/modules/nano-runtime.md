# Nano 持久任务运行时

Nano（`@sunpcm/niu-feature-nano`）是图片生成持久任务：接纳、扣费、派发、恢复扫描、
终态/退款全部以 PostgreSQL 为唯一持久事实，跨真实进程重启不依赖内存 Map 或 Redis TTL。

## 包与入口

- `packages/feature-nano`：core + 错误码 + provider 端口 + case allowlist；子入口
  `./provider/google`（Google GenAI 1.43.0）与 `./react`（纯客户端 hook）。
  根入口不 import React/Next/Google/env/DB。
- `packages/persistence-pg`：`/schema/nano`、`/nano`（`createNanoCoordinator`）、
  migration `nano` 模块与 `nano_payments` profile。
- `apps/web/src/lib/nano/**`：身份解析、校验、DTO、错误分类、dispatch sweeper。
- `apps/web/src/lib/nano/bootstrap.ts`：真实 Next Node server 启动时的进程内
  sweeper 装配入口，负责相位门禁与单例启动。

## 进程内启动（bootstrap）

`apps/web/src/instrumentation.ts` 的 `register()` 只在 `NEXT_RUNTIME === "nodejs"` 时调用
`startNanoRuntimeOnce()`。Next 16 只在 `next build` 时把 `NEXT_PHASE` 写为
`phase-production-build`；`next start` / `next dev` 只把相位作为 `loadConfig` 参数传递、
`NEXT_PHASE` 保持未设置，但仍会调用 `register()`。因此 bootstrap 以「相位未设置 = 真实
server」为准，只在 `phase-production-build`（构建）与 `phase-export`（静态导出）时跳过，
edge 运行时则被 `register()` 的 `nodejs` 分支排除。这样真实重启后 queued/staged/stale
任务能自动收尾，而构建/静态/edge 永不启动定时器或业务扫描。

`startNanoRuntimeOnce()` 按进程只装配一次：首次调用者持有装配，后续重复或并发调用等待
同一 Promise，不会创建第二套 timer 或 SIGTERM/SIGINT 监听器。控制器无论 Nano 是否关闭或
provider key 是否缺失，都会运行 staged/stale 恢复扫描，只对新接纳做 provider 门禁。

## 状态机与恢复

```
queued -> leased -> dispatching -> running -> succeeded
                                \-> running -> failed
dispatching/running -(远端受理后关联/响应丢失)-> unknown
queued -(确认未 dispatch)-> canceled
```

终态：`succeeded`/`failed`/`canceled`；`unknown` 是需对账的持久态，不因 lease 过期盲重发。
`dispatchDecision` + `listDispatchable`/`listStaleInFlight` 提供可扫描的 dispatch intent 与
stale in-flight 恢复；stale `dispatching`/`running` 进入 `unknown`，不自动重发/退款。

## 事务边界

- 接纳 = 幂等插入 + `spendCredits` + `spendTxId` 关联 + active-job 在同一
  `coordinatePgCommerce` owned 事务。
- 成功终结 / 失败退款 / queued 取消退款与终态更新、active-job 清理在同一 owned 事务；
  失败退款只发生一次（原 usage `spendTxId` 回双桶）。
- provider 调用严格发生在 lease/dispatch 短写之后、终态短写之前，不跨远程调用持事务。

## 超时与并发（作用域）

- `NANO_PROVIDER_TIMEOUT_MS`：单次 provider 请求超时，默认 `120000`，合法范围
  `1000..600000`；通过 SDK `httpOptions.timeout` 生效。
- `NANO_MAX_CONCURRENT_DISPATCHES`：进程内 dispatch sweeper 并发上限，默认 `4`，
  合法范围 `1..64`。
- 上述并发是**单实例（单进程）**上限，不是跨进程全局限制。若未来需要跨进程全局上限，
  必须在 PG 侧用协调 lease 实现并验证；当前不冒称全局限制。
- 这些配置只存在于服务端配置，不进普通产品 UI，不提供 test-mode 权限绕过。

## 授权与删除并发

- 写入身份由服务端 fresh session + live membership 解析；客户端不能指定
  userId/org/cost/model/provider。任务归属按 `productId + user/org` 判定，jobId/objectKey
  不是授权凭据。
- `nano_active_jobs` 对 balance owner 使用 `ON DELETE RESTRICT`，防止在途任务因删号/删组织
  被孤立；终态历史 subject 可 `SET NULL`，不永久阻止账号/组织删除。

## 迁移

- 公共 profile：`nano_payments`（auth + payments + credits + nano）。
- 参考 app canonical chain：仅追加 `0002_nano.sql` 与对应 snapshot/journal 增量；
  原 2 个 SQL/meta 及历史 snapshot/journal 项不修改。
