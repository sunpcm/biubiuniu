import assert from "node:assert/strict";
import { findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";
import { before, beforeEach, mock, test } from "node:test";
import type { SendEmailOptions } from "@/lib/mail";
import * as React from "react";

const appPackageUrl = (specifier: string) =>
  pathToFileURL(
    findPackageJSON(
      specifier,
      new URL("../../apps/web/src/lib/mail/index.ts", import.meta.url),
    ),
  );
const appModuleUrl = (specifier: string, relativePath: string) =>
  new URL(relativePath, appPackageUrl(specifier)).href;

process.env.RESEND_API_KEY = "resend-test-key";
process.env.CLOUDFLARE_EMAIL_API_TOKEN = "cloudflare-test-token";
process.env.CLOUDFLARE_ACCOUNT_ID = "cloudflare-test-account";
delete process.env.DEFAULT_EMAIL_PROVIDER;

interface ResendSendCall {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  headers?: Record<string, string>;
  attachments?: unknown[];
}

interface CloudflareSendCall {
  to: string | string[];
  from: string | { address: string; name: string };
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string | { address: string; name: string };
  cc?: string | string[];
  bcc?: string | string[];
  headers?: Record<string, string>;
  attachments?: unknown[];
}

const resendFixture = {
  apiKey: null as string | null,
  sendCalls: [] as ResendSendCall[],
  behaviors: [] as Array<
    | { kind: "ok"; id: string }
    | { kind: "error"; message: string; statusCode: number }
    | null
  >,
  contactsCreated: [] as string[],
  contactsRemoved: [] as string[],
  contactError: null as Error | null,
};

const cloudflareFixture = {
  apiToken: null as string | null,
  sendCalls: [] as CloudflareSendCall[],
  behaviors: [] as Array<
    | { kind: "ok"; result: Record<string, unknown> }
    | { kind: "throw"; message: string; status: number }
    | null
  >,
};

mock.module(appModuleUrl("server-only", "./index.js"), { exports: {} });

mock.module(appModuleUrl("resend", "./dist/index.mjs"), {
  exports: {
    Resend: class {
      emails: {
        send: (payload: ResendSendCall) => Promise<{
          data: { id: string } | null;
          error: { message: string; statusCode?: number } | null;
        }>;
      };
      contacts: {
        create: (input: { email: string }) => Promise<void>;
        remove: (input: { email: string }) => Promise<void>;
      };

      constructor(apiKey: string) {
        resendFixture.apiKey = apiKey;
        this.emails = {
          send: async (payload) => {
            resendFixture.sendCalls.push(payload);
            const behavior = resendFixture.behaviors.shift();
            if (behavior && behavior.kind === "error") {
              return {
                data: null,
                error: {
                  message: behavior.message,
                  statusCode: behavior.statusCode,
                },
              };
            }
            return {
              data: { id: behavior && behavior.kind === "ok" ? behavior.id : "msg-resend" },
              error: null,
            };
          },
        };
        this.contacts = {
          create: async (input) => {
            if (resendFixture.contactError) throw resendFixture.contactError;
            resendFixture.contactsCreated.push(input.email);
          },
          remove: async (input) => {
            resendFixture.contactsRemoved.push(input.email);
          },
        };
      }
    },
  },
});

mock.module(appModuleUrl("cloudflare", "./index.mjs"), {
  exports: {
    default: class {
      emailSending: {
        send: (payload: CloudflareSendCall) => Promise<Record<string, unknown>>;
      };

      constructor(options: { apiToken: string }) {
        cloudflareFixture.apiToken = options.apiToken;
        this.emailSending = {
          send: async (payload) => {
            cloudflareFixture.sendCalls.push(payload);
            const behavior = cloudflareFixture.behaviors.shift();
            if (behavior && behavior.kind === "throw") {
              throw Object.assign(new Error(behavior.message), {
                status: behavior.status,
              });
            }
            return behavior && behavior.kind === "ok"
              ? behavior.result
              : { message_id: "cf-msg" };
          },
        };
      }
    },
  },
});

mock.module("@/lib/redis", {
  exports: {
    redis: null,
  },
});

let getDefaultEmailProvider: typeof import("@/lib/mail").getDefaultEmailProvider;
let sendEmail: typeof import("@/lib/mail").sendEmail;
let htmlToPlainText: typeof import("@/lib/mail/render").htmlToPlainText;
let renderEmailToHtml: typeof import("@/lib/mail/render").renderEmailToHtml;
let resendProvider: typeof import("@/lib/mail/providers/resend").resendProvider;
let cloudflareProvider: typeof import("@/lib/mail/providers/cloudflare").cloudflareProvider;
let MagicLinkEmail: typeof import("@/emails/magic-link-email").MagicLinkEmail;

before(async () => {
  ({ getDefaultEmailProvider, sendEmail } = await import("@/lib/mail"));
  ({ htmlToPlainText, renderEmailToHtml } = await import("@/lib/mail/render"));
  ({ resendProvider } = await import("@/lib/mail/providers/resend"));
  ({ cloudflareProvider } = await import("@/lib/mail/providers/cloudflare"));
  ({ MagicLinkEmail } = await import("@/emails/magic-link-email"));
});

function baseOptions(overrides: Partial<SendEmailOptions> = {}): SendEmailOptions {
  return {
    from: "sender@example.invalid",
    to: "recipient@example.invalid",
    subject: "Contract test",
    text: "plain fallback",
    ...overrides,
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  resendFixture.sendCalls.length = 0;
  resendFixture.behaviors.length = 0;
  resendFixture.contactsCreated.length = 0;
  resendFixture.contactsRemoved.length = 0;
  resendFixture.contactError = null;
  cloudflareFixture.sendCalls.length = 0;
  cloudflareFixture.behaviors.length = 0;
});

test("default provider follows DEFAULT_EMAIL_PROVIDER and falls back to resend", () => {
  delete process.env.DEFAULT_EMAIL_PROVIDER;
  assert.equal(getDefaultEmailProvider(), "resend");

  process.env.DEFAULT_EMAIL_PROVIDER = "cloudflare";
  assert.equal(getDefaultEmailProvider(), "cloudflare");

  process.env.DEFAULT_EMAIL_PROVIDER = "unknown";
  assert.equal(getDefaultEmailProvider(), "resend");
  delete process.env.DEFAULT_EMAIL_PROVIDER;
});

test("sendEmail renders a real React template to html and plain text", async () => {
  const url = "https://example.invalid/magic?token=magic-token-synthetic";
  const expectedHtml = await renderEmailToHtml(
    React.createElement(MagicLinkEmail, { url }),
  );
  const result = await sendEmail(
    baseOptions({
      react: MagicLinkEmail,
      reactProps: { url },
      text: undefined,
    }),
    "resend",
  );

  assert.equal(result.success, true);
  assert.equal(resendFixture.sendCalls.length, 1);
  const payload = resendFixture.sendCalls[0];
  assert.match(payload.html ?? "", /<!DOCTYPE html/i);
  assert.match(payload.html ?? "", /Sign In/);
  assert.match(payload.html ?? "", /example\.invalid\/magic/);
  assert.equal(payload.html, expectedHtml);
  assert.ok(payload.text);
  assert.doesNotMatch(payload.text ?? "", /</);
  assert.equal(payload.text, htmlToPlainText(expectedHtml));
  assert.match(payload.text ?? "", /Sign In to /);
  assert.doesNotMatch(payload.text ?? "", /example\.invalid\/magic/);
});

test("htmlToPlainText strips tags and collapses whitespace", () => {
  const text = htmlToPlainText(
    "<style>.x{color:red}</style><h1>Hi</h1><p>Hello   world</p>",
  );
  assert.doesNotMatch(text, /<style|<h1|<p>/);
  assert.doesNotMatch(text, /\.x\{/);
  assert.match(text, /Hello world/);
});

test("renderEmailToHtml adds a doctype without duplicating an existing one", async () => {
  const html = await renderEmailToHtml(React.createElement("div", null, "Hello"));
  assert.match(html, /^<!DOCTYPE html/i);
  assert.match(html, /<div>Hello<\/div>/);
});

test("resend provider normalizes addresses and passes every recipient/attachment field", async () => {
  const attachmentBytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const result = await resendProvider.send(
    baseOptions({
      from: { email: "sender@example.invalid", name: "Sender Name" },
      to: ["one@example.invalid", { email: "two@example.invalid", name: "Two" }],
      replyTo: { email: "reply@example.invalid", name: "Reply" },
      cc: ["cc@example.invalid"],
      bcc: ["bcc@example.invalid"],
      headers: { "X-Marker": "synthetic" },
      attachments: [
        { content: "plain-content", filename: "a.txt", type: "text/plain" },
        {
          content: attachmentBytes,
          filename: "b.bin",
          type: "application/octet-stream",
        },
      ],
    }),
  );

  assert.equal(result.success, true);
  assert.equal(resendFixture.apiKey, process.env.RESEND_API_KEY);
  assert.equal(resendFixture.sendCalls.length, 1);
  const payload = resendFixture.sendCalls[0];
  assert.equal(payload.from, "Sender Name <sender@example.invalid>");
  assert.deepEqual(payload.to, ["one@example.invalid", { email: "two@example.invalid", name: "Two" }]);
  assert.equal(payload.replyTo, "Reply <reply@example.invalid>");
  assert.deepEqual(payload.cc, ["cc@example.invalid"]);
  assert.deepEqual(payload.bcc, ["bcc@example.invalid"]);
  assert.deepEqual(payload.headers, { "X-Marker": "synthetic" });
  assert.deepEqual(payload.attachments, [
    { filename: "a.txt", content: "plain-content", contentType: "text/plain" },
    {
      filename: "b.bin",
      content: "AQIDBA==",
      contentType: "application/octet-stream",
    },
  ]);
});

test("cloudflare provider maps REST fields and attachment dispositions", async () => {
  cloudflareFixture.behaviors.push({
    kind: "ok",
    result: {
      message_id: "cf-msg",
      delivered: ["one@example.invalid"],
      queued: [],
      permanent_bounces: [],
    },
  });

  const result = await cloudflareProvider.send(
    baseOptions({
      from: { email: "sender@example.invalid", name: "Sender Name" },
      to: "recipient@example.invalid",
      replyTo: { email: "reply@example.invalid", name: "Reply" },
      attachments: [
        {
          content: "inline-content",
          filename: "inline.png",
          type: "image/png",
          disposition: "inline",
          contentId: "cid-inline",
        },
        {
          content: "attach-content",
          filename: "file.txt",
          type: "text/plain",
          disposition: "attachment",
        },
      ],
    }),
  );

  assert.equal(result.success, true);
  assert.equal(cloudflareFixture.apiToken, process.env.CLOUDFLARE_EMAIL_API_TOKEN);
  assert.equal(cloudflareFixture.sendCalls.length, 1);
  const payload = cloudflareFixture.sendCalls[0];
  assert.deepEqual(payload.from, { address: "sender@example.invalid", name: "Sender Name" });
  assert.equal(payload.to, "recipient@example.invalid");
  assert.deepEqual(payload.reply_to, { address: "reply@example.invalid", name: "Reply" });
  assert.deepEqual(payload.attachments, [
    {
      content: "inline-content",
      filename: "inline.png",
      type: "image/png",
      disposition: "inline",
      content_id: "cid-inline",
    },
    {
      content: "attach-content",
      filename: "file.txt",
      type: "text/plain",
      disposition: "attachment",
    },
  ]);
});

test("resend retries once on a 429 and then succeeds", { timeout: 5000 }, async () => {
  resendFixture.behaviors.push(
    { kind: "error", message: "rate limited", statusCode: 429 },
    { kind: "ok", id: "msg-after-retry" },
  );

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const resultPromise = resendProvider.send(baseOptions());
    await flushAsyncWork();
    mock.timers.tick(2000);
    const result = await resultPromise;
    assert.equal(result.success, true);
    assert.equal(result.messageId, "msg-after-retry");
  } finally {
    mock.timers.reset();
  }
  assert.equal(resendFixture.sendCalls.length, 2);
});

test("resend does not retry an explicit 4xx", { timeout: 5000 }, async () => {
  resendFixture.behaviors.push({ kind: "error", message: "bad request", statusCode: 400 });

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await assert.rejects(() => resendProvider.send(baseOptions()), /bad request/);
  } finally {
    mock.timers.reset();
  }
  assert.equal(resendFixture.sendCalls.length, 1);
});

test("persistent retryable failures stop after one retry", { timeout: 5000 }, async () => {
  resendFixture.behaviors.push(
    { kind: "error", message: "downstream", statusCode: 500 },
    { kind: "error", message: "downstream", statusCode: 500 },
  );

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const resultPromise = resendProvider.send(baseOptions());
    await flushAsyncWork();
    mock.timers.tick(2000);
    await assert.rejects(resultPromise, /downstream/);
  } finally {
    mock.timers.reset();
  }
  assert.equal(resendFixture.sendCalls.length, 2);
});

test("cloudflare retries once on a 429 and then succeeds", { timeout: 5000 }, async () => {
  cloudflareFixture.behaviors.push(
    { kind: "throw", message: "rate limited", status: 429 },
    { kind: "ok", result: { message_id: "cf-after-retry" } },
  );

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const resultPromise = cloudflareProvider.send(baseOptions());
    await flushAsyncWork();
    mock.timers.tick(2000);
    const result = await resultPromise;
    assert.equal(result.success, true);
    assert.equal(result.messageId, "cf-after-retry");
  } finally {
    mock.timers.reset();
  }
  assert.equal(cloudflareFixture.sendCalls.length, 2);
});

test("explicit provider selection does not touch the unselected provider", async () => {
  await sendEmail(baseOptions(), "resend");
  assert.equal(resendFixture.sendCalls.length, 1);
  assert.equal(cloudflareFixture.sendCalls.length, 0);

  cloudflareFixture.behaviors.push({ kind: "ok", result: { message_id: "cf" } });
  await sendEmail(baseOptions(), "cloudflare");
  assert.equal(cloudflareFixture.sendCalls.length, 1);
  assert.equal(resendFixture.sendCalls.length, 1);
});

test("contact write failure does not break a successful send", async () => {
  resendFixture.contactError = new Error("contacts unavailable");
  const result = await sendEmail(
    baseOptions({
      to: "recipient@example.invalid",
      addToContacts: true,
    }),
    "resend",
  );

  assert.equal(result.success, true);
  assert.equal(resendFixture.sendCalls.length, 1);
  assert.deepEqual(resendFixture.contactsCreated, []);
});

test("unknown provider returns a failure without invoking any SDK", async () => {
  const result = await sendEmail(baseOptions(), "unknown" as never);
  assert.equal(result.success, false);
  assert.match(result.error?.message ?? "", /Unknown email provider/);
  assert.equal(resendFixture.sendCalls.length, 0);
  assert.equal(cloudflareFixture.sendCalls.length, 0);
});
