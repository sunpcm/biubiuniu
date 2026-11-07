# QA Testing Checklist - Phase 2 & Phase 3

Phase 2 核心服务抽取 + Phase 3 Auth 模块抽离后的手动测试清单。请逐项验证以下核心链路正常工作。

## 前置条件

- [ ] 确保 `.env` 文件包含 `DATABASE_URL`
- [ ] 确保 `.env` 文件包含 `RESEND_API_KEY` 和 `ADMIN_EMAIL`
- [ ] 确保 `.env` 文件包含 `BETTER_AUTH_SECRET` 和 `NEXT_PUBLIC_BETTER_AUTH_URL`
- [ ] 确保 `.env` 文件包含 OAuth 配置（`NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`）
- [ ] 如需速率限制测试，确保 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN` 已配置
- [ ] 如需验证码测试，确保 `TURNSTILE_SECRET_KEY` 已配置
- [ ] 确保 Stripe 相关环境变量已配置
- [ ] 执行 `pnpm install` 并确认无错误
- [ ] 执行 `pnpm turbo typecheck` 确认全部通过（6包：db, utils, mail, auth, ui, web）
- [ ] 执行 `pnpm turbo build` 确认构建通过

---

## 1. 数据库连接 (@niu/db)

### 1.1 基础连接

- [ ] 启动 `pnpm dev:web`，应用正常启动无 DB 连接错误
- [ ] 访问首页，确认页面正常渲染（验证 SSR 无报错）

### 1.2 Schema & 查询

- [ ] 访问定价页面 `/pricing`，确认定价数据从数据库正常加载
- [ ] 登录后访问 `/dashboard/overview`，确认统计数据正常显示
- [ ] 访问 `/dashboard/my-orders`，确认订单列表正常
- [ ] 访问 `/dashboard/subscription`，确认订阅状态正常

### 1.3 Drizzle 工具命令 (包级别)

- [ ] `cd packages/db && pnpm db:studio` 能正常启动 Drizzle Studio
- [ ] `cd packages/db && pnpm db:generate` 能正常生成迁移文件（若 schema 有变更）

### 1.4 数据库配置预览

- [ ] 访问 `/dashboard/overview`，DatabaseConfigPreview 组件正常显示平台/数据库检测结果

---

## 2. 工具函数 (@niu/utils)

### 2.1 cn() 函数

- [ ] 各页面的 Tailwind 类名合并正常（检查按钮、卡片等 UI 组件样式）

### 2.2 formatCurrency

- [ ] 定价管理页 `/dashboard/prices` 中金额格式化正确显示（如 `$9.99`）
- [ ] 确认无 `defaultCurrency` 参数时默认使用 `"usd"`

### 2.3 formatBytes

- [ ] R2 资源管理页 `/dashboard/r2-resources` 中文件大小格式化正确（如 `1.5 MB`）
- [ ] Tiptap 编辑器中上传文件时大小显示正确

### 2.4 formatValue

- [ ] Dashboard Overview 中的统计卡片（收入/计数）格式化正确显示

### 2.5 kebabToPascalCase

- [ ] DynamicIcon 组件正常渲染图标（确认 kebab-case 到 PascalCase 转换正常）

---

## 3. 邮件模板 (@niu/mail)

### 3.1 用户欢迎邮件

- [ ] 新用户注册后收到欢迎邮件
- [ ] 邮件中品牌名称（BiuBiuNiu）正确
- [ ] 邮件中 Logo 链接、站点 URL 正确
- [ ] 社交链接正确显示

### 3.2 Magic Link 邮件

- [ ] 使用 Magic Link 登录时收到邮件
- [ ] 邮件中品牌名称正确
- [ ] 点击 Sign In 按钮链接正确

### 3.3 OTP 验证码邮件

- [ ] 使用 OTP 登录/验证时收到验证码邮件
- [ ] 验证码正确显示
- [ ] 邮件中品牌名称正确

### 3.4 Newsletter 欢迎邮件

- [ ] 订阅 Newsletter 后收到欢迎邮件
- [ ] 退订链接正常工作

### 3.5 支付失败邮件

- [ ] （需 Stripe 测试模式）模拟支付失败，确认用户收到通知邮件
- [ ] 邮件中金额、币种、Plan 名称正确

### 3.6 积分升级失败邮件

- [ ] （需 Stripe webhook 测试）模拟积分升级失败，Admin 收到告警邮件
- [ ] 邮件中 userId、orderId、errorMessage 正确

### 3.7 欺诈告警邮件

- [ ] （需 Stripe Radar 测试）欺诈告警时 Admin 收到邮件
- [ ] 邮件中 Stripe Dashboard 链接正确

### 3.8 欺诈退款通知邮件

- [ ] （需 Stripe 测试）欺诈退款时用户收到通知邮件
- [ ] 退款金额、原始金额正确

---

## 4. CMS 系统

- [ ] 博客列表页正常加载
- [ ] 创建/编辑博客文章正常
- [ ] 标签管理（创建、选择、删除）正常
- [ ] Glossary 功能正常

---

## 5. 认证系统 (@niu/auth)

> Phase 3 重点测试区域 — Auth 模块已从 apps/web 抽离到 @niu/auth 包。
> 核心逻辑通过 `createAuth()` 工厂函数注入，需验证所有认证链路功能不变。

### 5.1 登录方式

- [ ] OTP 验证码登录：输入邮箱 → 收到 6 位验证码 → 输入验证码 → 登录成功
- [ ] Magic Link 登录：输入邮箱 → 收到登录链接邮件 → 点击链接 → 登录成功
- [ ] GitHub OAuth 登录：点击 GitHub 按钮 → 跳转授权 → 回调成功登录
- [ ] Google OAuth 登录：点击 Google 按钮 → 跳转授权 → 回调成功登录
- [ ] Google One Tap 登录：页面加载后 One Tap 弹窗出现（需 Google 已登录浏览器）
- [ ] 匿名登录：匿名用户可访问受限功能（如启用）

### 5.2 Session 管理

- [ ] 登录后 `getSession()` 返回正确的用户信息
- [ ] 刷新页面后 session 保持（cookie cache 工作正常）
- [ ] 登出后 session 清除，访问受保护页面跳转到 `/login`
- [ ] Session 过期后自动要求重新登录（30天过期）

### 5.3 账户链接

- [ ] 使用 GitHub 登录后，再用相同邮箱的 Google 登录 → 自动关联账户
- [ ] 使用 Google 登录后，再用相同邮箱的 GitHub 登录 → 自动关联账户

### 5.4 权限控制

- [ ] `isAdmin()` 对管理员用户返回 `true`
- [ ] `isAdmin()` 对普通用户返回 `false`（或 redirect 到 /login）
- [ ] `AuthGuard` 组件对未登录用户正确重定向到 `/login`
- [ ] Admin Dashboard 页面仅管理员可访问

### 5.5 速率限制（需 Upstash Redis）

- [ ] Magic Link 请求：60秒内超过 3 次后被限流
- [ ] OTP 发送请求：60秒内超过 3 次后被限流
- [ ] OTP 验证请求：60秒内超过 5 次后被限流
- [ ] getSession 请求不受速率限制

### 5.6 Captcha 验证（需 Turnstile）

- [ ] 启用 Turnstile 后，登录表单显示验证组件
- [ ] 未通过 Captcha 验证时登录请求被拒绝

### 5.7 用户注册后 Hook

- [ ] 新用户注册后收到欢迎邮件（验证 createAuth 的 sendEmail 注入正常）
- [ ] 新用户注册后用户来源追踪数据正确写入数据库（验证 tracking hooks 注入正常）
- [ ] 欢迎邮件中品牌名称、Logo、退订链接正确

### 5.8 跨域 SSO（Cross-Domain Auth）

- [ ] 访问 `/auth/cross-login` 页面正常加载
- [ ] `/api/auth/token` 端点正确生成 JWT Token
- [ ] `/api/auth/verify` 端点正确验证 JWT Token
- [ ] `/api/auth/refresh` 端点正确刷新 JWT Token
- [ ] postMessage 跨域通信正常工作

### 5.9 Better Auth API 路由

- [ ] `/api/auth/[...all]` catch-all 路由正常响应
- [ ] Better Auth 内置 API（如 `/api/auth/get-session`）正常工作

### 5.10 用户管理

- [ ] 用户可在 `/dashboard/settings` 更新个人资料
- [ ] 用户可删除自己的账户
- [ ] 删除账户后无法登录

---

## 6. 支付系统

- [ ] Stripe Checkout 流程正常（测试模式）
- [ ] Creem 支付流程正常（如启用）
- [ ] Stripe Customer Portal 正常打开
- [ ] Webhook 处理正常（checkout.session.completed, invoice.paid 等）

---

## 7. 构建验证

- [ ] `pnpm turbo typecheck` — 0 错误
- [ ] `pnpm turbo build` — 构建成功
- [ ] `pnpm turbo lint` — 0 错误（warnings 可接受）
- [ ] 生产模式启动 `pnpm start` 正常

---

## 测试优先级

**P0 (必须通过)**：1.1, 1.2, 2.1, 3.1, 3.2, 3.3, 5.1, 5.2, 5.4, 5.7, 5.9, 7.x
**P1 (重要)**：1.3, 2.2-2.5, 3.4, 4.x, 5.3, 5.10, 6.x
**P2 (有条件测试)**：3.5-3.8, 1.4, 5.5, 5.6, 5.8
