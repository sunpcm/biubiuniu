/**
 * E1 admin credit ledger query-key convergence.
 *
 * The helper is checked and loaded inside each behavioral test so the initial
 * RED reports a concrete missing-contract failure instead of a module-load
 * failure. The cache test uses the installed web QueryClient and QueryObserver
 * directly; it does not render React or touch a database.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

type QueryKey = readonly unknown[];

interface AdminCreditQueryKeys {
  globalTransactions: QueryKey;
  userTransactions(userId: string): QueryKey;
}

interface QueryStateLike {
  data: unknown;
  isInvalidated: boolean;
}

interface QueryClientLike {
  prefetchQuery(options: { queryKey: QueryKey; queryFn: () => Promise<unknown> }): Promise<void>;
  getQueryData(queryKey: QueryKey): unknown;
  getQueryState(queryKey: QueryKey): QueryStateLike | undefined;
  invalidateQueries(options: {
    queryKey: QueryKey;
    exact: boolean;
    refetchType: "active";
  }): Promise<void>;
  clear(): void;
}

interface QueryObserverLike {
  subscribe(listener: (result: unknown) => void): () => void;
  destroy(): void;
}

interface QueryObserverConstructor {
  new (
    client: QueryClientLike,
    options: {
      queryKey: QueryKey;
      queryFn: () => Promise<unknown>;
      staleTime: number;
    },
  ): QueryObserverLike;
}

const appRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const reactQuery = appRequire("@tanstack/react-query") as {
  QueryClient: new (options: unknown) => QueryClientLike;
  QueryObserver: QueryObserverConstructor;
};

const helperUrl = new URL("../../apps/web/src/lib/admin-credit-query-keys.ts", import.meta.url);

function readAppSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../apps/web/src/${relativePath}`, import.meta.url)),
    "utf8",
  );
}

async function loadAdminCreditQueryKeys(): Promise<AdminCreditQueryKeys> {
  assert.equal(
    existsSync(helperUrl),
    true,
    `Expected shared admin credit query-key helper at ${fileURLToPath(helperUrl)}`,
  );

  const helperModule = (await import(helperUrl.href)) as {
    adminCreditQueryKeys?: Partial<AdminCreditQueryKeys>;
  };

  assert.equal(
    typeof helperModule.adminCreditQueryKeys,
    "object",
    "Expected the helper to export adminCreditQueryKeys",
  );
  assert.equal(
    Array.isArray(helperModule.adminCreditQueryKeys?.globalTransactions),
    true,
    "Expected adminCreditQueryKeys.globalTransactions to be a query-key array",
  );
  assert.equal(
    typeof helperModule.adminCreditQueryKeys?.userTransactions,
    "function",
    "Expected adminCreditQueryKeys.userTransactions to be a key factory",
  );

  return helperModule.adminCreditQueryKeys as AdminCreditQueryKeys;
}

function trackedFetcher(
  queryKey: QueryKey,
  fetchCounts: Map<string, number>,
): () => Promise<unknown> {
  const hash = JSON.stringify(queryKey);

  return async () => {
    const nextCount = (fetchCounts.get(hash) ?? 0) + 1;
    fetchCounts.set(hash, nextCount);
    return { hash, revision: nextCount };
  };
}

function fetchCount(queryKey: QueryKey, fetchCounts: Map<string, number>): number {
  return fetchCounts.get(JSON.stringify(queryKey)) ?? 0;
}

test("E1 credits DataTable reads through the shared global ledger key", () => {
  const source = readAppSource("app/[locale]/(protected)/dashboard/admin/credits/DataTable.tsx");

  assert.match(
    source,
    /from\s+["']@\/lib\/admin-credit-query-keys["']/,
    "CreditsDataTable must import the shared admin credit query keys",
  );
  assert.match(
    source,
    /queryKey:\s*\[\s*\.\.\.adminCreditQueryKeys\.globalTransactions\s*\]/,
    "CreditsDataTable must spread the shared global ledger prefix into useDataTable",
  );
  assert.doesNotMatch(
    source,
    /queryKey:\s*\[\s*["']admin-credit-transactions["']\s*\]/,
    "CreditsDataTable must not keep an inline global ledger query key",
  );
});

test("E1 user history reads through the shared per-user ledger key", () => {
  const source = readAppSource(
    "app/[locale]/(protected)/dashboard/admin/users/[userId]/UserHistoryTabs.tsx",
  );

  assert.match(
    source,
    /from\s+["']@\/lib\/admin-credit-query-keys["']/,
    "UserHistoryTabs must import the shared admin credit query keys",
  );
  assert.match(
    source,
    /queryKey:\s*\[\s*\.\.\.adminCreditQueryKeys\.userTransactions\s*\(\s*userId\s*\)\s*,?\s*\]/,
    "UserHistoryTabs must spread the shared per-user ledger prefix into usePagedQuery",
  );
  assert.doesNotMatch(
    source,
    /queryKey:\s*\[\s*["']admin-user-credit-tx["']\s*,\s*userId\s*\]/,
    "UserHistoryTabs must not keep an inline per-user ledger query key",
  );
});

test("E1 adjustment invalidates the shared per-user ledger prefix with active-only refetch", () => {
  const source = readAppSource(
    "app/[locale]/(protected)/dashboard/admin/users/[userId]/AdjustCreditsButton.tsx",
  );

  assert.match(
    source,
    /from\s+["']@\/lib\/admin-credit-query-keys["']/,
    "AdjustCreditsButton must import the shared admin credit query keys",
  );
  assert.match(
    source,
    /invalidateQueries\(\{[\s\S]*?queryKey:\s*adminCreditQueryKeys\.userTransactions\s*\(\s*userId\s*\)[\s\S]*?exact:\s*false[\s\S]*?refetchType:\s*["']active["'][\s\S]*?\}\)/,
    "AdjustCreditsButton must retain prefix invalidation and active-only refetch",
  );
  assert.doesNotMatch(
    source,
    /queryKey:\s*\[\s*["']admin-user-credit-tx["']\s*,\s*userId\s*\]/,
    "AdjustCreditsButton must not keep an inline per-user ledger query key",
  );
});

test("E1 shared keys preserve cache bytes, pagination, filters and cross-user isolation", async () => {
  const adminCreditQueryKeys = await loadAdminCreditQueryKeys();
  const client = new reactQuery.QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  const fetchCounts = new Map<string, number>();

  const legacyGlobalFilteredPage = [
    "admin-credit-transactions",
    "2",
    "20",
    { search: "alice@example.invalid", type: "purchase" },
  ] as const;
  const legacyUserAPage0 = ["admin-user-credit-tx", "user-a", 0] as const;
  const legacyUserAPage1 = ["admin-user-credit-tx", "user-a", 1] as const;
  const legacyUserBPage0 = ["admin-user-credit-tx", "user-b", 0] as const;

  const sharedGlobalFilteredPage = [
    ...adminCreditQueryKeys.globalTransactions,
    ...legacyGlobalFilteredPage.slice(1),
  ] as const;
  const sharedUserAPage0 = [...adminCreditQueryKeys.userTransactions("user-a"), 0] as const;
  const sharedUserAPage1 = [...adminCreditQueryKeys.userTransactions("user-a"), 1] as const;
  const sharedUserBPage0 = [...adminCreditQueryKeys.userTransactions("user-b"), 0] as const;

  let unsubscribe: (() => void) | undefined;
  let observer: QueryObserverLike | undefined;

  try {
    for (const queryKey of [
      legacyGlobalFilteredPage,
      legacyUserAPage0,
      legacyUserAPage1,
      legacyUserBPage0,
    ]) {
      await client.prefetchQuery({
        queryKey,
        queryFn: trackedFetcher(queryKey, fetchCounts),
      });
    }

    assert.ok(
      client.getQueryData(sharedGlobalFilteredPage),
      "The shared global prefix must resolve the legacy filtered pagination key",
    );
    assert.ok(
      client.getQueryData(sharedUserAPage0),
      "The shared per-user prefix must resolve legacy page 0",
    );
    assert.ok(
      client.getQueryData(sharedUserAPage1),
      "The shared per-user prefix must resolve legacy page 1",
    );
    assert.ok(
      client.getQueryData(sharedUserBPage0),
      "The shared per-user prefix must resolve another user's page 0",
    );

    observer = new reactQuery.QueryObserver(client, {
      queryKey: sharedUserAPage0,
      queryFn: trackedFetcher(sharedUserAPage0, fetchCounts),
      staleTime: Number.POSITIVE_INFINITY,
    });
    unsubscribe = observer.subscribe(() => {});

    await client.invalidateQueries({
      queryKey: adminCreditQueryKeys.userTransactions("user-a"),
      exact: false,
      refetchType: "active",
    });

    assert.equal(
      fetchCount(sharedUserAPage0, fetchCounts),
      2,
      "The active user A page must refetch once after invalidation",
    );
    assert.equal(
      fetchCount(sharedUserAPage1, fetchCounts),
      1,
      "The inactive user A page must be invalidated without fetching",
    );
    assert.equal(
      client.getQueryState(sharedUserAPage1)?.isInvalidated,
      true,
      "The inactive user A page must remain invalidated in the cache",
    );
    assert.ok(
      client.getQueryData(sharedUserAPage1),
      "The inactive user A page data must remain available",
    );
    assert.equal(
      fetchCount(sharedUserBPage0, fetchCounts),
      1,
      "Another user's page must not be refetched",
    );
    assert.equal(
      client.getQueryState(sharedUserBPage0)?.isInvalidated,
      false,
      "Another user's page must not be invalidated",
    );
    assert.equal(
      fetchCount(sharedGlobalFilteredPage, fetchCounts),
      1,
      "The global filtered ledger page must not be refetched",
    );
    assert.equal(
      client.getQueryState(sharedGlobalFilteredPage)?.isInvalidated,
      false,
      "The global filtered ledger page must remain outside per-user invalidation",
    );
  } finally {
    unsubscribe?.();
    observer?.destroy();
    client.clear();
  }
});
