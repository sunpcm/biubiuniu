import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { Writable } from "node:stream";

import { isAiEnabled, isPurchaseEnabled } from "@/config/features";
import { applyPricingOverride, PRICING_PATH, resolvePricingPath } from "@/config/public-paths";
import { renderSanitizedMarkdown } from "@/lib/cms/markdown";
import { evaluateHealthChecks, withTimeout } from "@/lib/health";
import { createLogger, type LoggerSinks } from "@/lib/logger";
import { REDACTED_LOG_VALUE, buildBaseLoggerOptions } from "@/lib/logger/options";
import { resolveRedisConfiguration } from "@/lib/redis/provider-selection";
import { purgeUserArtifacts } from "@/lib/storage/account-purge";
const appRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const pino: typeof import("pino") = appRequire("pino");

function stringifyPrivacySurface(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
        stack: item.stack,
        ...Object.fromEntries(Object.entries(item)),
      };
    }
    return item;
  });
}

test("pricing navigation has one explicit fallback and ignores blank overrides", () => {
  assert.equal(resolvePricingPath(undefined), "/#pricing");
  assert.equal(resolvePricingPath(""), "/#pricing");
  assert.equal(resolvePricingPath("   "), "/#pricing");
  assert.equal(resolvePricingPath("/plans"), "/plans");

  const source = { id: "pricing", href: "/pricing", label: "Pricing" };
  const overridden = applyPricingOverride(source);
  assert.notEqual(overridden, source);
  assert.equal(source.href, "/pricing");
  assert.equal(overridden.href, PRICING_PATH);
  assert.equal(overridden.label, "Pricing");
});

test("new purchase and paid AI entry points stay closed unless explicitly enabled", () => {
  const previousPurchase = process.env.DISABLE_PURCHASE;
  const previousAi = process.env.DISABLE_AI;

  try {
    delete process.env.DISABLE_PURCHASE;
    delete process.env.DISABLE_AI;
    assert.equal(isPurchaseEnabled(), false);
    assert.equal(isAiEnabled(), false);

    process.env.DISABLE_PURCHASE = "true";
    process.env.DISABLE_AI = "0";
    assert.equal(isPurchaseEnabled(), false);
    assert.equal(isAiEnabled(), false);

    process.env.DISABLE_PURCHASE = "false";
    process.env.DISABLE_AI = "false";
    assert.equal(isPurchaseEnabled(), true);
    assert.equal(isAiEnabled(), true);
  } finally {
    if (previousPurchase === undefined) delete process.env.DISABLE_PURCHASE;
    else process.env.DISABLE_PURCHASE = previousPurchase;
    if (previousAi === undefined) delete process.env.DISABLE_AI;
    else process.env.DISABLE_AI = previousAi;
  }
});

test("structured logger redacts credentials in top-level and nested fields", async () => {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const logger = pino(buildBaseLoggerOptions("application-runtime-test"), stream);

  logger.info(
    {
      password: "plain-password",
      token: "plain-token",
      nested: { accessToken: "nested-token", safe: "visible" },
      req: { headers: { authorization: "Bearer raw", cookie: "sid=raw" } },
      safe: "preserved",
    },
    "redaction probe",
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  const entry = JSON.parse(output.trim());
  assert.equal(entry.password, REDACTED_LOG_VALUE);
  assert.equal(entry.token, REDACTED_LOG_VALUE);
  assert.equal(entry.nested.accessToken, REDACTED_LOG_VALUE);
  assert.equal(entry.nested.safe, "visible");
  assert.equal(entry.req.headers.authorization, REDACTED_LOG_VALUE);
  assert.equal(entry.req.headers.cookie, REDACTED_LOG_VALUE);
  assert.equal(entry.safe, "preserved");
  assert.doesNotMatch(output, /plain-password|plain-token|nested-token|Bearer raw|sid=raw/);
});

test("createLogger sanitizes every Pino and Sentry sink without mutating callers", async () => {
  const marker = "synthetic-privacy-marker-r1";
  const awsAccessKeyId = "SYNTHETIC_AWS_ACCESS_KEY_ID_R4";
  const awsSecretAccessKey = "synthetic_aws_secret_access_key_r4";
  const awsRegion = "ap-southeast-1";
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const pinoLogger = pino(
    {
      ...buildBaseLoggerOptions("application-logger-privacy-test"),
      level: "trace",
    },
    stream,
  );
  const sentryCalls: unknown[] = [];
  const sentry: NonNullable<LoggerSinks["sentry"]> = {
    addBreadcrumb: (breadcrumb) => {
      sentryCalls.push({ kind: "breadcrumb", breadcrumb });
    },
    captureException: (error, context) => {
      sentryCalls.push({ kind: "exception", error, context });
    },
    captureMessage: (message, context) => {
      sentryCalls.push({ kind: "message", message, context });
    },
  };
  const logger = createLogger("application-logger-privacy-test", {
    pino: pinoLogger,
    sentry,
  });

  const requestPayload = {
    requestId: "request-r1",
    route: "/api/orders",
    durationMs: 42,
    req: {
      headers: {
        Authorization: `Bearer ${marker}`,
        COOKIE: `session=${marker}`,
      },
    },
    payload: {
      orderId: "order-r1",
      API_SECRET: marker,
      connectionString: `postgres://user:${marker}@db.example.invalid/app`,
      aws: {
        AccessKeyId: awsAccessKeyId,
        SecretAccessKey: awsSecretAccessKey,
        region: awsRegion,
      },
      credentials: {
        AWS_ACCESS_KEY_ID: awsAccessKeyId,
        AWS_SECRET_ACCESS_KEY: awsSecretAccessKey,
        role: "synthetic-role",
      },
      keep: "visible",
    },
  };
  const original = structuredClone(requestPayload);

  logger.trace({ requestId: "trace-r1", token: marker }, `trace token=${marker}`);
  logger.debug({ requestId: "debug-r1", apiSecret: marker }, "debug");
  logger.info({ requestId: "info-r1", authorization: `Basic ${marker}` }, "info");
  logger.warn(requestPayload, `warn Authorization: Bearer ${marker}`);
  logger.warn(
    { requestId: "aws-text-r4", region: awsRegion },
    `AWS_ACCESS_KEY_ID=${awsAccessKeyId}; aws-secret-access-key=${awsSecretAccessKey}; region=${awsRegion}`,
  );

  const nestedError = Object.assign(new Error(`nested request token=${marker}`), {
    requestId: "nested-error-r1",
    headers: { Cookie: `sid=${marker}` },
  });
  const nestedErrorOriginal = {
    message: nestedError.message,
    requestId: nestedError.requestId,
    headers: structuredClone(nestedError.headers),
  };
  logger.error(
    {
      requestId: "object-error-r1",
      err: nestedError,
      context: {
        orderId: "order-error-r1",
        apiKey: marker,
        connectionString: `redis://default:${marker}@cache.example.invalid:6379`,
      },
    },
    `error connectionString=postgres://user:${marker}@db.example.invalid/app`,
  );

  const directError = Object.assign(new Error(`direct error password=${marker}`), {
    requestId: "direct-error-r1",
    token: marker,
    req: { headers: { authorization: `Bearer ${marker}` } },
  });
  logger.error(directError);
  logger.fatal(
    Object.assign(new Error(`fatal cookie=session=${marker}`), {
      orderId: "fatal-order-r1",
      DATABASE_URL: `postgres://user:${marker}@db.example.invalid/app`,
    }),
  );
  logger.fatal({ requestId: "fatal-object-r1", secret: marker }, `fatal secret=${marker}`);
  logger.error(
    Object.assign(
      new Error(
        `AWS authentication failed AccessKeyId=${awsAccessKeyId}; SecretAccessKey='${awsSecretAccessKey}'`,
      ),
      {
        requestId: "aws-error-r4",
        region: awsRegion,
        credentials: {
          AccessKeyId: awsAccessKeyId,
          SecretAccessKey: awsSecretAccessKey,
          region: awsRegion,
        },
      },
    ),
  );
  logger.captureError(
    Object.assign(new Error(`capture apiKey=${marker}`), {
      requestId: "capture-error-r1",
    }),
    {
      orderId: "capture-order-r1",
      headers: {
        authorization: `Bearer ${marker}`,
        Cookie: `session=${marker}`,
      },
      payload: { clientSecret: marker, visible: "kept" },
    },
  );

  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(requestPayload, original);
  assert.deepEqual(
    {
      message: nestedError.message,
      requestId: nestedError.requestId,
      headers: nestedError.headers,
    },
    nestedErrorOriginal,
  );
  assert.doesNotMatch(output, new RegExp(marker));
  assert.doesNotMatch(stringifyPrivacySurface(sentryCalls), new RegExp(marker));
  assert.doesNotMatch(output, /SYNTHETIC_AWS_ACCESS_KEY_ID_R4|synthetic_aws_secret_access_key_r4/);
  assert.doesNotMatch(
    stringifyPrivacySurface(sentryCalls),
    /SYNTHETIC_AWS_ACCESS_KEY_ID_R4|synthetic_aws_secret_access_key_r4/,
  );
  assert.equal("pino" in logger, false);

  const entries = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const warningEntry = entries.find((entry) => entry.requestId === "request-r1");
  assert.ok(warningEntry);
  assert.equal(warningEntry.requestId, "request-r1");
  assert.equal((warningEntry.payload as Record<string, unknown>).orderId, "order-r1");
  assert.equal((warningEntry.payload as Record<string, unknown>).keep, "visible");
  assert.equal(
    (
      warningEntry.req as {
        headers: Record<string, unknown>;
      }
    ).headers.Authorization,
    REDACTED_LOG_VALUE,
  );
  assert.equal((warningEntry.payload as Record<string, unknown>).API_SECRET, REDACTED_LOG_VALUE);
  const warningAws = (warningEntry.payload as Record<string, unknown>).aws as Record<
    string,
    unknown
  >;
  assert.equal(warningAws.AccessKeyId, REDACTED_LOG_VALUE);
  assert.equal(warningAws.SecretAccessKey, REDACTED_LOG_VALUE);
  assert.equal(warningAws.region, awsRegion);
  assert.equal((warningEntry.payload as Record<string, unknown>).credentials, REDACTED_LOG_VALUE);
  assert.equal(
    (warningEntry.payload as Record<string, unknown>).connectionString,
    REDACTED_LOG_VALUE,
  );
  assert.ok(entries.some((entry) => entry.msg === "trace token=[Redacted]"));
  assert.ok(entries.some((entry) => entry.msg === "debug"));
  assert.ok(entries.some((entry) => entry.msg === "info"));
  const awsTextEntry = entries.find((entry) => entry.requestId === "aws-text-r4");
  assert.ok(awsTextEntry);
  assert.match(awsTextEntry.msg?.toString() ?? "", /AWS_ACCESS_KEY_ID=\[Redacted\]/);
  assert.match(awsTextEntry.msg?.toString() ?? "", /aws-secret-access-key=\[Redacted\]/i);
  assert.match(awsTextEntry.msg?.toString() ?? "", new RegExp(`region=${awsRegion}`));
  assert.ok(entries.some((entry) => entry.msg?.toString().startsWith("direct error password=")));
  assert.ok(entries.some((entry) => entry.msg?.toString().startsWith("fatal cookie=")));

  const breadcrumbCall = sentryCalls.find(
    (call): call is { kind: "breadcrumb"; breadcrumb: Record<string, unknown> } =>
      typeof call === "object" && call !== null && "kind" in call && call.kind === "breadcrumb",
  );
  assert.ok(breadcrumbCall);
  const breadcrumbData = breadcrumbCall.breadcrumb.data as Record<string, unknown>;
  assert.equal(breadcrumbData.requestId, "request-r1");
  assert.equal((breadcrumbData.payload as Record<string, unknown>).orderId, "order-r1");
  assert.equal((breadcrumbData.payload as Record<string, unknown>).keep, "visible");
  assert.equal(
    (
      breadcrumbData.req as {
        headers: Record<string, unknown>;
      }
    ).headers.Authorization,
    REDACTED_LOG_VALUE,
  );
  assert.equal((breadcrumbData.payload as Record<string, unknown>).API_SECRET, REDACTED_LOG_VALUE);
  const breadcrumbAws = (breadcrumbData.payload as Record<string, unknown>).aws as Record<
    string,
    unknown
  >;
  assert.equal(breadcrumbAws.AccessKeyId, REDACTED_LOG_VALUE);
  assert.equal(breadcrumbAws.SecretAccessKey, REDACTED_LOG_VALUE);
  assert.equal(breadcrumbAws.region, awsRegion);

  const exceptionCalls = sentryCalls.filter(
    (call): call is { kind: "exception"; error: Error; context: Record<string, unknown> } =>
      typeof call === "object" && call !== null && "kind" in call && call.kind === "exception",
  );
  assert.ok(exceptionCalls.length >= 4);
  assert.ok(
    exceptionCalls.some(
      (call) =>
        call.context.extra &&
        (call.context.extra as Record<string, unknown>).orderId === "capture-order-r1",
    ),
  );

  const messageCall = sentryCalls.find(
    (call): call is { kind: "message"; message: string; context: Record<string, unknown> } =>
      typeof call === "object" && call !== null && "kind" in call && call.kind === "message",
  );
  assert.ok(messageCall);
  assert.equal((messageCall.context.extra as Record<string, unknown>).requestId, "fatal-object-r1");
});

test("CMS markdown removes executable HTML and unsafe URL schemes", async () => {
  const html = await renderSanitizedMarkdown(`
<script>alert("xss")</script>
<img src="/safe.png" onerror="alert(1)">
[unsafe](javascript:alert(1))
<a href="javascript:alert(2)">raw unsafe link</a>
<iframe src="https://example.invalid/embed"></iframe>

## Safe heading
`);

  assert.doesNotMatch(html, /<script|onerror|href=["']javascript:/i);
  assert.match(html, /External embed removed for security/);
  assert.match(html, /<h2[^>]*id="safe-heading"[^>]*>/);
  assert.match(html, /scroll-mt-20/);
});

test("health evaluation separates skipped, healthy and failed dependencies", async () => {
  await assert.rejects(() => withTimeout(new Promise(() => {}), 1), /timed out/);

  const failures: string[] = [];
  const result = await evaluateHealthChecks(
    [
      { name: "database", probe: async () => undefined },
      { name: "redis", probe: null },
      {
        name: "mail",
        probe: async () => {
          throw new Error("unavailable");
        },
      },
    ],
    {
      timeoutMs: 100,
      onFailure: (check) => failures.push(check.name),
    },
  );

  assert.equal(result.checks.database.status, "ok");
  assert.equal(result.checks.redis.status, "skipped");
  assert.equal(result.checks.mail.status, "down");
  assert.equal(result.healthy, false);
  assert.deepEqual(failures, ["mail"]);
});

test("Redis configuration remains disabled without the selected provider credentials", () => {
  assert.deepEqual(resolveRedisConfiguration({}), {
    provider: "upstash",
    configured: false,
  });
  assert.deepEqual(
    resolveRedisConfiguration({
      DEFAULT_REDIS_PROVIDER: "ioredis",
      UPSTASH_REDIS_REST_URL: "https://example.invalid",
      UPSTASH_REDIS_REST_TOKEN: "unused",
    }),
    { provider: "ioredis", configured: false },
  );
  assert.deepEqual(
    resolveRedisConfiguration({
      DEFAULT_REDIS_PROVIDER: "ioredis",
      REDIS_URL: "redis://127.0.0.1:6379",
    }),
    { provider: "ioredis", configured: true },
  );
});

test("storage cleanup is a no-op when R2 is not configured", async () => {
  const previousBucket = process.env.R2_BUCKET_NAME;
  delete process.env.R2_BUCKET_NAME;
  try {
    const result = await purgeUserArtifacts(crypto.randomUUID());
    assert.equal(result.deletedObjects, 0);
  } finally {
    if (previousBucket === undefined) delete process.env.R2_BUCKET_NAME;
    else process.env.R2_BUCKET_NAME = previousBucket;
  }
});

test("mail providers report missing configuration without sending", async () => {
  const keys = ["RESEND_API_KEY", "CLOUDFLARE_EMAIL_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];

  try {
    const [{ resendProvider }, { cloudflareProvider }] = await Promise.all([
      import("@/lib/mail/providers/resend"),
      import("@/lib/mail/providers/cloudflare"),
    ]);
    const options = {
      from: "sender@example.invalid",
      to: "recipient@example.invalid",
      subject: "configuration probe",
      text: "not sent",
    };

    const [resendResult, cloudflareResult] = await Promise.all([
      resendProvider.send(options),
      cloudflareProvider.send(options),
    ]);

    assert.equal(resendResult.success, false);
    assert.match(resendResult.error?.message ?? "", /RESEND_API_KEY/);
    assert.equal(cloudflareResult.success, false);
    assert.match(cloudflareResult.error?.message ?? "", /required/);
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
