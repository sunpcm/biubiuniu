# Legacy reference：截至 0001 的冻结迁移副本

本目录保存 N2 参考应用**截至 0001 的逐字节冻结副本**，不包含 `0002_nano.sql`。
它不是当前 `apps/web/src/lib/db/migrations/` 全目录的镜像，也不会随应用新增迁移而同步。

- `migrations/0000_narrow_morbius.sql`：冻结时的 N2 schema DDL，含枚举、表、外键和索引。
- `migrations/0001_nappy_charles_xavier.sql`：为 `session` 追加 `impersonated_by` 列。
- `migrations/meta/_journal.json`：冻结时的 Drizzle journal，只记录 0000、0001；下表哈希对应冻结时的版本，
  不对应后来加入 Nano 后的应用 journal。
- `migrations/meta/0000_snapshot.json` / `0001_snapshot.json`：冻结时的 Drizzle snapshot metadata。

这些资源仅供现有产品升级规划参考，不属于 `src/migrations/` 中的新产品模块化迁移链。
不要补入新迁移、重命名、重算历史资源，或把它们当作新链的 `0000` 重放。T5 只修正本 README，
上述 SQL 与 metadata 的原始字节保持冻结。

冻结来源（只读）：`apps/web/src/lib/db/migrations/`。各冻结文件的 SHA-256：

| File | SHA-256 |
| --- | --- |
| `0000_narrow_morbius.sql` | `779b5f4c4082493fa827ce6037154b562fc3fe7552d39ba6fb5cb9217cee97c5` |
| `0001_nappy_charles_xavier.sql` | `bb49c2ea13ef52eec131bafc92b8140c947222f50c9895586b49f77824857c61` |
| `meta/_journal.json` | `b04b4031e0d0af7e61c57419fbfd8fdd3980683c881ee2acaf1537aa5b231f8c` |
| `meta/0000_snapshot.json` | `746e6cf845ab32f6428a7bd8fe3ea79374f1c65824b192dc4bae11254f8be1a7` |
| `meta/0001_snapshot.json` | `630cee723eaf322b62c812467d8e1bece62c6fc9647fb5ec211c784408023f78` |
