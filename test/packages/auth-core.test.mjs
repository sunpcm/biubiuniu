import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ADMIN_DISABLED_PATHS,
  CLIENT_IP_HEADERS,
  UNKNOWN_IP,
  adminAccessRoles,
  createGrantSignupRewards,
  isAdminUserRole,
  isBanActive,
  isSuperAdminUserRole,
  pickClientIP,
} from "../../packages/auth/dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const authPkg = join(repoRoot, "packages", "auth");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("manifest publishes explicit ESM root and React-only client subpath", async () => {
  const pkg = await readJson(join(authPkg, "package.json"));
  assert.equal(pkg.name, "@sunpcm/niu-auth");
  assert.equal(pkg.version, "0.1.0-next.0");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.main, "./dist/index.js");
  assert.deepEqual(pkg.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  });
  assert.deepEqual(pkg.exports["./client"], {
    types: "./dist/client.d.ts",
    import: "./dist/client.js",
  });
  assert.ok(pkg.files.includes("dist"));
});

test("core root carries no Next/React/Drizzle/PostgreSQL import", async () => {
  const coreFiles = [
    "index.js",
    "factory.js",
    "guards.js",
    "organization.js",
    "signup-rewards.js",
    "ban-policy.js",
    "permissions.js",
    "admin-access.js",
    "policy-store.js",
    "types.js",
  ];
  const forbidden =
    /(?:from\s+|import\s+)["'](?:next|react|react-dom|drizzle-orm|postgres|server-only)(?:["'/]|$)/;
  for (const file of coreFiles) {
    const src = await readFile(join(authPkg, "dist", file), "utf8");
    assert.doesNotMatch(src, forbidden, `${file} must not import framework/SQL`);
  }
});

test("ban policy: permanent, active, and expired", () => {
  assert.equal(isBanActive(true, null), true);
  assert.equal(isBanActive(true, new Date(Date.now() + 60_000)), true);
  assert.equal(isBanActive(true, new Date(Date.now() - 60_000)), false);
  assert.equal(isBanActive(false, null), false);
  assert.equal(isBanActive(undefined, null), false);
});

test("role predicates match the three-role model", () => {
  assert.equal(isAdminUserRole("admin"), true);
  assert.equal(isAdminUserRole("superadmin"), true);
  assert.equal(isAdminUserRole("user"), false);
  assert.equal(isSuperAdminUserRole("superadmin"), true);
  assert.equal(isSuperAdminUserRole("admin"), false);
});

test("admin access: plain admin cannot set-role/create/delete, superadmin can", () => {
  for (const action of ["set-role", "create", "delete", "set-password", "update"]) {
    assert.equal(
      adminAccessRoles.admin.authorize({ user: [action] }).success,
      false,
      `admin must not hold user:${action}`,
    );
    assert.equal(
      adminAccessRoles.superadmin.authorize({ user: [action] }).success,
      true,
      `superadmin must hold user:${action}`,
    );
  }
  assert.equal(adminAccessRoles.admin.authorize({ user: ["ban"] }).success, true);
  assert.equal(adminAccessRoles.superadmin.authorize({ user: ["impersonate"] }).success, true);
  assert.equal(adminAccessRoles.admin.authorize({ user: ["impersonate"] }).success, false);
});

test("disabled paths cover the built-in admin mutations", () => {
  for (const path of [
    "/admin/set-role",
    "/admin/create-user",
    "/admin/remove-user",
    "/admin/set-user-password",
    "/admin/update-user",
    "/admin/revoke-user-sessions",
  ]) {
    assert.ok(ADMIN_DISABLED_PATHS.includes(path), `${path} should be disabled`);
  }
});

test("client IP helpers use the shared header order", () => {
  assert.equal(
    pickClientIP((name) => (name === "cf-connecting-ip" ? "1.2.3.4, 5.6.7.8" : null)),
    "1.2.3.4",
  );
  assert.equal(pickClientIP(() => null), UNKNOWN_IP);
  assert.deepEqual(CLIENT_IP_HEADERS, [
    "cf-connecting-ip",
    "x-real-ip",
    "x-forwarded-for",
  ]);
});

test("signup rewards: missing signal and gate failure let the gift through", async () => {
  const granted = [];
  const grant = createGrantSignupRewards({
    redis: null,
    signupBonusCredits: 30,
    decideSignupGift: async () => ({ grant: true }),
    grantWelcomeCredits: async (params) => {
      granted.push(params);
    },
    notifySignupGiftWithheld: async () => {},
    logger: { warn() {}, error() {} },
  });

  await grant({ userId: "u1", email: "a@example.invalid", ip: undefined, deviceHash: undefined });
  assert.equal(granted.length, 1);
  assert.equal(granted[0].amount, 30);

  const failing = createGrantSignupRewards({
    redis: null,
    signupBonusCredits: 30,
    decideSignupGift: async () => {
      throw new Error("redis down");
    },
    grantWelcomeCredits: async (params) => granted.push(params),
    notifySignupGiftWithheld: async () => {},
    logger: { warn() {}, error() {} },
  });
  await failing({ userId: "u2", email: "b@example.invalid" });
  assert.equal(granted.length, 2, "a gate failure must still grant the welcome gift");
});

test("signup rewards: a withheld gift does not grant credits and notifies ops", async () => {
  let granted = 0;
  const withheld = [];
  const grant = createGrantSignupRewards({
    redis: null,
    signupBonusCredits: 30,
    decideSignupGift: async () => ({ grant: false, reason: "ip_cap", ip: "1.2.3.4", ipCount: 4 }),
    grantWelcomeCredits: async () => {
      granted += 1;
    },
    notifySignupGiftWithheld: async (params) => withheld.push(params),
    logger: { warn() {}, error() {} },
  });
  await grant({ userId: "u3", email: "c@example.invalid", ip: "1.2.3.4" });
  assert.equal(granted, 0);
  assert.equal(withheld.length, 1);
  assert.equal(withheld[0].reason, "ip_cap");
});

test("capability validation rejects missing config clearly", async () => {
  const { createAuth } = await import("../../packages/auth/dist/index.js");
  const base = () => ({
    site: { name: "test", url: "http://test.local" },
    adapter: {},
    policyStore: {},
    secret: "test-secret",
    billing: null,
    mail: {
      sendMagicLink: async () => {},
      sendVerificationOtp: async () => {},
      sendWelcome: async () => {},
      sendOrganizationInvitation: async () => {},
    },
    reward: async () => {},
    signupGuard: { isEmailBlocked: async () => false, isIpBlocked: async () => false },
    redis: null,
    requestSignal: { getClientIP: async () => UNKNOWN_IP, getCookie: async () => undefined },
    capabilities: {},
  });

  assert.throws(
    () => createAuth({ ...base(), capabilities: { oneTap: true } }),
    /google/i,
  );
  assert.throws(
    () => createAuth({ ...base(), capabilities: { captcha: {} } }),
    /secretKey/i,
  );
  assert.throws(
    () =>
      createAuth({
        ...base(),
        capabilities: { social: { github: { clientId: "", clientSecret: "s" } } },
      }),
    /github/i,
  );
  assert.throws(
    () => createAuth({ ...base(), capabilities: { organization: true } }),
    /billing/i,
  );
  assert.throws(
    () => createAuth({ ...base(), capabilities: { billing: true } }),
    /billing/i,
  );
  assert.throws(
    () =>
      createAuth({
        ...base(),
        billing: {
          getOrgSeatCap: async () => ({ seats: 1, hasTeamSubscription: false }),
          hasLivePersonalSubscription: async () => false,
          getOrganizationDeletionBlockers: async () => ({
            hasTeamSubscription: false,
            hasBillingHistory: false,
          }),
        },
        mail: { sendWelcome: async () => {} },
        capabilities: { organization: true },
      }),
    /sendOrganizationInvitation/i,
  );
  assert.throws(
    () =>
      createAuth({
        ...base(),
        mail: { sendWelcome: async () => {} },
        capabilities: { magicLink: true },
      }),
    /sendMagicLink/i,
  );
  assert.throws(
    () =>
      createAuth({
        ...base(),
        mail: { sendMagicLink: async () => {} },
        capabilities: { emailOTP: true },
      }),
    /sendVerificationOtp/i,
  );
});

test("createAuth requires an explicit non-empty secret", async () => {
  const { createAuth } = await import("../../packages/auth/dist/index.js");
  const base = () => ({
    site: { name: "test", url: "http://test.local" },
    adapter: {},
    policyStore: {},
    secret: "",
    billing: null,
    mail: {},
    signupGuard: { isEmailBlocked: async () => false, isIpBlocked: async () => false },
    redis: null,
    requestSignal: { getClientIP: async () => UNKNOWN_IP, getCookie: async () => undefined },
    capabilities: {},
  });

  assert.throws(() => createAuth({ ...base(), secret: "" }), /secret/i);
  assert.throws(() => createAuth({ ...base(), secret: "   " }), /secret/i);
});

test("organization plugin rejects a missing invitation mail port", async () => {
  const { createOrganizationPlugin } = await import(
    "../../packages/auth/dist/index.js"
  );

  assert.throws(
    () =>
      createOrganizationPlugin({
        policyStore: {},
        billing: {
          getOrgSeatCap: async () => ({ seats: 1, hasTeamSubscription: false }),
        },
        mail: {},
        site: { name: "test", url: "http://test.local" },
      }),
    /sendOrganizationInvitation/i,
  );
});
