# QA Testing Checklist - Phase 2

Phase 2 核心服务抽取后的手动测试清单。请逐项验证以下核心链路正常工作。

## 前置条件

- [ ] 确保 `.env` 文件包含 `DATABASE_URL`
- [ ] 确保 `.env` 文件包含 `RESEND_API_KEY` 和 `ADMIN_EMAIL`
- [ ] 确保 Stripe 相关环境变量已配置
- [ ] 执行 `pnpm install` 并确认无错误
- [ ] 执行 `pnpm turbo typecheck` 确认全部通过
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

## 5. 认证系统

- [ ] Email + Password 登录正常
- [ ] GitHub OAuth 登录正常
- [ ] Google OAuth 登录正常
- [ ] Magic Link 登录正常
- [ ] OTP 验证码登录正常
- [ ] 登出正常

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

**P0 (必须通过)**：1.1, 1.2, 2.1, 3.1, 3.2, 3.3, 5.x, 7.x
**P1 (重要)**：1.3, 2.2-2.5, 3.4, 4.x, 6.x
**P2 (有条件测试)**：3.5-3.8, 1.4
