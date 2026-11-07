# 品牌与语言策略（N4 产品前端）

产品品牌配置来自只读来源 C 的 `config/site.ts` 与 `public/` 素材。默认语言为中文，
`localePrefix` 仍是 `as-needed`，`localeDetection` 显式关闭；根路径和 `/zh` 使用中文，
`/en` 与英文深链保持可达。`ja` 只保留已有翻译 JSON 与路由兼容，不出现在语言切换器
或页脚语言组中。

`/ja` 和 `/ja/:path*` 通过 `proxy.ts` 与 `next.config.mjs` 退到对应中文路径，保留
query；`request.ts` 对意外的 ja request locale 也回退中文，避免翻译 JSON 的存在意外
开放日语 UI。N2 已批准的 `skipProxyUrlNormalize: true` 与 absolute rewrite 未回退。

桌面 Header 展示横版 `/logo.png` 的真实 552×143 比例，移动端和站点图标使用
`/logo-mini.png`。微信打赏是独立可选展示，由 `NEXT_PUBLIC_SHOW_WECHAT_DONATE`
显式开启，默认关闭，不产生订单、积分或正式支付状态。

页面 SEO 元数据与 `sitemap.ts` 都只遍历 `SELECTABLE_LOCALES`（`en`/`zh`）。内容页传入
`availableLocales` 时按已有翻译与该常量取交集；显式空数组保持为空，不补出缺失翻译。
中文默认路径保持 `as-needed` 无 `/zh` 前缀，`x-default` 指向同一无前缀路径，canonical 与语言
alternate 原样保留 `canonicalUrl` 中的 query。ja 深链退中文，不把禁用 UI 语言暴露为
可索引语言入口。
