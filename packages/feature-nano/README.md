# @sunpcm/niu-feature-nano

Nano 持久图片任务核心。根入口只依赖 Commerce 公开类型，不读 env、不联网、不连库、不要求
React/Next/未选 SDK。

## 入口

- `.`：状态机、DTO、`admitTask`/`completeTask`/`failTask`/`cancelTask`/`markUnknown`、
  `dispatchDecision`、`nanoSubjectKey`、case 目录契约、错误码。
- `./provider/google`：Google GenAI 1.43.0 provider（`retryOptions.attempts=1`，
  `httpOptions.timeout`，流失败以 sanitized `unknown` 错误抛出）。
- `./react`：`useNanoTask("/api/nano")` 客户端 hook，方法返回已解包 `data`，
  失败抛带 `status/code/message` 的 `NanoHttpError`。

## 设计边界

- 根闭包不 import React/Next/Google/env/DB；provider 与 React 只在显式子入口。
- 包不拥有产品案例文案/素材；`NanoCaseCatalog` 只约束 id 集合。
- 所有数据库事务边界由 PG adapter 拥有；本包 core 只通过 `NanoUnit` 端口操作。
