# @sunpcm/niu-feature-nano

Nano 持久图片任务核心。根入口只依赖 Commerce 公开类型，不读 env、不联网、不连库、不要求
React/Next/未选 SDK。

## 入口

- `.`：状态机、DTO、`admitTask`/`completeTask`/`failTask`/`cancelTask`/`markUnknown`、
  `dispatchDecision`、`nanoSubjectKey`、case 目录契约、错误码。
- `./provider/google`：Google GenAI 1.43.0 provider（刻意省略 `retryOptions`，保持 SDK
  默认单次尝试；支持 `httpOptions.timeout`，流失败以 sanitized `unknown` 错误抛出）。
- `./react`：`useNanoTask("/api/nano")` 客户端 hook，方法返回已解包 `data`，
  失败抛带 `status/code/message` 的 `NanoHttpError`。

## 设计边界

- 根闭包不 import React/Next/Google/env/DB；provider 与 React 只在显式子入口。
- 包不拥有产品案例文案/素材；`NanoCaseCatalog` 只约束 id 集合。
- 所有数据库事务边界由 PG adapter 拥有；本包 core 只通过 `NanoUnit` 端口操作。

## 产品装配

参考应用在
[`apps/web/src/composition/nano.ts`](../../apps/web/src/composition/nano.ts)
完成产品装配：同一数据库、Commerce 实例和 PG store 被注入
`createNanoCoordinator`；产品案例、`productId`、模型、积分成本、超时、并发、批大小、
lease 和轮询间隔都由产品应用决定。Nano coordinator 的 `productId` 必须与 Commerce
实例完全一致。

接纳任务时，PG adapter 在同一事务中写入幂等任务、扣减积分、关联 `spendTxId` 并创建待派发
意图。Provider 只在该事务提交后调用，远程请求期间不持有数据库事务。详细装配与生命周期见
[`platform-architecture.md`](../../docs/platform-architecture.md)。

## 收尾与恢复

`DISABLE_NANO` 关闭的是新接纳，不会删除既有任务。若 provider 仍配置，应用可以继续派发已
接纳的 queued 任务；没有 provider 时，进程仍会收尾已经持久化的结果，并把过期且无结果的
in-flight 任务标成 `unknown`。

`unknown` 表示远端可能已接受请求但本地丢失了确定结果。Google image generation 当前没有
可供本包使用的查询/幂等合同，因此 `unknown` 不自动退款，也不会盲目重发。确定失败或由
`queued` 状态成功取消时才触发退款。

状态推进使用 lease owner、随机 token 和状态 compare-and-swap，避免旧实例覆盖已经取消、
成功或由新 owner 接管的任务。该机制只提供状态 fencing；并发上限和单个 sweep 的不重叠保护
仍是进程内的。多进程部署时，每个进程都可以达到自己的并发上限，不能把
`NANO_MAX_CONCURRENT_DISPATCHES` 当作全局配额。

## 相关入口

- [`src/core.ts`](./src/core.ts)：纯状态机、DTO 和 use cases。
- [`src/provider/google.ts`](./src/provider/google.ts)：单次 provider 尝试及保守错误分类。
- [`src/react.ts`](./src/react.ts)：冻结 HTTP 合同的 React 客户端。
- [`../persistence-pg/src/nano/index.ts`](../persistence-pg/src/nano/index.ts)：产品级
  repository、事务 coordinator 和 claim/CAS。
