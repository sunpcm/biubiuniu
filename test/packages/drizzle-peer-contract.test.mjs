import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

function manifest(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

test("db exposes drizzle-orm as a peer contract, not a bundled dependency", () => {
  const p = manifest("packages/db/package.json");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(p.dependencies ?? {}, "drizzle-orm"),
    "drizzle-orm must not be a direct dependency of @sunpcm/niu-db",
  );
  assert.equal(p.peerDependencies?.["drizzle-orm"], "^0.44.5");
  assert.equal(p.devDependencies?.["drizzle-orm"], "catalog:");
});

test("persistence-pg exposes drizzle-orm as a peer contract, not a bundled dependency", () => {
  const p = manifest("packages/persistence-pg/package.json");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(p.dependencies ?? {}, "drizzle-orm"),
    "drizzle-orm must not be a direct dependency of @sunpcm/niu-persistence-pg",
  );
  assert.equal(p.peerDependencies?.["drizzle-orm"], "^0.44.5");
  assert.equal(p.devDependencies?.["drizzle-orm"], "catalog:");
});

test("db and persistence-pg share one frozen drizzle-orm peer range with the consumer", () => {
  const db = manifest("packages/db/package.json");
  const pg = manifest("packages/persistence-pg/package.json");
  const app = manifest("apps/web/package.json");
  assert.equal(app.dependencies?.["drizzle-orm"], "catalog:");
  assert.equal(db.peerDependencies["drizzle-orm"], pg.peerDependencies["drizzle-orm"]);
});
