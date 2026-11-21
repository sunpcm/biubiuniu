# Nano 产品前端接线（C03 / C08）

## 来源消费者与身份迁移

准备资料 `N4-source-contract-facts-r1.md` 确认旧 `useAuth()` 的真实消费者为
`hooks/useCaseStats`、`components/nano/GeminiImageGenerator`、
`components/home/Hero1`、`dashboard/DashboardSidebar` 和 `app/auth/cross-login`；
`AuthProvider` 自身的定义/注释也是 grep 命中行，但不是额外消费者。新产品不重建
旧 Supabase AuthProvider，也不为兼容它引入第二个身份源。

本卡实际接回的展示消费者：

- `components/home/Hero1.tsx`：已改为客户端组件，不读旧 `useAuth()`；箭头提示的
  登录判断被移除，按钮状态只来自服务端下发的 Nano public DTO。
- `components/nano/NanoStudio.tsx`：直接使用 `authClient.useSession()` 展示登录态，
  并只用它控制输入/接纳按钮的呈现。真正的身份、归属、成本与授权由服务端从
  fresh session 决定；UI 不传 `userId`、`organizationId`、`cost`、`model` 或时间。
- 旧 `useCaseStats`：由本卡公开 `GET/POST /api/nano/case-stats` 调用替代，热门
  数据只展示服务端 30 天聚合，不在浏览器伪造统计。
- 旧 `GeminiImageGenerator`：由持久任务工作台替代；不再先扣积分再同步生图。
- `DashboardSidebar`：当前 W 已使用 `authClient.useSession()`，保留并行 WIP；
  `app/auth/cross-login` 属 C09 SSO，仍保持关闭/待真实消费者验收，本卡不复活。

`authClient.useSession()` 保留完整会话类型。superadmin 角色不通过
`admin | user` 窄类型投影，也不会被展示桥改写；本卡没有任何授权判断来自展示桥。

## 公共配置与状态

server basic layout 调 `getNanoPublicConfig(isNanoEnabled())`，只把
`enabled,cost,maxPromptChars,maxImageBytes,allowedMimeTypes` 的纯 DTO 传给
client provider。Header/Hero 和 Nano 工作台消费同一 `enabled`：关闭时禁用新接纳、
新案例选择写入和提交按钮，页面仍允许读取既有任务、结果、取消 `queued` 任务、
手动刷新与分页历史。`unknown` 停止自动轮询，只保留手动刷新，不自动重发、不
自动退款、不伪造完成状态。

## 冻结 HTTP 合同调用

UI 通过 `@sunpcm/niu-feature-nano/react` 的 `useNanoTask("/api/nano")` 调用，
所有方法成功值都是解包后的 `data`，失败统一读 `status/code/message`。

- `admit({prompt,image,mimeType,requestKey,caseId?})` 提交必填图片与提示词；
  同事件重放复用原 `requestKey`，新提交生成新 key，由服务端判定幂等。
- `get(taskId)` 用于手动刷新和历史选择；`poll(taskId,{signal})` 在
  `succeeded/failed/canceled/unknown` 停止，unmount 时 AbortController 取消。
- `list({pageSize,nextCursor,signal})` 默认 20 条，cursor 原样回传；翻页只在
  服务端分页上追加，不读取全量历史或列表图片。
- `cancel(taskId)` 只从 `queued` 状态提供；其他状态由服务端 `INVALID_STATE`
  裁决。取消响应后刷新真实任务状态。
- `POST /api/nano/case-stats` 只在新真实选择时带新 `requestKey`，重放相同事件
  复用原 key；`GET` 仅展示服务端 30 天 `topCases`/`stats`。

结果图片按 discriminated union 渲染：`inline` 使用 `data:{mimeType};base64,...`；
`object` 只接受同源 `/api/nano/...` 授权读取 URL，不把 objectKey 当 URL，也不猜
裸字符串含义。

## 错误与恢复

界面覆盖 `AUTH_REQUIRED`、`FORBIDDEN`、`NANO_DISABLED`、`INVALID_INPUT`、
`UNKNOWN_CASE`、`INSUFFICIENT_CREDITS`、`IDEMPOTENCY_CONFLICT`、`NOT_FOUND`、
`INVALID_STATE`、`INTERNAL`、`NETWORK_ERROR`、`ABORTED` 及未知码回退。刷新页面
从 localStorage 中的最近 taskId 调 `get` 恢复；若本地存储不可用，可从服务端
有界历史列表选择恢复。客户端不保存图片 base64、余额或假状态。

## 集成边界

本卡不改 `packages/**`、API 路由、Nano composition/runtime、Auth 安全 factory、
Admin 组件/actions，也不改根或 `apps/web` manifest/lock。后端公开 hook 的
workspace 链接与 `dist` 产物由主控在所有 writer 停写后统一集成；本卡只使用标准
公开子路径 import，不建 alias、symlink 或 NODE_PATH 绕过。
