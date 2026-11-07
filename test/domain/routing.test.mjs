import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { test } from "node:test";

globalThis.AsyncLocalStorage = AsyncLocalStorage;

const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { NextResponse } = webRequire("next/server");
const { adapter } = webRequire("next/dist/server/web/adapter");
const { NextURL } = webRequire("next/dist/server/web/next-url");
const proxyModule = await import("../../apps/web/src/proxy.ts");
const { proxy } = proxyModule.default ?? proxyModule;
const nextConfig = (await import("../../apps/web/next.config.mjs")).default;

const nextConfigForAdapter = {
  basePath: "",
  i18n: null,
  trailingSlash: false,
  experimental: {},
};

async function runAdapter(url, handler) {
  const previous = process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
  // Next compiles the public skipProxyUrlNormalize option to this runtime flag.
  process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE = "1";
  try {
    const result = await adapter({
      handler,
      page: "/proxy",
      request: {
        url,
        headers: { host: new URL(url).host },
        method: "GET",
        nextConfig: nextConfigForAdapter,
        signal: new AbortController().signal,
      },
    });
    return result.response;
  } finally {
    if (previous === undefined) delete process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE;
    else process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE = previous;
  }
}

function parseRewrite(response) {
  const rewrite = response.headers.get("x-middleware-rewrite");
  assert.ok(rewrite, "adapter response must include x-middleware-rewrite");
  return new NextURL(rewrite, {
    headers: { host: new URL(rewrite).host },
    nextConfig: nextConfigForAdapter,
  });
}

test("routing: public config enables proxy URL normalization compatibility", () => {
  assert.equal(nextConfig.skipProxyUrlNormalize, true);
});

test("routing: real adapter accepts the application proxy's absolute rewrite", async () => {
  const url = "http://127.0.0.1:49961/login?next=%2Fdashboard%3Ftab%3Dusage";
  const response = await runAdapter(url, proxy);
  const rewrite = response.headers.get("x-middleware-rewrite");

  // C10 makes zh the application default; /en remains an explicit alternate.
  assert.equal(response.status, 200);
  assert.equal(rewrite, "http://127.0.0.1:49961/zh/login?next=%2Fdashboard%3Ftab%3Dusage");
  assert.doesNotThrow(() => parseRewrite(response));
  assert.equal(new URL(rewrite).origin, "http://127.0.0.1:49961");
  assert.equal(response.headers.get("location"), null);
  assert.match(response.headers.get("set-cookie") ?? "", /NEXT_LOCALE=zh/);
  const alternateLinks = response.headers.get("link") ?? "";
  assert.match(alternateLinks, /hreflang="zh"/);
  assert.match(alternateLinks, /hreflang="en"/);
  assert.match(alternateLinks, /hreflang="x-default"/);
});

test("routing: real adapter preserves external rewrites, redirects and pass-through responses", async () => {
  const url = "http://127.0.0.1:49961/login";
  // The /en target below is an external rewrite fixture, not the app default.
  const externalRewrite = await runAdapter(url, async () =>
    NextResponse.rewrite("https://api.example.invalid/en/login?next=external"),
  );
  assert.equal(
    externalRewrite.headers.get("x-middleware-rewrite"),
    "https://api.example.invalid/en/login?next=external",
  );

  const redirect = await runAdapter(url, async () =>
    NextResponse.redirect("https://accounts.example.invalid/sign-in"),
  );
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get("location"), "https://accounts.example.invalid/sign-in");
  assert.equal(redirect.headers.get("x-middleware-rewrite"), null);

  const passThrough = await runAdapter(
    url,
    async () =>
      new NextResponse("ok", {
        status: 202,
        headers: { "x-routing-test": "preserved" },
      }),
  );
  assert.equal(passThrough.status, 202);
  assert.equal(passThrough.headers.get("x-middleware-rewrite"), null);
  assert.equal(passThrough.headers.get("x-routing-test"), "preserved");
});

test("routing: adapter preserves an absolute rewrite whose pathname begins with //", async () => {
  const url = "http://127.0.0.1:49961/login";
  const target = "http://127.0.0.1:49961//docs.example.invalid/en?next=%2Fdashboard";
  const response = await runAdapter(url, async () => {
    const rewrite = NextResponse.rewrite(target);
    rewrite.headers.set("x-routing-test", "preserved");
    rewrite.cookies.set("routing_test", "preserved");
    return rewrite;
  });
  const rewrite = response.headers.get("x-middleware-rewrite");

  assert.equal(rewrite, target);
  assert.doesNotThrow(() => parseRewrite(response));
  assert.equal(new URL(rewrite).origin, "http://127.0.0.1:49961");
  assert.equal(new URL(rewrite).pathname, "//docs.example.invalid/en");
  assert.equal(response.headers.get("x-routing-test"), "preserved");
  assert.match(response.headers.get("set-cookie") ?? "", /routing_test=preserved/);
});
