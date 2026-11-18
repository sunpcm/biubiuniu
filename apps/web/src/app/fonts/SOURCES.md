# Font Sources

本目录内的三个字体资产来自公开 upstream [`google/fonts`](https://github.com/google/fonts)，固定在
commit `7af0d90b4d532ffa4b041937b560c6df4e7b1e95`。文件按校验值原字节复制，未做子集化、未转码；每个家族
附带原版 `OFL.txt`（SIL Open Font License 1.1），逐字节保持一致。

## 文件映射与校验值

| 本地文件               | upstream 原路径                     | git blob SHA1                              | SHA256                                                             | 字节   |
| ---------------------- | ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | ------ |
| `Inter-Variable.ttf`   | `ofl/inter/Inter[opsz,wght].ttf`    | `047c92f6e2212473dc436020afed689527076d44` | `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031` | 876576 |
| `Inter-OFL.txt`        | `ofl/inter/OFL.txt`                 | `21f6aff961064c2e429f570995e446bcdd555422` | `5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57` | 4377   |
| `Karla-Variable.ttf`   | `ofl/karla/Karla[wght].ttf`         | `939d29ef1f5aaa6c481dc8a1944d89d389c78ae5` | `ed3ca4cd9bdd899c543927c30bf5ff50706b24b3f2b7328e64b25f7d2a9d23dc` | 94016  |
| `Karla-OFL.txt`        | `ofl/karla/OFL.txt`                 | `d76ce0e18e7e5aeb52e5c3b5d2ac88c2b5b9d3db` | `edf2c840acb9570fe02f40721126aa0da4e4011a0030cc6dce30780569f609b6` | 4384   |
| `Pacifico-Regular.ttf` | `ofl/pacifico/Pacifico-Regular.ttf` | `27765d02ac13f241b1e207dbda7b2dd1b68280da` | `5b6c0d5334a7bf77dea52b975c5a0c408878c0f7115ed5b6fb151f634b7bf701` | 329380 |
| `Pacifico-OFL.txt`     | `ofl/pacifico/OFL.txt`              | `33864cc8de4dd3ea8f3daab1154be28577918bae` | `a47e5daeda73568969395c656823102678f2eefb0d7d7ecb47aac4cc17e42204` | 4389   |

## 覆盖与体积

- 覆盖口径：这是**完整上游文件、不人为子集化**，不是「覆盖全 Unicode」。已按主控实测的旧构建缓存
  CMap 字符集并集核验，三个新 TTF 均覆盖且无丢失（Pacifico 763→803、Karla 338→392、Inter 1621→2848）。
- 体积口径（历史缓存，仅作参考）：旧 14 个 woff2 合计 346824 B。
- 体积口径（当前实测，本机真实 Next HTTP 单次测量）：3 个原始 TTF 合计 1299972 B；按
  `Accept-Encoding: gzip` 实际传输 body 合计 672594 B（Inter-Variable 468926 B、Karla-Variable
  58798 B、Pacifico-Regular 144870 B），各响应 `Content-Encoding: gzip`，解压后 SHA256 与本地原文件
  完全一致；另附 3 个 OFL 许可文件 13150 B。该数字不是旧产物同等传输比较，也不是浏览器首屏总量。

## 许可

三个家族均为 SIL Open Font License 1.1，随资产原字节附带的 `*-OFL.txt` 即上游原始许可文件，内容未修改。
