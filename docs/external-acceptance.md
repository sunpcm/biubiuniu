# Nexty 最小验收准备清单

本文覆盖 N4 本地登录态使用状态与其余四组外部验收的准备，不是四个外部组的验收结论，也
不授权真实调用。
本文记录的已验运行候选快照为
`codex/nexty-platform-overnight-20261105` /
`87eb6f73492bbc0143d2ce66f548a93be539747c`，构建 ID 为
`kqcniByp0gh8FQWhi972g`。这是已经运行的实测候选，不是据未来提交推测的 SHA。执行人开始
相应验收前必须重新核对停写后的源码、产物和数据库合同；任何一项漂移都使本文的对应准备
结果失效，本任务最终状态仍以任务 `FINAL` 报告为准。

## 1. 当前状态口径

| 工作组 | 当前事实 | 状态 |
| --- | --- | --- |
| N1–N3、N5 | 仅保留本地 `APPROVED` | 可引用本地结论，不代表外部通过 |
| N4 登录态浏览器 | 运行候选 `87eb6f7…` 的合成登录态本地浏览器使用已批准；SDK 只连接本任务 loopback 合成 transport，真实 AI/支付未调用 | 本地使用 `APPROVED`；N4 整体外部门槛待验 |
| AI / 支付 | 购买、AI、Nano 默认关闭；支付测试账号、计费预算和真实最短链未提供 | 待外部验收 |
| SSO | 旧入口仅安全关闭为 410；真实 OAuth/OIDC 消费者合同未提供，新实现未裁定 | 待外部验收 |
| 私有 registry | 只有 loopback 工具和本地准备；真实 registry、权限、tag、独立消费者未提供 | 待外部验收 |
| D1b | 已有 D1a source-only 候选映射；真实 DB 核验、最终映射、脱敏存量快照、旧 Schema/包版本和演练授权未提供 | 待外部验收 |

因此当前可报告的是 N4 本地登录态使用已批准，以及四个外部组仅完成准备、仍全部待验；
不能报告五个剩余工作组整体已通过。其中 N4 是本地使用验收组，AI/支付、SSO、私有
registry、D1b 是四个外部验收组。N1–N3/N5 的本地 `APPROVED`、合同测试、mock、合成数据和
本文勾选也不能替代真实 browser/provider/registry/存量数据证据。N4 本地登录态通过不改变
其整体外部门槛，也不表示真实 SSO、真实 AI/支付、真实私有 registry 或 D1b 已完成。

## 2. 通用执行门禁

- [ ] 固定并记录源码 HEAD、tarball/manifest hash、构建环境、Node/pnpm 版本和执行时间。
- [ ] 只使用主控提供的凭据引用或临时 secret 注入；文档、日志、命令参数和产物中不出现真实
      key、cookie、数据库 URL 或用户数据。
- [ ] 每个工作组单独授权；未列出的 provider、host、registry、消费者或数据源不得由同一
      授权推导为允许。
- [ ] 先记录最大调用数、最大金额和停止方式。达到上限、出现未分类金额/状态或证据无法绑定
      当前产物时立即停写并交回主控。
- [ ] 证据至少包含输入摘要、执行的入口、关键状态转换、provider/registry 回读、退出状态和
      清理范围。失败、跳过和未执行必须保留原状态。
- [ ] 生产数据、生产支付、生产模型调用、真实包上传和部署不属于本文准备动作。

## 3. AI 与支付验收

### 3.1 必须先确定的输入

| 输入 | 必须明确的内容 |
| --- | --- |
| AI 渠道 | 只选一个首个验收渠道；若选 Nano，明确 provider=`Google`、模型 ID、项目/配额、最大请求数和最大费用 |
| 支付渠道 | 在 `Stripe`、`Creem`、`PayPal` 中明确首个渠道；本轮不要求三渠道同时启用 |
| 测试模式 | 仅 test/sandbox；明确测试商户/买家、币种、套餐和 provider 侧对象 ID |
| 凭据引用 | 只给 secret 名称与注入方式，不记录值；测试 key 不得复用 live 权限 |
| 费用上限 | 明确最大调用次数、最大扣款、可退款上限和超限停止人 |
| 回调入口 | 公网 HTTPS 测试入口、精确 webhook path、签名 secret 引用和事件选择 |
| 数据边界 | 合成测试用户、允许保存的结果/日志范围及清理窗口 |

当前源码事实：

- `DISABLE_PURCHASE`、`DISABLE_AI`、`DISABLE_NANO` 只有显式为 `false` 才开放对应新操作；
  未设置时保持关闭。见 `apps/web/src/config/features.ts`。
- Nano 的服务端 key 名是 `GOOGLE_GENERATIVE_AI_API_KEY`，模型名由 `NANO_MODEL` 配置；当前
  默认模型为 `gemini-2.5-flash-image-preview`，每接纳任务固定计 1 个产品积分。见
  `apps/web/src/config/nano.ts`。
- AI demo 还登记了 OpenAI、Anthropic、Google、DeepSeek、xAI、OpenRouter、Replicate、
  fal.ai、KIE 等 provider，但不是“最小外部验收”的默认集合，见
  `apps/web/src/config/ai-providers.ts`。
- 当前所有启用展示的套餐仍映射到 Stripe，但 price ID 是 `price_REPLACE_*` 占位值；购买入口
  又被全局开关关闭。不能据此认定 Stripe 真实测试环境已选定或可用。见
  `apps/web/src/config/pricing.ts` 和 `apps/web/src/actions/billing/checkout.ts`。

最小准备建议是只选 Nano/Google 一个 AI 渠道和 Stripe test 一个一次性积分包作为首个支付
闭环。该建议降低跨渠道状态和订阅周期复杂度；在计划明显选定其他渠道前，仍按实际选择执行。

### 3.2 测试 key 名称

文档只列名称，不提供值：

| 渠道 | 测试配置名称 |
| --- | --- |
| Nano / Google | `GOOGLE_GENERATIVE_AI_API_KEY`、`NANO_MODEL`、`DISABLE_NANO=false` |
| Stripe | `STRIPE_SECRET_KEY`（test 模式为 `sk_test_*`）、`STRIPE_WEBHOOK_SECRET`、套餐的 `stripePriceId.test`、`DISABLE_PURCHASE=false` |
| Creem | `CREEM_API_KEY`（test 模式为 `creem_test_*`）、`CREEM_WEBHOOK_SECRET`、套餐的 `creemProductId.test`、`DISABLE_PURCHASE=false`；`CREEM_API_BASE_URL` 仅在受控测试端点确有需要时使用 |
| PayPal | `NEXT_PUBLIC_PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET`、`NEXT_PUBLIC_PAYPAL_ENVIRONMENT=sandbox`、`PAYPAL_WEBHOOK_ID`、`NEXT_PUBLIC_ENABLE_PAYPAL=true`、订阅套餐的 `paypalPlanId.test`、`DISABLE_PURCHASE=false` |

Google Generative AI 不一定提供与传统支付 sandbox 等价的产品级测试 key；应使用独立项目、
限额和单独可撤销的 key，并把“test”限定为本任务授权和环境隔离，不能宣称 Google 侧为
sandbox。

### 3.3 费用范围

执行前必须由授权人填写：

- [ ] AI：最大成功/失败请求数、最大计费 token/图片数、最大外部费用 `USD x.x`，以及结果
      存储上限。
- [ ] 支付：最大测试订单数、单笔最大金额、总扣款上限 `USD x.x`、允许退款方式及退款上限。
- [ ] 对账：允许处理的 pending/unknown 外部对象数量和人工核对截止时间。

没有这些数字时不执行真实 provider 调用。产品积分上限不能代替 provider 美元预算。

### 3.4 AI 最短链

- [ ] 使用合成用户提交 1 个合法 Nano 任务，确认提交后先持久接纳并只扣费一次，再调用
      provider。
- [ ] 成功结果进入 `succeeded`，余额、任务、`spendTxId` 和结果引用一致。
- [ ] 无效参数或明确 4xx 不创建外部成功结果、不重复扣费；确定失败最多退款一次。
- [ ] 模拟超时、5xx、远端受理后响应丢失时任务进入 `unknown`，不自动退款、不盲目重发。
- [ ] 进程重启或重复 sweep 不产生第二次远端请求；迟到结果只能终结一次。
- [ ] queued 取消只退款一次；运行中的任务不得假装已在远端取消。
- [ ] 关闭新接纳后，在途/staged/unknown 收尾仍可运行，不依赖重新打开新任务入口。

### 3.5 支付最短链

选定一个渠道后执行对应链路；未选中的渠道不注册、不要求凭据、不计为支持：

1. 用 test/sandbox 套餐完成一次 checkout。Stripe 使用 `/api/stripe/webhook`，Creem 使用
   `/api/creem/webhook`，PayPal 使用 `/api/paypal/webhook`。
2. 验证错误签名在写订单或积分前被拒绝；随后投递正确签名事件，产生一个订单和一次权益。
3. 原样重放同一事件，订单、积分和流水不变；不同步、乱序或重复事件不得二次发放。
4. 发起测试退款：Stripe 走 `charge.refunded`，Creem 走 `refund.created`，PayPal 走
   capture/sale refund 事件。重放退款事件不得重复扣回积分或重复累计退款金额。
5. 对账 provider 的订单/支付/退款 ID 与本地 `orders`、`subscriptions`、`credit_transactions`
   和双桶余额；pending/unknown 项必须逐项列明处理人。
6. 验证关闭新购买后，既有 webhook、退款和对账仍可收尾。

通过所需的额外事实：

- Stripe 测试 Price 必须替换当前占位 ID；确认 `client_reference_id` 或 metadata 的
  `userId`/`organizationId`/`planId` 与测试用户、团队归属一致。
- Creem 的退款是剩余可退金额的全额退款；部分退款不能写成已实现，本地必须等待
  `refund.created` 后更新。
- PayPal 若选订阅，必须准备 sandbox Billing Plan 并验证激活、续费、失败、终止和退款；
  一次性积分包与订阅是两条链路，不能用一条的通过代替另一条。

## 4. N4 本地登录态 browser

本组属于本地登录态使用验收，不归入四个外部验收组。2026-11-09 已在运行候选
`87eb6f73492bbc0143d2ce66f548a93be539747c` / `kqcniByp0gh8FQWhi972g` 上完成本地
登录态浏览器验收。本轮明确授权使用 loopback
`http://127.0.0.1:49962`；真实外部 OAuth/支付回调仍要求 HTTPS。已验证事实如下：

- 浏览器只使用合成账户和合成 Better Auth 签名 HttpOnly 会话完成登录态验证。这不是密码
  表单登录、真实 OAuth 登录或消费者单点登录验收。
- 普通用户已验证 `settings`、`team`、`billing` 页面、会话刷新及积分记录。
- 管理员订阅桶已验证 `set0` 保留购买时发放的 `13`；随后管理员增加 `3` 积分，使订阅桶由
  `0` 增至 `3`。这 `3` 积分来自管理员增加，不是退款撤回。
- 普通用户、角色降权和封禁用户的 Server Action 重放均被拒绝且零写入；超级管理员操作
  被允许并产生可信 actor 审计。
- Nano UI 已验证上传、成功出图、幂等重放、刷新和历史恢复、确定 400 对原扣费单退款、
  queued UI 取消零 provider 调用且只退款一次、重复取消零新增流水、`unknown` 不退款且不
  重发。
- 中文 `390px` 移动端布局和外用户 `404` 已验证。SDK 只连接本任务 loopback 合成
  transport，真实 AI/支付从未调用。

本轮尚未验证密码表单登录、真实 OAuth 登录和 logout 按钮闭环；只做了 cookie 清理和会话
撤销。普通证据不得保留 cookie、token 或其他可复用会话材料；正常协议传输的 HttpOnly
`Set-Cookie` 响应头不属于禁止项，但记录时应去除可复用值并保留必要属性。截图、HTTP 状态和
错误码仍须脱敏。验收结束时会话已撤销，browser、HTTP、fixture 和任务容器均已停止；卷和
合成数据保留，供后续独立复核。

## 5. SSO 最短外部链

旧 `/auth/cross-login`、`/api/auth/token`、`/api/auth/verify`、`/api/auth/refresh` 当前只作
安全关闭：旧页面不跳转、不读取请求参数，三个 API 稳定返回 410。它们既不是 OAuth/OIDC
能力，也不能作为新 SSO 的 callback。具体待实施合同见
[`modules/admin-credits-auth-sso.md`](modules/admin-credits-auth-sso.md)。

执行前必须有真实消费者合同，至少明确：

- [ ] issuer/discovery、client ID 的 secret 名称、scopes、claims 与账号关联规则。
- [ ] 精确 callback URI、允许的 post-login URI、post-logout URI；不得用通配符或动态 host。
- [ ] authorization code + PKCE `S256`；PKCE 同时适用于 public client。本产品推荐 BFF/
      机密 Web 客户端在服务端临时保存 verifier，其他客户端类型按正式消费者合同处理，见
      [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)。
- [ ] state 与 nonce 的生成、绑定、TTL、一次性消费和重放拒绝方式。
- [ ] 撤销入口、backchannel/frontchannel logout 支持、token 过期和密钥轮换处理。
- [ ] 角色/组织成员关系刷新来源。不得从旧 ID token 长期信任角色，敏感入口继续读取 fresh
      session 与 live membership。

验收必须覆盖恶意 redirect、PKCE/state/nonce 不匹配、code 重放、过期 token、用户封禁、
角色降权、组织成员移除、主动 logout 和消费者 logout 回调。access/refresh token 不得进入
浏览器页面、RSC payload、URL、日志、postMessage 或不可信消费者；受控服务端 OAuth token
端点按 [RFC 6749 §5.1](https://www.rfc-editor.org/rfc/rfc6749#section-5.1) 在响应中返回
token 属于正常协议传输。没有真实消费者合同和联调授权时保持“未实施、未验收”。

## 6. 真实私有 registry 最短外部链

当前 `scripts/release/` 只接受 loopback HTTP registry，默认目标是
`https://npm.pkg.github.com` 的候选约定，但没有真实上传或读取权限证据。该本地工具不能
直接当作真实 registry 发布流水线。详细门槛见
[`local-release.md`](local-release.md)。

当前十项包名与版本：

| 包名 | 当前版本 |
| --- | --- |
| `@sunpcm/niu-auth` | `0.1.0-next.0` |
| `@sunpcm/niu-commerce` | `0.1.0-next.0` |
| `@sunpcm/niu-contracts` | `0.1.0-next.0` |
| `@sunpcm/niu-db` | `0.1.0-next.0` |
| `@sunpcm/niu-feature-nano` | `0.1.0-next.0` |
| `@sunpcm/niu-next` | `0.1.0-next.0` |
| `@sunpcm/niu-persistence-pg` | `0.1.0-next.0` |
| `@sunpcm/niu-prettier-config` | `0.1.0-next.0` |
| `@sunpcm/niu-ui` | `0.1.0-next.0` |
| `@sunpcm/niu-utils` | `0.1.0-next.0` |

执行前必须补充：

- [ ] 真实 registry URL、组织/scope 所有者、包可见性、上传/读取/dist-tag 权限矩阵和凭据引用。
- [ ] 本次发布的明确版本和 tag；`latest` 不得先行，稳定 tag 只在验证后提升。
- [ ] 已审核 tarball、manifest、`sourceCommit`、每包 integrity 与数据库合同。
- [ ] 独立消费者仓库/目录、其负责人和升级/回退提交位置。
- [ ] 授权人在上传前签署“允许向目标 registry 发布这些精确版本”。

通过顺序：

1. 先完成本地门槛：已审 tarball、manifest、六项 Gate 和 loopback profile 消费必须绑定同一
   payload。该本地 Gate 是真实预览发布输入，不是真实 registry 验收。
2. 取得精确版本上传授权后，按依赖拓扑向真实冷目标发布预览版本；部分成功只补发缺失版本，
   不覆盖既有产物，不推进 `latest`/稳定 tag。
3. 从真实 registry 逐包回读名称、版本、tag、integrity 和依赖闭包。
4. 在无平台源码挂载、无 workspace/link/symlink/alias 的干净消费者中，从真实 registry 按
   精确版本安装 `minimal`、`auth_credits`、`nano_payments` 三个 profile。
5. 在独立消费者运行 Node/Vite/Next 入口和已选外部渠道的 test 链路。
6. 以上都通过后才执行稳定提升；再验证消费者从上一个 release manifest/lockfile 升级和
   回退。数据库不兼容时不得仅回退应用包。

没有明确上传授权时只能准备 tarball 和本地证据，真实 registry 状态保持未通过。

## 7. D1b 存量迁移准备

D1b 是最终版本的数据演练，不是“合成库通过”或“迁移 runner 可运行”。当前源码合同为：

- 已有公开 D1a source-only 素材，可只读定向复用候选字段映射：
  `/Users/sunpcm/code/nexty_monorepo/review/reports/OVERNIGHT-20261105/delivery/D1a/source-only/report.md`
  （SHA-256 `d05a0754dcfbf8f10a3ffb84889bf467a46cc3e4dc3bc1237c0cad68da5b10c8`）和
  `inventory.json`
  （SHA-256 `46d06ad78fb364434f3eb8c4e21cddafd1c33c0f305c62b7daa68ced3ea3c998`）。
- 该 D1a 是 TypeScript AST source-only 盘点，不包含真实 DB 数据、转换结果或最终迁移批准。
  来源快照 hash 为 N
  `db40ef3d7f0562db83a1221712a7c088d80a4d16b6a492fabb9ae41586a75c76`、C
  `35f6abdd27f2031b44f0d5688531225f7dcbadee5b2ee4f47186164eeda4de32`、T
  `5c5bf89655739af39c4c6e066c18693aacb9a166f96f95bb139450d91d73f1a4`。
- 可定向复用的候选映射包括：旧 plan UUID/权益到不可变 `planId`；旧 `usage` 两余额到新双桶；
  旧 `credit_logs` 到 `credit_transactions`；numeric 金额到整数最小单位；退款到原订单累计
  退款加 revoke 流水；旧订阅到 `provider + providerSubscriptionId` 及分月调度。

- 十个发布包当前均为 `0.1.0-next.0`，D1b 必须重新绑定停写后的最终版本。
- `DATABASE_CONTRACT_VERSION=1`；`auth`、`payments`、`credits`、`nano` 当前均为
  `version=1`、`contractVersion=1`。见
  `packages/persistence-pg/src/migrations/profiles.ts` 与各模块。
- profile 为 `minimal`、`auth`、`auth_credits`、`nano_payments`；目标产品若启用 Nano 和
  支付，最可能使用 `nano_payments`，但必须按实际功能裁剪确认。
- runner 在一个事务中校验 journal、module version/contract/checksum 后执行 DDL；兼容检查
  只读，不会自动迁移。已有对象的 checksum 或合同漂移必须失败。

### 7.1 必须补充的输入

- [ ] 将上述 D1a source-only 候选映射逐项复核到最终 W Schema/profile，形成经业务和 D1b
      批准的字段、枚举、单位、权益及 provider ID 映射成品；source-only 清单不能直接当最终
      映射。
- [ ] 进行真实 DB 核验：实际旧库 Schema、行数、币种、余额、订单、退款、订阅、provider 事件
      水位和唯一约束；没有脱敏导出或授权数据时保持未知。
- [ ] 旧系统精确仓库、commit、schema package/version、migration journal、SQL 文件名、
      checksum 和部署版本。
- [ ] 脱敏 snapshot 的生成方法、覆盖范围、hash、行数、币种、时间范围、恢复校验和 PII
      清理证明。
- [ ] 订单、退款、订阅、余额、积分流水、用户/组织、provider ID、pending/unknown 的基线
      统计与异常清单。
- [ ] 最终包版本、目标 Schema/profile、module version/checksum、数据库合同版本和此前
      兼容范围。
- [ ] 写入冻结窗口、webhook inbox、旧 writer fencing、cutover 负责人及失败回退授权。
- [ ] 明确的回退条件：恢复到哪个旧包/manifest、哪个数据库快照、允许的最长中断、谁能宣布
      回退。

### 7.2 演练顺序

1. 固定 D1a 映射、旧快照、新包 manifest、profile 和 checksum，并把它们写入同一演练回执。
2. 在独立 PG 实例恢复脱敏 snapshot，源库保持只读；记录数据库名、角色、行数与 snapshot
   hash。
3. 在另一独立目标库按已审 tarball/manifest 的精确版本和 profile 建库，先跑只读兼容检查。
4. 按 D1a 映射转换数据；为切换时余额/历史缺口写入带 `migrationRunId` 的明确期初账目，
   不伪造旧流水，不从当前套餐倒推历史权益。
5. 从同一 snapshot 重跑并证明结果确定；再演练冻结窗口内增量和旧 webhook 乱序/重复回放。
6. 逐对象、逐用户、逐组织、逐币种对账；所有未解释差异列为阻断项，不以“样本通过”替代。
7. 演练 cutover、写保护、inbox 接收、旧 writer fencing、接管和新写入。
8. 演练恢复到旧包和旧数据库 snapshot，或证明必须 cutback/forward-fix 且已获授权。

### 7.3 通过条件

- [ ] 所有用户/组织双桶余额与映射后的来源、期初账目和流水可解释地相等。
- [ ] 每个币种的订单、累计退款、积分发放/回收与 provider 历史逐项对账。
- [ ] 存量计划、订阅周期、剩余发放次数和下一发放时间正确；不重发首月。
- [ ] provider order/payment/subscription/refund ID 保留映射和唯一性，旧 webhook 重放不二次
      履约。
- [ ] 重跑不产生重复订单、退款、积分或期初账目。
- [ ] pending/unknown/孤立退款和无法映射项目为零，或逐项获批并保留可恢复清单。
- [ ] 回退回执包含旧 manifest、旧 snapshot、恢复耗时和兼容检查结果。

合成数据、mock provider、本地 canonical migration 和旧字节本地 API 结果都不能宣称存量
业务已迁移。D1b 完成也不等于生产 cutover 完成；生产切换必须另立授权和 Runbook。

## 8. 完成判定

一个工作组只有在证据绑定当前源码/产物/合同，且执行人、授权人、测试对象、费用范围、退出
状态和未决异常全部可追溯时才可标为通过。本文、checklist、计划、mock、本地 registry、
合同测试和合成 PG 均不作为外部通过依据。
