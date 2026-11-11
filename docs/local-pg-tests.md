# 一键本地合成 PostgreSQL 测试

前置条件：Node `24.15.0`、pnpm `10.26.0`、已执行冻结依赖安装，以及本机 Docker 中已有
`postgres:16-alpine` 镜像。脚本使用 `--pull=never`，不隐式访问 registry；不支持远端 Docker。

在仓库根目录运行：

```bash
pnpm test:pg:local
```

命令构建实际包产物，创建本次独占的临时 PG，初始化九个合成库，串行运行全部
`test/domain/*.test.ts` 和 `test/packages/*.test.mjs`，最后停止并删除本次容器。数据位于 tmpfs，
不挂载已有卷；宿主只发布 `127.0.0.1` 随机端口。正常、失败和 SIGINT/SIGTERM 路径都校验
本次随机 owner 标签后清理。不要用 `git clean` 或删除共享 Docker 卷处理测试失败。

脚本不读 `.env`，不继承调用者的数据库、provider、支付或 SSO 凭据；连接、secret 和测试身份均
临时生成。领域应用库、两份迁移故障库、冻结参考库、Auth-only、Auth+Credits、两个 Commerce
实例库和 profile 库相互分开。参考库仅应用原始 `0000`、`0001`，不含 `0002_nano`。

domain 测试对齐合成 `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_BETTER_AUTH_URL`，保留 Origin 检查；
package 测试单独使用 `NODE_ENV=test`，适配现有显式短 secret 的测试夹具。这不代表验证了真实
AI、支付、SSO 或 registry。脚本检查实际 Node TAP 汇总，缺失汇总、失败、取消、TODO 或任何 skip
均返回非零；不会把缺配置的 PG skip 当成通过。

本入口固定 PG16。阶段 0 实测 PG18 将 RESTRICT 外键的 SQLSTATE 从当前测试要求的 `23503`
改为 `23001`；这里没有放宽断言或修改迁移，不据此承诺 PG18 测试通过。

完整工程测试、routing、Web build 和浏览器验收仍是各自独立的检查，不由此入口替代。
