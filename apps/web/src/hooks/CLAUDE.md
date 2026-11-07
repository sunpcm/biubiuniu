# hooks/
> L2 | Parent: /CLAUDE.md

Client-side React hooks shared by the dashboard and the site. No server code lives here.

Files
- use-data-table.ts: useDataTable, the TanStack Table + React Query engine for server-paginated tables (pagination, debounced filters, optional manualSorting, optional refetchInterval polling, columnPinning declared for desktop and forced off below 768px by the engine, so table components never call useIsMobile themselves). Three loading signals: isInitialLoading (first-paint skeleton), isPlaceholderData (page / filter transition, the one to feed DataTableContainer's isFetching), raw isFetching (toolbar refresh spinner only, so same-key background refetches stay silent). Also exports the ColumnDef alias and the options / return types.
- use-paged-query.ts: usePagedQuery, the only channel for tables that only page and do not want TanStack Table (billing/BillingHistory, team/TeamActivityCard, admin/users/[userId]/UserHistoryTabs). Owns the page index, appends it to the query key, keeps the previous page on screen (keepPreviousData is the reason it exists: without it every page change is "new key, no data" and the table flashes a skeleton) and returns the same three loading signals as use-data-table. fetchPage decides the failure policy: throw for isError + retry, or swallow + toast to keep the page usable.
- use-optimistic-row-action.ts: useOptimisticRowAction, the write side paired with use-data-table's read side: optimistic patch into the cache, server action in the background, silent invalidate on success, snapshot rollback + the server's reason on failure. A patch is an object (field merge) or a function (row replace; returning null removes the row, so delete actions reuse the same channel). A table binds its queryKey once (see admin/users/use-user-row-action) and hands the result to its row-action dialogs.
- use-mobile.ts: useIsMobile, matchMedia below the 768px breakpoint; undefined until mounted so SSR and the first client render agree. Consumed by use-data-table (pinning), components/ui/sidebar and FeedbackDialog.
- useCookieConsent.ts: useCookieConsent, reads/writes the cookieConsent cookie through js-cookie (true / false / unset = implicit consent for tracking).

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
