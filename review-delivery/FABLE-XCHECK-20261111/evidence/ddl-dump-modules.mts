import { writeFileSync } from "node:fs";
import { ALL_MODULES } from "/home/user/biubiuniu/packages/persistence-pg/src/migrations/modules/index.ts";
const out = process.argv[2];
for (const m of ALL_MODULES) { writeFileSync(`${out}/niu-${m.name}.sql`, m.sql + "\n"); console.log(m.name, m.version, m.contractVersion, m.dependencies.join(","), m.sql.length); }
