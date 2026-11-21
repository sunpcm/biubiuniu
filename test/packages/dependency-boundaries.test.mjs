import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeWorkspace,
  checkArtifacts,
  loadWorkspace,
  normalizeBareSpecifier,
  parseModule,
  resolveRelativeSpecifier,
} from "../../scripts/dependency-boundaries.mjs";

function file(bare = [], relative = [], env = false) {
  return {
    bare: bare.map((b) => (typeof b === "string" ? { spec: b, type: "value" } : b)),
    relative,
    env,
  };
}

function pkg(name, opts = {}) {
  const dir = opts.dir ?? `/ws/${name}`;
  const files = new Map();
  for (const [rel, f] of Object.entries(opts.files ?? {})) files.set(rel, f);
  return [
    name,
    {
      name,
      dir,
      kind: opts.kind ?? "package",
      dependencies: new Set(opts.dependencies ?? []),
      devDependencies: new Set(opts.devDependencies ?? []),
      peerDependencies: new Set(opts.peerDependencies ?? []),
      optionalDependencies: new Set(opts.optionalDependencies ?? []),
      exports: Object.prototype.hasOwnProperty.call(opts, "exports")
        ? opts.exports
        : { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      files,
    },
  ];
}

function analyze(...entries) {
  return analyzeWorkspace(new Map(entries));
}

function kinds(report, kind) {
  return report.violations.filter((v) => v.kind === kind);
}

function buildBoundaryFixture(rootDir) {
  // Published package: illegal @/ import in its dist entry must be flagged.
  const pkgDir = join(rootDir, "packages", "pkg-a");
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@sunpcm/niu-a",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      dependencies: {},
    }),
  );
  writeFileSync(join(pkgDir, "dist", "index.js"), `import x from "@/config/site";\n`);
  writeFileSync(join(pkgDir, "dist", "index.d.ts"), `export {};\n`);

  // App: @/ is legal, must NOT be flagged as reverse.
  const appDir = join(rootDir, "apps", "web");
  mkdirSync(join(appDir, "src"), { recursive: true });
  writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "@niu/web" }));
  writeFileSync(join(appDir, "src", "index.ts"), `import x from "@/config/site";\n`);
}

function assertKindClassification(ws) {
  assert.equal(ws.get("@niu/web").kind, "app");
  assert.equal(ws.get("@sunpcm/niu-a").kind, "package");
  const report = analyzeWorkspace(ws);
  const reverses = kinds(report, "reverse");
  assert.ok(reverses.some((v) => v.package === "@sunpcm/niu-a" && v.spec === "@/config/site"));
  assert.ok(!reverses.some((v) => v.package === "@niu/web"));
}

test("normalizeBareSpecifier collapses scoped and subpath specifiers", () => {
  assert.deepEqual(normalizeBareSpecifier("@sunpcm/niu-db"), { root: "@sunpcm/niu-db", subpath: null });
  assert.deepEqual(normalizeBareSpecifier("@sunpcm/niu-db/schema/auth"), { root: "@sunpcm/niu-db", subpath: "schema/auth" });
  assert.deepEqual(normalizeBareSpecifier("lodash/fp"), { root: "lodash", subpath: "fp" });
  assert.equal(normalizeBareSpecifier("./local"), null);
  assert.equal(normalizeBareSpecifier("@/lib/db"), null);
});

test("parseModule extracts bare, relative, and process.env", () => {
  const parsed = parseModule(
    `import x from "stripe"; import type T from "@types/node"; import "./local.js"; export * from "./reexport.js"; const s = process.env.PRODUCT_SECRET;`,
  );
  assert.ok(parsed.bare.some((b) => b.spec === "stripe" && b.type === "value"));
  assert.ok(parsed.bare.some((b) => b.spec === "@types/node" && b.type === "type"));
  assert.ok(parsed.relative.includes("./local.js"));
  assert.ok(parsed.relative.includes("./reexport.js"));
  assert.equal(parsed.env, true);
});

test("resolveRelativeSpecifier resolves extensions and detects escapes", () => {
  const files = new Map([
    ["dist/index.js", file()],
    ["dist/providers/leak.js", file()],
  ]);
  assert.equal(resolveRelativeSpecifier("dist/index.js", "./providers/leak.js", files), "dist/providers/leak.js");
  assert.equal(resolveRelativeSpecifier("dist/index.js", "../../outside.js", files), "../outside.js");
});

test("root re-export of a provider subpath leaks its SDK", () => {
  const report = analyze(
    pkg("@sunpcm/niu-commerce", {
      peerDependencies: ["stripe"],
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./providers/leak": { types: "./dist/providers/leak.d.ts", import: "./dist/providers/leak.js" },
      },
      files: {
        "dist/index.js": file([], ["dist/providers/leak.js"]),
        "dist/index.d.ts": file([], ["dist/providers/leak.d.ts"]),
        "dist/providers/leak.js": file(["stripe"]),
        "dist/providers/leak.d.ts": file([{ spec: "stripe", type: "type" }]),
      },
    })
  );
  assert.ok(kinds(report, "core-leak").some((v) => v.spec === "stripe"));
});

test("provider subpath SDK is legal when not re-exported from root", () => {
  const report = analyze(
    pkg("@sunpcm/niu-commerce", {
      peerDependencies: ["stripe"],
      exports: {
        ".": { import: "./dist/index.js" },
        "./providers/stripe": { import: "./dist/providers/stripe.js" },
      },
      files: {
        "dist/index.js": file([], []),
        "dist/providers/stripe.js": file(["stripe"]),
      },
    })
  );
  assert.equal(kinds(report, "core-leak").length, 0);
});

test("auth root forbids React while the explicit client entry may use it", () => {
  const rootReact = analyze(
    pkg("@sunpcm/niu-auth", {
      peerDependencies: ["react"],
      exports: { ".": { import: "./dist/index.js" }, "./client": { import: "./dist/client.js" } },
      files: { "dist/index.js": file(["react"]), "dist/client.js": file(["react"]) },
    })
  );
  assert.ok(kinds(rootReact, "core-leak").some((v) => v.spec === "react"));

  const clientOnly = analyze(
    pkg("@sunpcm/niu-auth", {
      peerDependencies: ["react"],
      exports: { ".": { import: "./dist/index.js" }, "./client": { import: "./dist/client.js" } },
      files: { "dist/index.js": file([], []), "dist/client.js": file(["react"]) },
    })
  );
  assert.equal(kinds(clientOnly, "core-leak").length, 0);
});

test("auth root still allows better-auth core but forbids better-auth/next-js", () => {
  const nextjs = analyze(
    pkg("@sunpcm/niu-auth", { peerDependencies: ["better-auth"], files: { "dist/index.js": file(["better-auth/next-js"]) } })
  );
  assert.ok(kinds(nextjs, "core-leak").some((v) => v.spec === "better-auth/next-js"));

  const core = analyze(
    pkg("@sunpcm/niu-auth", { peerDependencies: ["better-auth"], files: { "dist/index.js": file(["better-auth"]) } })
  );
  assert.equal(kinds(core, "core-leak").length, 0);
});

test("core root closure reading process.env is rejected", () => {
  const report = analyze(
    pkg("@sunpcm/niu-commerce", { exports: { ".": { import: "./dist/index.js" } }, files: { "dist/index.js": file([], [], true) } })
  );
  assert.equal(kinds(report, "core-env").length, 1);
});

test("detects an undeclared third-party root and subpath", () => {
  const report = analyze(pkg("@sunpcm/niu-a", { files: { "src/index.ts": file(["lodash", "lodash/fp"]) } }));
  assert.ok(kinds(report, "undeclared").some((v) => v.root === "lodash"));
});

test("Node builtins (with and without node:) are never undeclared", () => {
  const report = analyze(pkg("@sunpcm/niu-a", { files: { "src/index.ts": file(["fs", "node:fs", "path"]) } }));
  assert.equal(kinds(report, "undeclared").length, 0);
});

test("detects an undeclared workspace subpath", () => {
  const report = analyze(
    pkg("@sunpcm/niu-db", { exports: { ".": { import: "./dist/index.js" } }, files: { "dist/index.js": file() } }),
    pkg("@sunpcm/niu-a", { dependencies: ["@sunpcm/niu-db"], files: { "src/index.ts": file(["@sunpcm/niu-db/not-exported"]) } }),
  );
  assert.ok(kinds(report, "undeclared-subpath").some((v) => v.root === "@sunpcm/niu-db" && v.subpath === "not-exported"));
});

test("accepts a declared workspace subpath that is exported", () => {
  const report = analyze(
    pkg("@sunpcm/niu-db", { exports: { ".": { import: "./dist/index.js" }, "./schema": { import: "./dist/schema.js" } }, files: { "dist/index.js": file(), "dist/schema.js": file() } }),
    pkg("@sunpcm/niu-a", { dependencies: ["@sunpcm/niu-db"], files: { "src/index.ts": file(["@sunpcm/niu-db/schema"]) } }),
  );
  assert.equal(kinds(report, "undeclared-subpath").length, 0);
});

test("detects a runtime import hidden behind devDependencies only", () => {
  const report = analyze(pkg("@sunpcm/niu-a", { devDependencies: ["lodash"], files: { "src/index.ts": file([{ spec: "lodash", type: "value" }]) } }));
  assert.ok(kinds(report, "runtime-dev-dep").some((v) => v.root === "lodash"));
});

test("type-only imports may live in devDependencies", () => {
  const report = analyze(pkg("@sunpcm/niu-a", { devDependencies: ["@types/lodash"], files: { "src/index.ts": file([{ spec: "@types/lodash", type: "type" }]) } }));
  assert.equal(kinds(report, "runtime-dev-dep").length, 0);
});

test("a value import declared as a peerDependency is runtime, not dev-only", () => {
  const report = analyze(
    pkg("@sunpcm/niu-db", {
      peerDependencies: ["drizzle-orm"],
      devDependencies: ["drizzle-orm"],
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      files: { "dist/index.js": file([{ spec: "drizzle-orm", type: "value" }]) },
    })
  );
  assert.equal(kinds(report, "undeclared").length, 0);
  assert.equal(kinds(report, "runtime-dev-dep").length, 0);
});

test("parseModule classifies inline type-only imports as type", () => {
  const parsed = parseModule(`import { type Root, type Element } from "hast";`);
  assert.ok(parsed.bare.some((b) => b.spec === "hast" && b.type === "type"));
});

test("parseModule keeps mixed value+type imports as value", () => {
  const parsed = parseModule(`import rehypeSanitize, { defaultSchema, type Options } from "rehype-sanitize";`);
  assert.ok(parsed.bare.some((b) => b.spec === "rehype-sanitize" && b.type === "value"));
});

test("parseModule keeps @/ alias specs in bare for reverse detection", () => {
  const parsed = parseModule(
    `import x from "@/config/site"; export * from "@/config/other"; const d = import("@/dyn"); const r = require("@/req"); import type T from "@/types/t";`,
  );
  for (const spec of ["@/config/site", "@/config/other", "@/dyn", "@/req"]) {
    assert.ok(parsed.bare.some((b) => b.spec === spec && b.type === "value"), `@/ value spec missing: ${spec}`);
  }
  assert.ok(parsed.bare.some((b) => b.spec === "@/types/t" && b.type === "type"));
});

test("archived source not re-exported is excluded from dependency classification", () => {
  const report = analyze(
    pkg("@sunpcm/niu-db", {
      dependencies: ["drizzle-orm", "postgres"],
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      files: {
        "dist/index.js": file(["drizzle-orm"]),
        "dist/index.d.ts": file(),
        "src/seed/index.ts": file(["dotenv/config"]),
        "src/seed/export.ts": file(["dotenv/config"]),
      },
    })
  );
  assert.equal(kinds(report, "undeclared").length, 0);
});

test("archived source re-exported from the root is still classified", () => {
  const report = analyze(
    pkg("@sunpcm/niu-db", {
      dependencies: ["drizzle-orm", "postgres"],
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      files: {
        "dist/index.js": file([], ["dist/seed/index.js"]),
        "dist/index.d.ts": file(),
        "dist/seed/index.js": file(["dotenv/config"]),
      },
    })
  );
  assert.ok(kinds(report, "undeclared").some((v) => v.root === "dotenv"));
});

test("app build config devDependency is not classified as runtime", () => {
  const report = analyze(
    pkg("@niu/web", {
      kind: "app",
      devDependencies: ["drizzle-kit"],
      exports: null,
      files: { "src/lib/db/drizzle.config.ts": file(["drizzle-kit"]) },
    })
  );
  assert.equal(kinds(report, "runtime-dev-dep").length, 0);
});

test("app real runtime import behind devDependencies is still flagged", () => {
  const report = analyze(
    pkg("@niu/web", {
      kind: "app",
      devDependencies: ["drizzle-kit"],
      exports: null,
      files: { "src/lib/db/index.ts": file(["drizzle-kit"]) },
    })
  );
  assert.ok(kinds(report, "runtime-dev-dep").some((v) => v.root === "drizzle-kit"));
});

test("type-only import resolves via the @types mapping", () => {
  const report = analyze(
    pkg("@niu/web", {
      kind: "app",
      devDependencies: ["@types/hast"],
      exports: null,
      files: { "src/lib/cms/markdown.ts": file([{ spec: "hast", type: "type" }]) },
    })
  );
  assert.equal(kinds(report, "undeclared").length, 0);
  assert.equal(kinds(report, "runtime-dev-dep").length, 0);
});

test("type-only import without a runtime or @types package is undeclared", () => {
  const report = analyze(
    pkg("@niu/web", {
      kind: "app",
      exports: null,
      files: { "src/lib/cms/markdown.ts": file([{ spec: "hast", type: "type" }]) },
    })
  );
  assert.ok(kinds(report, "undeclared").some((v) => v.root === "hast"));
});

test("detects a dependency cycle", () => {
  const report = analyze(
    pkg("@sunpcm/niu-a", { dependencies: ["@sunpcm/niu-b"], files: {} }),
    pkg("@sunpcm/niu-b", { dependencies: ["@sunpcm/niu-a"], files: {} }),
  );
  assert.ok(report.cycles.length > 0);
});

test("detects a reverse app import via @/", () => {
  const report = analyze(pkg("@sunpcm/niu-a", { files: { "src/index.ts": file(["@/app/secret"]) } }));
  assert.ok(kinds(report, "reverse").some((v) => v.spec === "@/app/secret"));
});

test("loadWorkspace detects @/ reverse imports from real source/JS/d.ts files", () => {
  const dir = mkdtempSync(join(tmpdir(), "niu-boundary-real-"));

  // Published package: @/ in dist JS + d.ts (reachable from exports).
  const pkgDir = join(dir, "packages", "pkg-a");
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@sunpcm/niu-a",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      dependencies: {},
    }),
  );
  writeFileSync(
    join(pkgDir, "dist", "index.js"),
    [
      `import x from "@/config/site";`,
      `export * from "@/config/other";`,
      `const d = import("@/dynamic/x");`,
      `const r = require("@/legacy/x");`,
      `import "@/side-effect";`,
    ].join("\n"),
  );
  writeFileSync(
    join(pkgDir, "dist", "index.d.ts"),
    `import type T from "@/types/t";\nexport type { X } from "@/types/x";\n`,
  );

  // Source-only package: @/ in src (exports fall back to src via resolveEntryFile).
  const srcPkgDir = join(dir, "packages", "pkg-b");
  mkdirSync(join(srcPkgDir, "src"), { recursive: true });
  writeFileSync(
    join(srcPkgDir, "package.json"),
    JSON.stringify({
      name: "@sunpcm/niu-b",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      dependencies: {},
    }),
  );
  writeFileSync(join(srcPkgDir, "src", "index.ts"), `export * from "@/config/src";\n`);

  // App: @/ is legal, must NOT be flagged as reverse.
  const appDir = join(dir, "apps", "web");
  mkdirSync(join(appDir, "src"), { recursive: true });
  writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "@niu/web" }));
  writeFileSync(join(appDir, "src", "index.ts"), `import x from "@/config/site";\n`);

  const report = analyzeWorkspace(loadWorkspace(dir));
  const reverses = kinds(report, "reverse");

  for (const spec of ["@/config/site", "@/config/other", "@/dynamic/x", "@/legacy/x", "@/side-effect"]) {
    assert.ok(
      reverses.some((v) => v.package === "@sunpcm/niu-a" && v.spec === spec),
      `dist JS @/ reverse missing: ${spec}`,
    );
  }
  assert.ok(reverses.some((v) => v.package === "@sunpcm/niu-a" && v.spec === "@/types/t"));
  assert.ok(reverses.some((v) => v.package === "@sunpcm/niu-a" && v.spec === "@/types/x"));
  assert.ok(reverses.some((v) => v.package === "@sunpcm/niu-b" && v.spec === "@/config/src"));
  assert.ok(!report.violations.some((v) => v.package === "@niu/web" && v.kind === "reverse"));
});

test("detects a reverse relative-path escape", () => {
  const report = analyze(pkg("@sunpcm/niu-a", { files: { "src/index.ts": file([], ["../apps/web/secret.ts"]) } }));
  assert.ok(kinds(report, "reverse").some((v) => v.spec === "../apps/web/secret.ts"));
});

test("UI leaks server-only/Node/database", () => {
  const report = analyze(pkg("@sunpcm/niu-ui", { files: { "src/index.ts": file(["server-only", "drizzle-orm", "fs"]) } }));
  assert.equal(kinds(report, "ui-server").length, 3);
});

test("checkArtifacts flags missing types even when JS exists", () => {
  const report = checkArtifacts(new Map([
    pkg("@sunpcm/niu-a", {
      dir: "/nonexistent",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      files: { "dist/index.js": file() },
    }),
  ]));
  assert.ok(report.some((v) => v.kind === "missing-dist" && v.file === "./dist/index.d.ts"));
});

test("checkArtifacts expands wildcards and verifies paired JS/types", () => {
  const ok = checkArtifacts(new Map([
    pkg("@sunpcm/niu-ui", {
      dir: "/nonexistent",
      exports: { "./components/*": { types: "./dist/*.d.ts", import: "./dist/*.js" } },
      files: { "dist/button.js": file(), "dist/button.d.ts": file() },
    }),
  ]));
  assert.equal(ok.length, 0);

  const missing = checkArtifacts(new Map([
    pkg("@sunpcm/niu-ui", {
      dir: "/nonexistent",
      exports: { "./components/*": { types: "./dist/*.d.ts", import: "./dist/*.js" } },
      files: { "dist/button.js": file() },
    }),
  ]));
  assert.ok(missing.some((v) => v.file === "dist/button.d.ts"));
});

test("checkArtifacts skips non-publishable packages", () => {
  assert.equal(checkArtifacts(new Map([pkg("@niu/tsconfig", { exports: null })])).length, 0);
});

test("checkArtifacts accepts an existing dist artifact", () => {
  const dir = mkdtempSync(join(tmpdir(), "niu-boundary-"));
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "index.js"), "export {};\n");
  writeFileSync(join(dir, "dist", "index.d.ts"), "export {};\n");
  const report = checkArtifacts(new Map([
    pkg("@sunpcm/niu-a", { dir, exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } }, files: new Map() }),
  ]));
  assert.equal(report.length, 0);
});

test("report is a plain object (JSON.stringify does not hide violations)", () => {
  const report = analyze(pkg("@sunpcm/niu-a", { files: { "src/index.ts": file(["lodash"]) } }));
  const json = JSON.stringify(report);
  assert.ok(json.includes("lodash"));
  assert.ok(Array.isArray(report.violations));
});

test("loadWorkspace classifies app vs package consistently for dot, absolute, and apps-ancestor roots", () => {
  const absRoot = mkdtempSync(join(tmpdir(), "niu-kind-abs-"));
  buildBoundaryFixture(absRoot);
  assertKindClassification(loadWorkspace(absRoot));

  const dotRoot = mkdtempSync(join(tmpdir(), "niu-kind-dot-"));
  buildBoundaryFixture(dotRoot);
  const prevCwd = process.cwd();
  try {
    process.chdir(dotRoot);
    assertKindClassification(loadWorkspace("."));
  } finally {
    process.chdir(prevCwd);
  }

  const ancestorParent = mkdtempSync(join(tmpdir(), "niu-kind-ancestor-"));
  const appsAncestor = join(ancestorParent, "apps");
  mkdirSync(appsAncestor);
  const ancestorRoot = join(appsAncestor, "ws");
  buildBoundaryFixture(ancestorRoot);
  assertKindClassification(loadWorkspace(ancestorRoot));
});

test("CLI classifies app vs package consistently for dot and absolute root", () => {
  const scriptPath = fileURLToPath(new URL("../../scripts/dependency-boundaries.mjs", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "niu-cli-"));
  buildBoundaryFixture(root);

  for (const [label, arg, cwd] of [
    ["absolute", root, undefined],
    ["dot", ".", root],
  ]) {
    const res = spawnSync(process.execPath, [scriptPath, arg], { cwd, encoding: "utf8" });
    assert.equal(res.status, 1, `${label}: expected exit 1`);
    let report;
    try {
      report = JSON.parse(res.stdout);
    } catch {
      assert.fail(`${label}: CLI did not emit valid JSON`);
    }
    assert.ok(
      report.violations.some((v) => v.package === "@sunpcm/niu-a" && v.kind === "reverse" && v.spec === "@/config/site"),
      `${label}: package @/ reverse missing`,
    );
    assert.ok(
      !report.violations.some((v) => v.package === "@niu/web" && v.kind === "reverse"),
      `${label}: app @/ incorrectly flagged as reverse`,
    );
  }
});
