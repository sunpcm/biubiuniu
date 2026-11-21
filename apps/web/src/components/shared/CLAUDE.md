# components/shared/
> L2 | Parent: /CLAUDE.md

Cross-page atoms: the data-table kit (container / toolbar / pinned columns / sort header / row actions / pagination / skeleton), the workspace switcher and a few small generic pieces (copy button, badge, image preview, backgrounds, cookie consent, translation guard). The table kit's design rules live in TABLE_DESIGN_STANDARDS.md in this directory.

Files
- data-table-container.tsx: Table container with the loading / empty three-state (DataTableContainer / getTableLoadingState / DataTableEmptyState). The isFetching prop means "the rows on screen are stale", not "a request is in flight": consumers feed isPlaceholderData, so same-key background refetches and mutations are never a transition. Shared by both fetch families (use-data-table, use-paged-query).
- data-table-toolbar.tsx: Table toolbar (filters / search on the left, refresh on the right; the refresh spinner takes the raw isFetching).
- pinned-column.tsx: Pinned-column styles and cells (getPinnedColumnStyles / PinnedTableHead / PinnedTableCell), reads PINNED_COLUMN_STYLES from table-elements.
- row-action-buttons.tsx: The single source of truth for table row actions: callers declare a flat RowAction[], the component clusters by tone (destructive goes past a hairline divider) and moves overflow items into a "..." menu. Icon vocabulary in TABLE_DESIGN_STANDARDS.md section 7.
- sortable-header.tsx: Sortable table header (SortableHeader in TanStack mode / SortableTableHeader in manual mode).
- table-elements.tsx: TablePagination (offset pagination bar: page numbers / first-last / page size / three info modes) + PINNED_COLUMN_STYLES. Deliberately not wired to next-intl; user-facing pages pass translations through info / navLabels.
- table-skeleton.tsx: Table loading skeleton (rendered by DataTableContainer on first paint with no data).
- TABLE_DESIGN_STANDARDS.md: Data-table design standard (fourteen sections; section 1 the two fetch channels, 2 the three loading signals, 6 pinned columns, 7 row actions, 9 pagination and localization, 10 useDataTable / usePagedQuery, 13 the new-table checklist). Required reading before adding or reworking a table.
- WorkspaceSwitcher.tsx: Personal / team workspace dropdown; organization.setActive writes session.activeOrganizationId and every server consumer (credit pool, balance display) follows. Consumed by DashboardSidebar.
- CopyButton.tsx: Copy-to-clipboard button (icon / ghost / bubble looks).
- FeatureBadge.tsx: Feature badge label (optional external link).
- ImagePreview.tsx: Click-to-zoom image preview (thin react-medium-image-zoom wrapper).
- BGs.tsx: Decorative background shapes (BG1).
- DomTranslationGuard.tsx: Browser full-page-translation crash guard: a pre-hydration inline script wraps Node.prototype.removeChild / insertBefore, forming a third line of defense next to the layout's translate="no" + notranslate meta.
- CookieConsent/: Cookie consent banner and gate (ConsentBanner / ConsentGate, index re-exports both).

Pitfalls
- Tables fetch through exactly two channels: hooks/use-data-table (column defs / filters / sorting) and hooks/use-paged-query (paging only). A raw useQuery + useState(pageIndex) is where tables drifted before; the one legitimate exception is admin/r2-resources' cursor pagination (R2 ListObjects has no total).
- DataTableContainer's isFetching takes isPlaceholderData only. Feeding the raw isFetching makes tab-back, polling and manual refresh flash the whole table.

[PROTOCOL]: Update this header on changes, then check CLAUDE.md
