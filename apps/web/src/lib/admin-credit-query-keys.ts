/**
 * [INPUT]: None
 * [OUTPUT]: Exports adminCreditQueryKeys, the shared query-key prefixes for the
 *           global and per-user admin credit ledgers
 * [POS]: Cache-key source of truth shared by admin credit ledger readers and
 *        the per-user adjustment invalidation path
 * [PROTOCOL]: Update this header on changes, then check caller-local CLAUDE.md
 */

export const adminCreditQueryKeys = {
  globalTransactions: ["admin-credit-transactions"] as const,
  userTransactions: (userId: string) => ["admin-user-credit-tx", userId] as const,
} as const;
