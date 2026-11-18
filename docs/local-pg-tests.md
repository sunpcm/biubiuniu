# 一键本地合成 PostgreSQL 测试

前置条件：Node `24.15.0`、pnpm `10.26.0`、已执行冻结依赖安装，以及本机 Docker 中已有
`postgres:16-alpine` 镜像。脚本使用 `--pull=never`，不隐式访问 registry；不支持远端 Docker。

在仓库根目录运行：

```bash
pnpm test:pg:local
```

命令构建实际包产物，创建本次独占的临时 PG，初始化十二个独立合成库，串行运行全部
`test/domain/*.test.ts` 和 `test/packages/*.test.mjs`，最后停止并删除本次容器。数据位于 tmpfs，
不挂载已有卷；宿主只发布 `127.0.0.1` 随机端口。正常、失败和 SIGINT/SIGTERM 路径都校验
本次随机 owner 标签后清理。不要用 `git clean` 或删除共享 Docker 卷处理测试失败。

脚本不读 `.env`，不继承调用者的数据库、provider、支付或 SSO 凭据；连接、secret 和测试身份均
临时生成。领域应用库、两份迁移故障库、冻结参考库、Auth-only、Auth+Credits、两个 Commerce
实例库、profile 库、product 库和两个 takeover 库相互分开。参考库仅应用原始 `0000`、`0001`，
不含 `0002_nano`；product 库用于从固定旧链基准读取并核验 `nano_payments_cms` 新装配的空库产物。
takeover 目标库由旧 app runner 安装完整 `_n2` 链；takeover 参考库由包内 `PRODUCT_MIGRATION_PLAN`
真实建库，并用于生成 PG16 结构合同和旧链 / 包链结构指纹核对。

domain 测试对齐合成 `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_BETTER_AUTH_URL`，保留 Origin 检查；
package 测试单独使用 `NODE_ENV=test`，适配现有显式短 secret 的测试夹具。这不代表验证了真实
AI、支付、SSO 或 registry。脚本检查实际 Node TAP 汇总，缺失汇总、失败、取消、TODO 或任何 skip
均返回非零；不会把缺配置的 PG skip 当成通过。

本入口固定 PG16。阶段 0 实测 PG18 将 RESTRICT 外键的 SQLSTATE 从当前测试要求的 `23503`
改为 `23001`；这里没有放宽断言或修改迁移，不据此承诺 PG18 测试通过。

P1-2 验收证据分列如下：

- **全量入口**：本入口实测 domain 273 项、packages 211 项，全部通过且零 skip。
- **独立合成故障注入探针**：用合成事件触发器令第二个 `_niu` 元数据 DDL 报错，确认接管事务整体回滚、
  两代账本均不留下半份状态。

以上结果只代表 PG16 合成测试和本阶段结构合同，不代表其他 PostgreSQL 版本、真实数据或生产迁移验收。

完整工程测试、routing、Web build 和浏览器验收仍是各自独立的检查，不由此入口替代。
