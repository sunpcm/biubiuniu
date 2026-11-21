import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const nextPkg = join(repoRoot, "packages", "next");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readSource(name) {
  return readFile(join(nextPkg, "src", name), "utf8");
}

test("manifest publishes a server root and a physically separate client subpath", async () => {
  const pkg = await readJson(join(nextPkg, "package.json"));
  assert.equal(pkg.name, "@sunpcm/niu-next");
  assert.equal(pkg.version, "0.1.0-next.0");
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  });
  assert.deepEqual(pkg.exports["./client"], {
    types: "./dist/client.d.ts",
    import: "./dist/client.js",
  });
});

test("server entry wires nextCookies last and injects React.cache", async () => {
  const server = await readSource("index.ts");
  assert.match(server, /createNextAuthPlugins/);
  assert.match(server, /nextCookies\(\)/);
  assert.match(server, /memoize:\s*cache/);
  assert.match(server, /from "next\/headers\.js"/);
  assert.match(server, /from "next\/navigation\.js"/);
  assert.match(server, /from "better-auth\/next-js"/);
});

test("server root does not mix the client barrel", async () => {
  const server = await readSource("index.ts");
  assert.doesNotMatch(server, /from "\.\/client\.js"/);
  assert.doesNotMatch(server, /from "\.\/client"/);
});

test("client entry is physically separate and imports the auth client subpath", async () => {
  const client = await readSource("client.ts");
  assert.match(client, /from "@sunpcm\/niu-auth\/client"/);
  assert.doesNotMatch(client, /from "@sunpcm\/niu-auth"/);
});
