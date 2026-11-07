# Admin 积分、Auth 兼容与关闭 SSO 迁移记录（N4 admin-auth 卡）

本文件记录 N4 `admin-auth` 卡对 C07/C08/C09/C12/C13 的实施结论，供主控独立 Review 与
后续 UI/Nano owner 复核。它不是验收结论；真实 PG/HTTP/build/全树回归由主控全停后代跑。

## C07 + C12 — Admin 积分单桶操作

来源 C 的 `actions/custom/credits.ts` 直接写旧 usage 表、无管理员鉴权，且
`oneTimeCredits`/`subscriptionCredits` 默认 0 使“设置一个桶”时可能清空另一个桶。
本轮以真实账本 + fresh 服务端权限重建，不复制裸写。

- Commerce 公开单桶操作（`packages/commerce/src/credits.ts`）：
  - `addCreditsIn`：只增目标桶，另一桶不变。
  - `setCreditsIn`：只设置目标桶，另一桶不变；显式 `0` 是有效写入（清空该桶）。
  - `deductCreditsIn`：目标桶扣减并在 `0` 处截断，另一桶不变。
  - 三者都走 `mutate`（`unit.balances.lock` + `unit.ledger.append`），同事务留痕。
  - 留痕 note 结构化：`[admin:add|set|deduct:<bucket>] actor=<userId> <reason>`，操作者
    为服务端解析的稳定 user ID，不使用 caller 声明或邮箱。
  - 校验：`userId`/`actorUserId` 非空、`reason` 非空且 ≤500 字符、`amount` 为
    PG int4 范围内非负安全整数。
- App facade（`apps/web/src/lib/credits/ledger.ts`）与 `apps/web/src/actions/credits/admin.ts`：
  - 新增 `addUserCredits`/`setUserCredits`/`deductUserCredits`，统一走 `requireFreshAdmin`
    （`getFreshSession` 重读封禁状态 + `isAdminUserRole` 覆盖 admin/superadmin）。
  - 普通用户绕过 UI 直接调用会被 `forbidden` 拒绝；角色降权/封禁后真实 action 拒绝，
    不只隐藏菜单。
  - 保留既有 `adjustUserCredits`（delta）与 `grantCreditsToUsers`（批量 email）兼容语义；
    note 由操作者邮箱改为稳定 user ID。批量仍走 `runCommerceTransaction` 同一事务全回滚。
- UI（`dashboard/admin/users/AdjustCreditsDialog.tsx`）：由单一 delta 改为“桶 + 操作 +
  数量”，调用对应单桶 action，显示订阅/购买双桶真实余额。

## C08 — `useAuth` 消费者映射

来源 C 的真实 `useAuth` 消费者与目标 W 去向：

| 来源 C 消费者 | 目标 W 去向 | 归属 |
| --- | --- | --- |
| `dashboard/DashboardSidebar` | `authClient.useSession()`（Better Auth） | 本卡（已完成） |
| `app/auth/cross-login` | 静态关闭页（见 C09） | 本卡（已完成） |
| `hooks/useCaseStats` | W 无此文件，案例选择统计由 Nano/统计 owner 负责 | 其他 owner |
| `components/nano/GeminiImageGenerator` | W `apps/web` 无此文件，由 Nano owner 负责 | 其他 owner |
| `components/home/Hero1` | W `apps/web` 无此文件，由 UI owner 负责 | 其他 owner |
| `lib/supabase/types.ts` | W 无 Supabase SDK/类型，已随迁移移除 | 已移除 |

`superadmin` 未收窄：`isAdminUserRole` 覆盖 `admin` 与 `superadmin`，`AuthGuard role="admin"`
同样覆盖两者；菜单显示与服务端权限一致。

## C09 — 旧 SSO 入口安全关闭

来源 C 的旧跨应用 SSO 把长期 JWT 经任意 `redirect`/`postMessage` 传递，无 opener 时直接拼
URL bearer；verify 只验签名不重核会话/封禁/角色，refresh 再发长期 JWT。绝不照搬开放。

- 路径核验：目标 W 原本不存在 `cross-login` / `api/auth/token` / `verify` / `refresh`。
  本轮在旧路径建立“明确关闭”的静态入口，避免旧 URL 落到歧义错误。
- 关闭入口：
  - 页面 `apps/web/src/app/auth/cross-login/page.tsx`：纯静态关闭说明，不读/回显
    redirect/state/code/token，无客户端脚本、无跳转、无跨窗口消息。
  - `apps/web/src/app/api/auth/token/route.ts`：GET/OPTIONS 返回稳定 410。
  - `apps/web/src/app/api/auth/verify/route.ts`：GET/POST/OPTIONS 返回稳定 410。
  - `apps/web/src/app/api/auth/refresh/route.ts`：POST/OPTIONS 返回稳定 410。
  - 三者不读/回显任何请求参数，不设置跨域 CORS 头，不签发/续期/校验令牌。
- 真实 OAuth/OIDC 接入仍待真实学习客户端联调，本轮不发明一次性 code 流来填绿；正式接入
  需受维护实现、精确回调白名单、PKCE、state、短期一次性码、撤销、fresh 角色与退出联调合同。

## C13 — 旧 Supabase 审计

目标 W 的运行时路径已无 Supabase SDK / RPC / trigger / usage / SSO 消费者：

- `apps/web/src/lib/paypal/client.ts` 的 `createClient` 为 PayPal 客户端，非 Supabase。
- `composition/db.ts` 的 `detectDatabase` 仅按连接串含 `supabase` 做平台检测（用于 pooled
  连接 statement_timeout 调优），非 Supabase SDK 调用。
- 剩余 `supabase` 字样仅出现在品牌/法务文案（`config/site.ts`、`privacy-policy`、
  i18n Landing/common），属品牌/法务 owner，本卡不改。
- `apps/web/supabase/migrations/*.sql`（4 个历史 SQL）只归档不执行，不删除来源/其他 WIP。

结论：身份/积分由当前 Auth（Better Auth）+ Commerce（PG 账本）替代；案例选择统计与 Nano
由另 owner 负责，C13 不在本卡整项提前完成。
