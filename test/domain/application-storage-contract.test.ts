import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, mock, test } from "node:test";

const appRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);

process.env.R2_BUCKET_NAME = "nexty-test-bucket";
process.env.R2_PUBLIC_URL = "https://r2.example.invalid";
process.env.R2_ACCOUNT_ID = "test-account-id";
process.env.R2_ACCESS_KEY_ID = "test-access-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";

interface S3Object {
  Key: string;
  Size?: number;
  LastModified?: Date;
}

const s3Fixture = {
  sendCalls: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  putInputs: [] as Array<Record<string, unknown>>,
  getInputs: [] as Array<Record<string, unknown>>,
  deleteInputs: [] as Array<Record<string, unknown>>,
  listInputs: [] as Array<Record<string, unknown>>,
  signCalls: [] as Array<{ input: Record<string, unknown>; expiresIn: number }>,
  listPages: [] as Array<{
    Contents?: S3Object[];
    NextContinuationToken?: string;
  }>,
  putError: null as Error | null,
  getError: null as Error | null,
  deleteError: null as Error | null,
  listError: null as Error | null,
};

function makeCommand(kind: string) {
  return class {
    input: Record<string, unknown>;
    commandKind = kind;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  };
}

const PutObjectCommand = makeCommand("PutObjectCommand");
const GetObjectCommand = makeCommand("GetObjectCommand");
const DeleteObjectCommand = makeCommand("DeleteObjectCommand");
const ListObjectsV2Command = makeCommand("ListObjectsV2Command");

mock.module(appRequire.resolve("@aws-sdk/client-s3"), {
  exports: {
    S3Client: class {
      send(command: {
        commandKind: string;
        input: Record<string, unknown>;
      }): Promise<Record<string, unknown>> {
        s3Fixture.sendCalls.push({
          kind: command.commandKind,
          input: command.input,
        });

        if (command.commandKind === "PutObjectCommand" && s3Fixture.putError) {
          const error = s3Fixture.putError;
          s3Fixture.putError = null;
          throw error;
        }
        if (command.commandKind === "GetObjectCommand" && s3Fixture.getError) {
          const error = s3Fixture.getError;
          s3Fixture.getError = null;
          throw error;
        }
        if (command.commandKind === "DeleteObjectCommand" && s3Fixture.deleteError) {
          const error = s3Fixture.deleteError;
          s3Fixture.deleteError = null;
          throw error;
        }
        if (command.commandKind === "ListObjectsV2Command" && s3Fixture.listError) {
          const error = s3Fixture.listError;
          s3Fixture.listError = null;
          throw error;
        }

        if (command.commandKind === "PutObjectCommand") {
          s3Fixture.putInputs.push(command.input);
          return Promise.resolve({});
        }
        if (command.commandKind === "GetObjectCommand") {
          s3Fixture.getInputs.push(command.input);
          return Promise.resolve({});
        }
        if (command.commandKind === "DeleteObjectCommand") {
          s3Fixture.deleteInputs.push(command.input);
          return Promise.resolve({});
        }
        if (command.commandKind === "ListObjectsV2Command") {
          s3Fixture.listInputs.push(command.input);
          const page = s3Fixture.listPages.shift() ?? { Contents: [] };
          return Promise.resolve({
            Contents: page.Contents ?? [],
            NextContinuationToken: page.NextContinuationToken,
            IsTruncated: Boolean(page.NextContinuationToken),
          });
        }
        return Promise.resolve({});
      }
    },
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    _Object: class {},
  },
});

mock.module(appRequire.resolve("@aws-sdk/s3-request-presigner"), {
  exports: {
    getSignedUrl: async (
      _client: unknown,
      command: { input: Record<string, unknown> },
      options: { expiresIn: number },
    ) => {
      s3Fixture.signCalls.push({
        input: command.input,
        expiresIn: options.expiresIn,
      });
      return "https://presigned.example.invalid/signed";
    },
  },
});

let actor: { id: string; role: "user" | "admin" | "superadmin" } | null = null;

mock.module("@/lib/auth/server", {
  exports: {
    getSession: async () =>
      actor ? { user: { id: actor.id, role: actor.role } } : null,
    isAdmin: async () => actor?.role === "admin" || actor?.role === "superadmin",
  },
});

mock.module("@/lib/redis", {
  exports: {
    checkRateLimit: async () => true,
    getClientIPFromHeaders: async () => "127.0.0.1",
    RATE_LIMIT_CONFIGS: {
      anonymousUpload: { maxRequests: 10 },
      anonymousDownload: { maxRequests: 10 },
    },
  },
});

let serverUploadFile: typeof import("@/lib/cloudflare/r2").serverUploadFile;
let deleteFile: typeof import("@/lib/cloudflare/r2").deleteFile;
let listR2Objects: typeof import("@/lib/cloudflare/r2").listR2Objects;
let createPresignedUploadUrl: typeof import("@/lib/cloudflare/r2").createPresignedUploadUrl;
let createPresignedDownloadUrl: typeof import("@/lib/cloudflare/r2").createPresignedDownloadUrl;
let purgeUserArtifacts: typeof import("@/lib/storage/account-purge").purgeUserArtifacts;

let generateAdminPresignedUploadUrl: typeof import("@/actions/r2-resources").generateAdminPresignedUploadUrl;
let generateUserPresignedUploadUrl: typeof import("@/actions/r2-resources").generateUserPresignedUploadUrl;
let generatePublicPresignedUploadUrl: typeof import("@/actions/r2-resources").generatePublicPresignedUploadUrl;
let generateAdminPresignedDownloadUrl: typeof import("@/actions/r2-resources").generateAdminPresignedDownloadUrl;
let generateUserPresignedDownloadUrl: typeof import("@/actions/r2-resources").generateUserPresignedDownloadUrl;
let generatePublicPresignedDownloadUrl: typeof import("@/actions/r2-resources").generatePublicPresignedDownloadUrl;
let listR2Files: typeof import("@/actions/r2-resources").listR2Files;

before(async () => {
  ({
    serverUploadFile,
    deleteFile,
    listR2Objects,
    createPresignedUploadUrl,
    createPresignedDownloadUrl,
  } = await import("@/lib/cloudflare/r2"));
  ({ purgeUserArtifacts } = await import("@/lib/storage/account-purge"));
  ({
    generateAdminPresignedUploadUrl,
    generateUserPresignedUploadUrl,
    generatePublicPresignedUploadUrl,
    generateAdminPresignedDownloadUrl,
    generateUserPresignedDownloadUrl,
    generatePublicPresignedDownloadUrl,
    listR2Files,
  } = await import("@/actions/r2-resources"));
});

function uploadInput(path: string, fileName = "avatar.png", prefix?: string) {
  return { fileName, contentType: "image/png", path, prefix };
}

beforeEach(() => {
  s3Fixture.sendCalls.length = 0;
  s3Fixture.putInputs.length = 0;
  s3Fixture.getInputs.length = 0;
  s3Fixture.deleteInputs.length = 0;
  s3Fixture.listInputs.length = 0;
  s3Fixture.signCalls.length = 0;
  s3Fixture.listPages.length = 0;
  s3Fixture.putError = null;
  s3Fixture.getError = null;
  s3Fixture.deleteError = null;
  s3Fixture.listError = null;
  actor = null;
});

async function withCapturedOutput(fn: () => Promise<void>): Promise<string> {
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  let captured = "";
  process.stdout.write = ((chunk: unknown) => {
    captured += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    captured += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
  return captured;
}

test("presigned upload builds a PutObjectCommand with the exact key/content type/expiry", async () => {
  const result = await createPresignedUploadUrl({
    key: "blog-images/featured.png",
    contentType: "image/png",
    expiresIn: 300,
  });

  assert.equal(result.presignedUrl, "https://presigned.example.invalid/signed");
  assert.equal(result.publicObjectUrl, "https://r2.example.invalid/blog-images/featured.png");
  assert.equal(s3Fixture.signCalls.length, 1);
  assert.deepEqual(s3Fixture.signCalls[0].input, {
    Bucket: "nexty-test-bucket",
    Key: "blog-images/featured.png",
    ContentType: "image/png",
  });
  assert.equal(s3Fixture.signCalls[0].expiresIn, 300);
});

test("presigned download builds a GetObjectCommand with the exact key/expiry", async () => {
  const result = await createPresignedDownloadUrl({
    key: "avatars/user-a/avatar.png",
    expiresIn: 300,
  });

  assert.equal(result, "https://presigned.example.invalid/signed");
  assert.equal(s3Fixture.signCalls.length, 1);
  assert.deepEqual(s3Fixture.signCalls[0].input, {
    Bucket: "nexty-test-bucket",
    Key: "avatars/user-a/avatar.png",
  });
  assert.equal(s3Fixture.signCalls[0].expiresIn, 300);
});

test("serverUploadFile joins path/key, decodes base64 and uploads the buffer", async () => {
  const bufferResult = await serverUploadFile({
    data: Buffer.from("buffer-payload"),
    contentType: "application/octet-stream",
    key: "file.bin",
    path: "avatars/user-a",
  });
  assert.equal(bufferResult.key, "avatars/user-a/file.bin");
  assert.equal(bufferResult.url, "https://r2.example.invalid/avatars/user-a/file.bin");
  assert.deepEqual(s3Fixture.putInputs[0].Body, Buffer.from("buffer-payload"));
  assert.equal(s3Fixture.putInputs[0].Key, "avatars/user-a/file.bin");
  assert.equal(s3Fixture.putInputs[0].ContentType, "application/octet-stream");

  const base64Result = await serverUploadFile({
    data: "data:image/png;base64,aGVsbG8=",
    contentType: "image/png",
    key: "decoded.png",
  });
  assert.equal(base64Result.key, "decoded.png");
  assert.equal(s3Fixture.putInputs[1].Key, "decoded.png");
  assert.equal(Buffer.isBuffer(s3Fixture.putInputs[1].Body), true);
});

test("serverUploadFile reports a stable error and does not leak SDK credentials", async () => {
  const captured = await withCapturedOutput(async () => {
    s3Fixture.putError = new Error(
      "Authorization: Bearer synthetic-credential Cookie: sid=synthetic-secret AccessKeyId=AKIA-SYNTHETIC",
    );
    await assert.rejects(
      () =>
        serverUploadFile({
          data: Buffer.from("payload"),
          contentType: "text/plain",
          key: "leak.txt",
        }),
      /Failed to upload file to R2/,
    );
  });

  assert.doesNotMatch(captured, /synthetic-credential|synthetic-secret|AKIA-SYNTHETIC/);
});

test("deleteFile strips a leading slash and sends a DeleteObjectCommand", async () => {
  await deleteFile("/avatars/user-a/old.png");
  assert.equal(s3Fixture.deleteInputs.length, 1);
  assert.equal(s3Fixture.deleteInputs[0].Key, "avatars/user-a/old.png");
});

test("deleteFile reports a stable error without leaking SDK details", async () => {
  const captured = await withCapturedOutput(async () => {
    s3Fixture.deleteError = new Error("Authorization: Bearer synthetic-credential");
    await assert.rejects(() => deleteFile("avatars/user-a/old.png"), /Failed to delete file from R2/);
  });
  assert.doesNotMatch(captured, /synthetic-credential/);
});

test("listR2Objects maps objects and forwards prefix/pagination and error stays stable", async () => {
  s3Fixture.listPages.push({
    Contents: [
      { Key: "blog-images/a.png", Size: 10, LastModified: new Date(0) },
      { Key: "blog-images/b.png", Size: 20 },
    ],
    NextContinuationToken: "next-token",
  });

  const result = await listR2Objects({
    prefix: "blog-images/",
    pageSize: 100,
    continuationToken: "prev-token",
  });

  assert.equal(result.error, undefined);
  assert.equal(result.objects.length, 2);
  assert.equal(result.objects[0].key, "blog-images/a.png");
  assert.equal(result.objects[0].url, "https://r2.example.invalid/blog-images/a.png");
  assert.equal(result.nextContinuationToken, "next-token");
  assert.deepEqual(s3Fixture.listInputs[0], {
    Bucket: "nexty-test-bucket",
    Prefix: "blog-images/",
    MaxKeys: 100,
    ContinuationToken: "prev-token",
  });
});

test("listR2Objects returns a stable error when the SDK transport fails", async () => {
  const captured = await withCapturedOutput(async () => {
    s3Fixture.listError = new Error("Authorization: Bearer synthetic-credential");
    const result = await listR2Objects({ prefix: "blog-images/" });
    assert.equal(result.error, "Failed to list objects from R2.");
    assert.deepEqual(result.objects, []);
  });
  assert.doesNotMatch(captured, /synthetic-credential/);
});

test("purgeUserArtifacts deletes every page of only the target user prefix", async () => {
  s3Fixture.listPages.push(
    {
      Contents: [
        { Key: "avatars/user-a/1.png" },
        { Key: "avatars/user-a/2.png" },
      ],
      NextContinuationToken: "page-2",
    },
    {
      Contents: [{ Key: "avatars/user-a/3.png" }],
    },
  );

  const result = await purgeUserArtifacts("user-a");
  assert.equal(result.deletedObjects, 3);
  assert.deepEqual(
    s3Fixture.deleteInputs.map((input) => input.Key),
    ["avatars/user-a/1.png", "avatars/user-a/2.png", "avatars/user-a/3.png"],
  );
  assert.deepEqual(
    s3Fixture.listInputs.map((input) => input.Prefix),
    ["avatars/user-a/", "avatars/user-a/"],
  );

  const secondPass = await purgeUserArtifacts("user-a");
  assert.equal(secondPass.deletedObjects, 0);
});

test("purgeUserArtifacts is a no-op with zero SDK calls when R2 is unconfigured", async () => {
  const previous = process.env.R2_BUCKET_NAME;
  delete process.env.R2_BUCKET_NAME;
  try {
    const result = await purgeUserArtifacts("user-a");
    assert.equal(result.deletedObjects, 0);
    assert.equal(s3Fixture.sendCalls.length, 0);
  } finally {
    process.env.R2_BUCKET_NAME = previous;
  }
});

test("purgeUserArtifacts throws on list failure and does not report success", async () => {
  s3Fixture.listError = new Error("list failed");
  await assert.rejects(
    () => purgeUserArtifacts("user-a"),
    /Failed to list user artifacts/,
  );
  assert.equal(s3Fixture.deleteInputs.length, 0);
});

test("purgeUserArtifacts throws on delete failure and does not report success", async () => {
  s3Fixture.listPages.push({ Contents: [{ Key: "avatars/user-a/1.png" }] });
  s3Fixture.deleteError = new Error("delete failed");
  await assert.rejects(
    () => purgeUserArtifacts("user-a"),
    /Failed to delete file from R2/,
  );
});

test("user presigned upload is allowed only under the caller's own avatar prefix", async () => {
  actor = { id: "user-a", role: "user" };

  const allowed = await generateUserPresignedUploadUrl(
    uploadInput("avatars/user-a"),
  );
  assert.equal(allowed.success, true);
  assert.equal(s3Fixture.signCalls.length, 1);
  assert.match(allowed.data!.key, /^avatars\/user-a\//);

  const beforeSignCalls = s3Fixture.signCalls.length;
  const crossOwner = await generateUserPresignedUploadUrl(
    uploadInput("avatars/user-b"),
  );
  assert.equal(crossOwner.success, false);
  assert.equal(crossOwner.error, "Access denied.");
  assert.equal(s3Fixture.signCalls.length, beforeSignCalls);
});

test("user presigned download is allowed only for own avatars and public material", async () => {
  actor = { id: "user-a", role: "user" };

  const own = await generateUserPresignedDownloadUrl("avatars/user-a/avatar.png");
  assert.equal(own.success, true);

  const publicAsset = await generateUserPresignedDownloadUrl("blog-images/a.png");
  assert.equal(publicAsset.success, true);

  const beforeSignCalls = s3Fixture.signCalls.length;
  const crossOwner = await generateUserPresignedDownloadUrl("avatars/user-b/private.png");
  assert.equal(crossOwner.success, false);
  assert.equal(crossOwner.error, "Access denied.");
  assert.equal(s3Fixture.signCalls.length, beforeSignCalls);
});

test("public presigned upload is allowed only under the anonymous scratch prefix", async () => {
  actor = null;

  const allowed = await generatePublicPresignedUploadUrl(
    uploadInput("public-uploads"),
  );
  assert.equal(allowed.success, true);
  assert.equal(s3Fixture.signCalls.length, 1);

  const beforeSignCalls = s3Fixture.signCalls.length;
  const forbidden = await generatePublicPresignedUploadUrl(
    uploadInput("avatars/user-a"),
  );
  assert.equal(forbidden.success, false);
  assert.equal(s3Fixture.signCalls.length, beforeSignCalls);
});

test("public presigned download is allowed only for public read prefixes", async () => {
  actor = null;

  const allowed = await generatePublicPresignedDownloadUrl("glossary-images/a.png");
  assert.equal(allowed.success, true);

  const beforeSignCalls = s3Fixture.signCalls.length;
  const forbidden = await generatePublicPresignedDownloadUrl("avatars/user-a/a.png");
  assert.equal(forbidden.success, false);
  assert.equal(s3Fixture.signCalls.length, beforeSignCalls);
});

test("admin presigned upload/download remain available for CMS paths", async () => {
  actor = { id: "admin", role: "admin" };

  const upload = await generateAdminPresignedUploadUrl(
    uploadInput("blog-images"),
  );
  assert.equal(upload.success, true);

  const download = await generateAdminPresignedDownloadUrl("admin-uploaded-images/a.png");
  assert.equal(download.success, true);
  assert.equal(s3Fixture.signCalls.length, 2);
});

test("path traversal and prefix-injecting inputs are rejected without signing", async () => {
  actor = { id: "user-a", role: "user" };

  const malicious = [
    uploadInput("avatars/user-a/../user-b"),
    uploadInput("/avatars/user-a"),
    uploadInput("avatars//user-a"),
    uploadInput("avatars\\user-a"),
    uploadInput("avatars/user-a", "avatar.png", "../evil"),
    uploadInput("avatars/user-a", "a/b.png"),
    uploadInput("avatars/user-a", "%2e%2e%2fevil.png"),
  ];

  for (const input of malicious) {
    const beforeSignCalls = s3Fixture.signCalls.length;
    const result = await generateUserPresignedUploadUrl(input);
    assert.equal(result.success, false);
    assert.equal(s3Fixture.signCalls.length, beforeSignCalls);
  }
});

test("prefix matching is full-segment, so user-a never matches user-aB", async () => {
  actor = { id: "user-a", role: "user" };
  const beforeSignCalls = s3Fixture.signCalls.length;

  const upload = await generateUserPresignedUploadUrl(
    uploadInput("avatars/user-aB"),
  );
  assert.equal(upload.success, false);

  const download = await generateUserPresignedDownloadUrl("avatars/user-aB/avatar.png");
  assert.equal(download.success, false);
  assert.equal(s3Fixture.signCalls.length, beforeSignCalls);
});

test("admin list error exit stays stable and never reflects SDK credentials", async () => {
  actor = { id: "admin", role: "admin" };

  const captured = await withCapturedOutput(async () => {
    s3Fixture.listError = new Error(
      "Authorization: Bearer synthetic-credential Cookie: sid=synthetic-secret",
    );
    const result = await listR2Files({ categoryPrefix: "blog-images/" });
    assert.equal(result.success, false);
    assert.equal(result.error, "Failed to list objects from R2.");
  });

  assert.doesNotMatch(captured, /synthetic-credential|synthetic-secret/);
});
