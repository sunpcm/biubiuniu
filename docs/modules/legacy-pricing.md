# 历史 test 套餐静态映射（N4 产品前端）

`config/legacy-pricing.ts` 是 7 条来源 seed 启用套餐的只读展示映射，全部
`environment=test`：Stripe 4 条、Creem 2 条、provider `none` 1 条。每条保留原
plan ID、原 provider 外部 ID/产品 ID、优惠 ID、展示价格、三语文案、权益和排序。

`benefits` 只使用来源中实际出现的 `monthlyCredits`、`oneTimeCredits`、
`totalMonths` 三个键；没有权益的套餐保留空对象，不把缺失静默改写成 0。
Stripe coupon ID 保持 coupon 语义，Creem discount code 保持 discount code 语义；
`provider: "none"` 不强行塞入支付 provider 枚举。

该配置仅用于历史展示与后续 D1b 核对。本轮不运行旧 seed、不调用真实 provider、
不修改 N3 有效 `config/pricing.ts`、不开放新购买。test 外部 ID 不能当作 live
支付价格；新 Commerce 的履约、双桶余额和订阅发放规则仍以 N3 已批准配置为准。

静态盘点来源 SHA256：
`937fbb53a8ae260574ac75f10796a23744330fe56a585c45185e0b0169e430e6`。
