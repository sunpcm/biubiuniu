# Legacy reference migrations

This directory contains a **byte-for-byte frozen copy** of the N2 reference
application migration resources:

- `migrations/0000_narrow_morbius.sql` — full N2 schema DDL (enums, tables,
  foreign keys, and indexes).
- `migrations/0001_nappy_charles_xavier.sql` — `ALTER TABLE "session" ADD COLUMN
  "impersonated_by" uuid;`.
- `migrations/meta/_journal.json` — drizzle journal (version, dialect, entry
  tags).
- `migrations/meta/0000_snapshot.json` / `0001_snapshot.json` — drizzle
  snapshot metadata.

These files are preserved only as a reference for existing-product upgrade
planning. They are **not** part of the new composable product migration chain
under `src/migrations/`, and no file here is renamed, recomputed, or replayed
as if it were the new chain's `0000`.

Source (read-only): `apps/web/src/lib/db/migrations/`.

SHA-256 of the frozen copies:

| File | SHA-256 |
| --- | --- |
| `0000_narrow_morbius.sql` | `779b5f4c4082493fa827ce6037154b562fc3fe7552d39ba6fb5cb9217cee97c5` |
| `0001_nappy_charles_xavier.sql` | `bb49c2ea13ef52eec131bafc92b8140c947222f50c9895586b49f77824857c61` |
| `meta/_journal.json` | `b04b4031e0d0af7e61c57419fbfd8fdd3980683c881ee2acaf1537aa5b231f8c` |
| `meta/0000_snapshot.json` | `746e6cf845ab32f6428a7bd8fe3ea79374f1c65824b192dc4bae11254f8be1a7` |
| `meta/0001_snapshot.json` | `630cee723eaf322b62c812467d8e1bece62c6fc9647fb5ec211c784408023f78` |
