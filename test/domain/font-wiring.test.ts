/**
 * E2 font-wiring guard: the app font registry must not depend on build-time
 * Google Fonts network access. It must use next/font/local with pinned,
 * license-complete local assets from the upstream google/fonts fixed commit
 * 7af0d90b4d532ffa4b041937b560c6df4e7b1e95.
 *
 * Static source + filesystem assertions only. The next/font macros are not
 * imported here: next/font/local throws at runtime in a plain Node process,
 * and the build-time SWC/webpack semantics cannot be reproduced by this runner.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const FONTS_TS = "apps/web/src/app/fonts.ts";
const LAYOUT_TS = "apps/web/src/app/[locale]/layout.tsx";

const FONT_ASSETS: Record<string, string> = {
  "apps/web/src/app/fonts/Inter-Variable.ttf":
    "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
  "apps/web/src/app/fonts/Inter-OFL.txt":
    "5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57",
  "apps/web/src/app/fonts/Karla-Variable.ttf":
    "ed3ca4cd9bdd899c543927c30bf5ff50706b24b3f2b7328e64b25f7d2a9d23dc",
  "apps/web/src/app/fonts/Karla-OFL.txt":
    "edf2c840acb9570fe02f40721126aa0da4e4011a0030cc6dce30780569f609b6",
  "apps/web/src/app/fonts/Pacifico-Regular.ttf":
    "5b6c0d5334a7bf77dea52b975c5a0c408878c0f7115ed5b6fb151f634b7bf701",
  "apps/web/src/app/fonts/Pacifico-OFL.txt":
    "a47e5daeda73568969395c656823102678f2eefb0d7d7ecb47aac4cc17e42204",
};

function readRepoFile(relativePath: string): string {
  const fullPath = join(root, relativePath);
  assert.ok(existsSync(fullPath), `${relativePath} must exist`);
  return readFileSync(fullPath, "utf8");
}

function sha256(relativePath: string): string {
  const fullPath = join(root, relativePath);
  assert.ok(existsSync(fullPath), `${relativePath} must exist`);
  return createHash("sha256").update(readFileSync(fullPath)).digest("hex");
}

test("font wiring must not import next/font/google", () => {
  for (const relativePath of [FONTS_TS, LAYOUT_TS]) {
    const source = readRepoFile(relativePath);
    assert.ok(
      !source.includes("next/font/google"),
      `${relativePath} must not depend on build-time Google Fonts network access`,
    );
  }
});

test("font registry uses next/font/local with preserved contract", () => {
  const source = readRepoFile(FONTS_TS);

  assert.ok(source.includes("next/font/local"), "fonts.ts must import next/font/local");

  for (const family of ["inter", "karla", "pacifico"]) {
    assert.match(
      source,
      new RegExp(`export const ${family}\\s*=`),
      `fonts.ts must export ${family}`,
    );
  }

  assert.match(source, /weight:\s*["']100 900["']/, "Inter weight range must be 100 900");
  assert.match(source, /weight:\s*["']200 800["']/, "Karla weight range must be 200 800");
  assert.match(source, /weight:\s*["']400["']/, "Pacifico weight must be 400");

  assert.match(source, /variable:\s*["']--font-sans["']/, "fonts.ts must declare --font-sans");
  assert.match(
    source,
    /variable:\s*["']--font-pacifico["']/,
    "fonts.ts must declare --font-pacifico",
  );

  assert.match(source, /display:\s*["']swap["']/, "fonts.ts must keep font-display: swap");

  for (const filename of ["Inter-Variable.ttf", "Karla-Variable.ttf", "Pacifico-Regular.ttf"]) {
    assert.match(
      source,
      new RegExp(filename.replace(/\./g, "\\.")),
      `fonts.ts must reference ${filename}`,
    );
  }
});

test("layout mounts both font variables from the local registry", () => {
  const source = readRepoFile(LAYOUT_TS);

  assert.match(source, /from\s+["']@\/app\/fonts["']/, "layout must import the font registry");
  assert.match(source, /inter\.variable/, "layout must mount --font-sans via inter.variable");
  assert.match(
    source,
    /pacifico\.variable/,
    "layout must mount --font-pacifico via pacifico.variable",
  );
});

test("pinned local font assets and OFL licenses have verified SHA-256", () => {
  for (const [relativePath, expected] of Object.entries(FONT_ASSETS)) {
    assert.equal(
      sha256(relativePath),
      expected,
      `${relativePath} SHA-256 must match the pinned upstream asset`,
    );
  }
});
