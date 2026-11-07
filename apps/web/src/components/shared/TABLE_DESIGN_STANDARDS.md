# Table Design Standards

Unified table design standards for the NEXTY.DEV template.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Loading Container](#2-loading-container-datatablecontainer)
3. [Skeleton](#3-skeleton-tableskeleton)
4. [Empty State](#4-empty-state-datatableemptystate)
5. [Toolbar](#5-toolbar-datatabletoolbar)
6. [Pinned Columns](#6-pinned-columns-pinnedcolumn)
7. [Row Actions](#7-row-actions-rowactionbuttons)
8. [Sortable Header](#8-sortable-header-sortableheader)
9. [Pagination](#9-pagination)
10. [Data Hooks](#10-data-hooks-usedatatable--usepagedquery)
11. [Max Height](#11-max-height)
12. [Page Layout](#12-page-layout)
13. [Quick Checklist](#13-quick-checklist)
14. [Related Files](#14-related-files)

---

## 1. Overview

All dashboard tables in this project are **client-side rendered** and fetch data with
`@tanstack/react-query`. There are exactly two sanctioned data channels — pick by what
the table needs, and do not hand-roll a third:

| Channel | Use it when | File |
|---------|-------------|------|
| `useDataTable` | The table needs column defs, debounced filters, sorting, pinned columns | `hooks/use-data-table.ts` |
| `usePagedQuery` | The table only needs "fetch page N" — a plain paged list | `hooks/use-paged-query.ts` |

Both expose the **same three loading signals**, so every table below behaves identically.
A raw `useQuery` + `useState(pageIndex)` in a table component is the pattern that drifted
before; it is no longer acceptable. The one legitimate exception is a **cursor-paginated**
source that cannot satisfy the offset+total contract (`admin/r2-resources`, whose R2
`ListObjects` returns a continuation token and no total) — it still uses the shared
container, empty state, toolbar, and pagination.

Key UX conventions:

- Default `rounded-md border` around the table area.
- Skeleton on first load, shimmer progress bar + dimmed content on refresh.
- Search / filters on the **left**, refresh button on the **top-right**.
- Sticky pinned columns for primary identifiers and actions.
- Unified `TablePagination` at the bottom.

---

## 2. Loading Container `DataTableContainer`

File: `components/shared/data-table-container.tsx`

### Two-stage loading

- **Initial load**: shows skeleton table.
- **Page / filter transition**: keeps the old rows visible, dims to 50 %, and slides a
  shimmer progress bar along the top edge (`@keyframes shimmer`, transform-based).

### The three loading signals — feed the right one

This is the single rule that tables get wrong. `DataTableContainer`'s `isFetching` prop
does **not** mean "a request is in flight"; it means **"what is on screen is stale"**.

| Signal | Meaning | Goes to |
|--------|---------|---------|
| `isInitialLoading` | Nothing to show yet | `DataTableContainer isInitialLoading` → skeleton |
| `isPlaceholderData` | Screen still shows the previous page / previous filter | `DataTableContainer isFetching` → progress bar + dim |
| `isFetching` (raw) | Any request in flight, including same-key background refetch | Toolbar refresh button spinner **only** |

> ⚠️ Never pass raw `isFetching` to the container. Tab-back remounts, polling, and manual
> refresh all set it, and the whole table would flash on every one of them. Both hooks
> expose `isPlaceholderData` for exactly this.

Mutations (delete, toggle, retry) are **not** a transition either — they get the toolbar
spinner and disabled row buttons, not a table-wide bar.

### Default styling

The container renders `rounded-md border` by default. Override with `className` if needed.

### Standard usage

```tsx
import { DataTableContainer } from "@/components/shared/data-table-container";

// from useDataTable or usePagedQuery
<DataTableContainer
  isInitialLoading={isInitialLoading}
  isFetching={isPlaceholderData}
  hasData={hasData}
  columnCount={columns.length}
  maxHeight="calc(100vh - 280px)"
>
  <Table>...</Table>
</DataTableContainer>
```

`getTableLoadingState({ isLoading, dataLength })` derives all three flags from a single
`isLoading` boolean. Use it only where there is no react-query status to read — i.e. the
cursor-paginated table. Everywhere else read the hook's own flags, which distinguish a
transition from a background refresh (the single boolean cannot). Several admin TanStack
tables still call the helper; do not copy that into a new table.

---

## 3. Skeleton `TableSkeleton`

File: `components/shared/table-skeleton.tsx`

- First column width 80 %, others 60 %.
- Default 5 rows.
- Header skeleton width `w-20`.

```tsx
import { TableSkeleton } from "@/components/shared/table-skeleton";

<TableSkeleton columnCount={5} rowCount={5} />
```

---

## 4. Empty State `DataTableEmptyState`

File: `components/shared/data-table-container.tsx`

- Centered, `h-24`, `text-muted-foreground`.
- Default message `"No results found."`.
- `colSpan` must equal total column count.

```tsx
<DataTableEmptyState colSpan={columns.length} message="No results." />
```

---

## 5. Toolbar `DataTableToolbar`

File: `components/shared/data-table-toolbar.tsx`

### Layout rule

- Left: search input + filter selects.
- Right: refresh button (spins while `isRefreshing`).

```tsx
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";

<DataTableToolbar onRefresh={refetch} isRefreshing={isFetching}>
  <Input
    placeholder="Search..."
    value={filters.search}
    onChange={(e) => updateFilter("search", e.target.value)}
    className="h-8 max-w-sm"
  />
  <Select>...</Select>
</DataTableToolbar>
```

---

## 6. Pinned Columns `PinnedColumn`

File: `components/shared/pinned-column.tsx`

### Style constants

| Constant | Value |
|----------|-------|
| `headerZIndex` | `40` |
| `cellZIndex` | `20` |
| `leftShadow` | `2px 0 4px -2px rgba(0,0,0,0.1)` |
| `rightShadow` | `-2px 0 4px -2px rgba(0,0,0,0.1)` |
| `backgroundColor` | `var(--background)` |

### Standard usage

```tsx
import {
  PinnedTableHead,
  PinnedTableCell,
} from "@/components/shared/pinned-column";

<TableHeader>
  {table.getHeaderGroups().map((headerGroup) => (
    <TableRow key={headerGroup.id}>
      {headerGroup.headers.map((header) => (
        <PinnedTableHead key={header.id} header={header}>
          {flexRender(header.column.columnDef.header, header.getContext())}
        </PinnedTableHead>
      ))}
    </TableRow>
  ))}
</TableHeader>

<TableBody>
  {table.getRowModel().rows.map((row) => (
    <TableRow key={row.id}>
      {row.getVisibleCells().map((cell) => (
        <PinnedTableCell key={cell.id} cell={cell} />
      ))}
    </TableRow>
  ))}
</TableBody>
```

### Declaring pinned columns

```tsx
const table = useReactTable({
  data,
  columns,
  state: {
    columnPinning: {
      left: ["user"],
      right: ["actions"],
    },
  },
});
```

Tables driven by `useDataTable` pass the same object as the `columnPinning`
option instead of wiring table state by hand:

```tsx
const { table } = useDataTable({
  columns,
  columnPinning: { left: ["user"], right: ["actions"] },
  // ...
});
```

> ⚠️ Use `PinnedTableHead` / `PinnedTableCell` for **all** cells in the table.
> ⚠️ Pinned columns should declare `size` + `minSize` + `maxSize`.
> ⚠️ **Declare the desktop layout only.** `useDataTable` forces "nothing
> pinned" below 768px — pinned columns eat horizontal space on narrow screens
> and make scrolling harder to read. Never re-check `useIsMobile` in a table
> component: one rule, one place.

---

## 7. Row Actions `RowActionButtons`

File: `components/shared/row-action-buttons.tsx`

**Icon buttons first — a `⋯` dropdown is the fallback, not the default.**
A dropdown hides every action behind a click, so the most common one costs two
interactions and the row's capabilities are invisible until you probe. Reach for
a dropdown only when a single row genuinely carries more than ~6 actions.

### Rules

1. **Declare data, not JSX.** Build a flat `RowAction[]` and hand it to
   `RowActionButtons`. Never hand-write N near-identical `<Button>` blocks —
   that is the redundancy smell, and it drifts table by table.
2. **Gate with `visible`, not conditional spreads.** State-machine gating stays
   readable as one flat list.
3. **Colour on hover only.** Idle state is always `text-muted-foreground`.
   20 rows x 5 coloured buttons is 100 colour blobs — noise, not design.
   Colour belongs to the one button the pointer is on.
4. **Group by cost of a misclick, not by even spacing.** Anything irreversible
   gets `tone: "destructive"`; `RowActionButtons` automatically moves those past
   a hairline divider. The rule lives in one place so it cannot drift.
5. **Every action needs a `label`** — it renders as both the tooltip and the
   `aria-label`. An icon button without a readable name is a blank sheet for
   screen-reader users.
6. **Navigation uses `href`, not `onClick` + router.** The type union enforces
   one or the other.
7. **Widen the actions column** to `32px x icons + ~12px` for the divider, and
   size it for the widest state the state machine can produce.
8. **Past ~6 inline icons, go hybrid** — keep the everyday few inline and mark
   the long tail `overflow: true`. A wall of 8 identical-weight icons is no more
   scannable than a dropdown; picking the top 3 is the design work. Do not fall
   all the way back to a pure `...` menu.

### Fields

| Field | Purpose |
|-------|---------|
| `key` | React key + debug id; use the action's semantic name |
| `icon` / `label` | `label` renders as both tooltip and `aria-label` |
| `tone` | See below; drives colour *and* clustering |
| `visible` | State-machine gating; `false` renders nothing |
| `disabled` | Visible but unavailable right now (OR'd with the group's `disabled`) |
| `loading` | Swaps the icon for a spinner and disables the button |
| `overflow` | Moves the action into the `...` menu |
| `prefetch` | `href` actions only — pass `false` for heavy destinations |
| `onClick` \| `href` | Mutually exclusive; the type union enforces it |

### Tones

| Tone | Meaning | Hover |
|------|---------|-------|
| `neutral` (default) | Reversible, everyday | `bg-muted` / `text-foreground` |
| `positive` | Advances / activates | emerald — match the "active" status badge so hover previews the outcome |
| `destructive` | Irreversible | destructive red, auto-grouped after the divider |

### Standard usage

```tsx
import {
  RowActionButtons,
  type RowAction,
} from "@/components/shared/row-action-buttons";
import { Archive, CircleCheck, Copy, Pencil, Trash2 } from "lucide-react";

const actions: RowAction[] = [
  { key: "edit", icon: Pencil, label: t("edit"), onClick: () => setOpenEdit(true) },
  { key: "duplicate", icon: Copy, label: t("duplicate"), onClick: handleDuplicate },
  {
    key: "activate",
    icon: CircleCheck,
    label: t("activate"),
    tone: "positive",
    visible: canActivate,
    onClick: () => runStatusTransition("active"),
  },
  { key: "archive", icon: Archive, label: t("archive"), visible: canArchive, onClick: handleArchive },
  { key: "delete", icon: Trash2, label: t("delete"), tone: "destructive", onClick: () => setOpenDelete(true) },
];

<RowActionButtons actions={actions} disabled={isPending} />
```

> Destructive actions still open a confirmation dialog — the divider prevents
> the slip, the dialog catches it.

### Hybrid layout (many actions)

Rendered order is `[everyday inline] [... overflow] | [irreversible inline]`.
The `...` belongs to the everyday cluster — it means "more everyday actions" —
so the divider still guards only what cannot be undone.

```tsx
const actions: RowAction[] = [
  { key: "view", icon: Eye, label: "View details", href: `/users/${id}` },
  { key: "email", icon: Mail, label: "Send email", onClick: openEmail },
  { key: "credits", icon: Coins, label: "Adjust credits", onClick: openCredits },
  { key: "copy-id", icon: ClipboardCopy, label: "Copy user ID", overflow: true, onClick: copyId },
  { key: "ban", icon: Ban, label: "Ban user", tone: "destructive", overflow: true, onClick: openBan },
];
```

Overflow items render as icon + text inside the menu; `tone: "destructive"`
becomes the menu item's destructive variant instead of a hover colour (a menu
highlights one row at a time, so the "100 colour blobs" problem does not apply).

### Icon vocabulary

Keep icons consistent across tables so they read as one system:

| Action | Icon |
|--------|------|
| View / open detail | `Eye` |
| Edit | `Pencil` |
| Duplicate | `Copy` |
| Activate / enable | `CircleCheck` |
| Start / launch | `Rocket` |
| Pause / resume | `Pause` / `Play` |
| Archive | `Archive` |
| Cancel / abort | `Ban` |
| Delete | `Trash2` |
| Download | `Download` |
| Copy to clipboard | `ClipboardCopy` (never `Copy` — that means Duplicate) |
| Copy a payment identifier | `CreditCard` |
| Refund / undo | `Undo2` |
| Grant / revoke a role | `ShieldCheck` / `ShieldOff` |
| Adjust credits | `Coins` |
| Send email | `Mail` |

When two actions copy different values, let the icon name the **subject** and
the tooltip name the verb — two identical clipboard icons side by side is the
one case a tooltip cannot rescue.

---

## 8. Sortable Header `SortableHeader`

File: `components/shared/sortable-header.tsx`

### TanStack mode

```tsx
import { SortableHeader } from "@/components/shared/sortable-header";

const columns = [
  {
    accessorKey: "createdAt",
    header: ({ column }) => <SortableHeader column={column} title="Created At" />,
  },
];
```

### Manual mode

```tsx
import { SortableTableHeader } from "@/components/shared/sortable-header";

<SortableTableHeader
  title="Updated"
  direction={sortBy === "updatedAt" ? sortOrder : false}
  onClick={() => handleSortChange("updatedAt")}
/>
```

---

## 9. Pagination

File: `components/shared/table-elements.tsx`

```tsx
import { TablePagination } from "@/components/shared/table-elements";

<TablePagination
  pageIndex={table.getState().pagination.pageIndex}
  pageCount={table.getPageCount()}
  totalItems={totalCount}
  isLoading={isLoading}
  onPrevious={() => table.previousPage()}
  onNext={() => table.nextPage()}
  pageSize={pagination.pageSize}
  onPageSizeChange={(size) => table.setPageSize(size)}
  onPageChange={(index) => table.setPageIndex(index)}
  showFirstLast={pageCount > 5}
  infoMode="range"
/>
```

### Style rules

- Info text: `text-xs text-muted-foreground`.
- Numbers: bold.
- Separator: `·`.
- Page size selector width: `64px`, label `/ page`.
- Nav buttons: `variant="ghost" size="icon" h-8 w-8`.

### Localized pages

The built-in strings are English (the Admin standard — Admin ships `en` only). A
**user-facing** table passes its own translations instead of forking the component:

```tsx
<TablePagination
  ...
  info={t("pagination.range", { from, to, total })}
  navLabels={{ previous: t("pagination.previous"), next: t("pagination.next") }}
/>
```

`info` replaces the whole left-hand info text (so `infoMode` is ignored); `navLabels`
replaces the nav buttons' `title` / `aria-label`. Nothing else is language-dependent —
page numbers are digits. Do **not** wire `next-intl` into the component: it lives in
`components/shared` and is consumed by Admin pages that have no message namespace.

---

## 10. Data Hooks `useDataTable` / `usePagedQuery`

### `useDataTable`

File: `hooks/use-data-table.ts`

Built on `@tanstack/react-query`. Manages pagination, debounced filters, sorting, loading states, caching, and refetch.

```tsx
import { useDataTable } from "@/hooks/use-data-table";

const {
  table,
  isLoading,
  isFetching,
  isPlaceholderData,
  isInitialLoading,
  refetch,
  pagination,
  totalCount,
  pageCount,
  filters,
  updateFilter,
} = useDataTable<MyRow, { search: string; status: string }>({
  columns,
  queryKey: ["my-resource"],
  pageSize: 20,
  initialFilters: { search: "", status: "" },
  fetchData: async ({ pageIndex, pageSize, filters }) => {
    const result = await fetchFromServer({ pageIndex, pageSize, ...filters });
    return result.success
      ? { data: result.data.items, totalCount: result.data.total }
      : null;
  },
});
```

### Notes

- Provide a unique `queryKey` per resource.
- Filters are debounced (default 500 ms).
- `fetchData` receives the current page, page size, and debounced filters.
- Sorting is client-side on the current page by default; pass `manualSorting`
  for server-side sorting (sorting state goes into `fetchData` and the query key,
  and a sort change resets to page 1).
- Three loading signals: `isInitialLoading` → skeleton, `isPlaceholderData` →
  `DataTableContainer`'s `isFetching`, raw `isFetching` → toolbar spinner only.
- `refetchInterval` (number or a function of the latest result) enables polling,
  e.g. keep polling while any row is still in flight.

### `usePagedQuery`

File: `hooks/use-paged-query.ts`

For tables that only need "fetch page N" — no column defs, no filters, no sorting.
Owns the page index and returns the same three loading signals as `useDataTable`.

```tsx
import { usePagedQuery } from "@/hooks/use-paged-query";

const paged = usePagedQuery<MyOrderItem>({
  queryKey: ["my-orders"],          // page index is appended by the hook
  pageSize: 10,
  fetchPage: async ({ pageIndex, pageSize }) => {
    const result = await getMyOrders({ pageIndex, pageSize });
    if (!result.success) {
      toast.error(result.error);     // swallow → page stays usable
      return { items: [], total: 0 };
    }
    return result.data ?? { items: [], total: 0 };
  },
});
```

- **`keepPreviousData` is the point.** The query key carries the page index; without it
  every page change is "new key, no data" and the whole table flashes a skeleton.
- Put filters in `queryKey`, not in a closure — otherwise changing them refetches nothing.
- `fetchPage` decides the failure policy: `throw` to get `isError` and render a retry
  affordance (`team` activity card), or swallow + toast to keep the page usable
  (`billing` history).

Used by `billing/BillingHistory`, `team/TeamActivityCard`,
`admin/users/[userId]/UserHistoryTabs`.

---

## 11. Max Height

Use `maxHeight` on `DataTableContainer` with internal scrolling so filters / pagination remain visible.

| Scenario | Recommended value |
|----------|-------------------|
| Standard page (breadcrumbs + title + filters) | `calc(100vh - 280px)` |
| Compact page | `calc(100vh - 240px)` |
| Complex filters | `calc(100vh - 320px)` |
| Modal | `calc(100vh - 400px)` |

---

## 12. Page Layout

Dashboard pages should **not** fetch table data server-side. They only render the table component.

```tsx
export default function MyPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Title</h1>
        <p className="text-muted-foreground">Description</p>
      </div>
      <MyDataTable pageSize={20} />
    </div>
  );
}
```

Inside the table component:

```tsx
<div className="flex flex-col flex-1 min-h-0 gap-4">
  <DataTableToolbar onRefresh={refetch} isRefreshing={isFetching}>
    <Input ... />
    <Select ... />
  </DataTableToolbar>

  <DataTableContainer fillAvailableSpace ...>
    <Table>...</Table>
  </DataTableContainer>

  <TablePagination ... />
</div>
```

---

## 13. Quick Checklist

When building a new table page:

- [ ] Fetch through `useDataTable` or `usePagedQuery` — never a raw `useQuery` + `useState(pageIndex)`
- [ ] Provide a unique `queryKey` (filters inside it; the hook appends the page index)
- [ ] Wrap `<Table>` with `DataTableContainer` (default border)
- [ ] Feed `isPlaceholderData` to the container's `isFetching`, raw `isFetching` to the toolbar only
- [ ] Set `maxHeight` on the container
- [ ] Use `DataTableToolbar` with filters/search on the left and refresh on the right
- [ ] Use `PinnedTableHead` / `PinnedTableCell` for all cells
- [ ] Declare `size` / `minSize` / `maxSize` on columns
- [ ] Declare `columnPinning` (left key column, right actions column)
- [ ] Use `SortableHeader` for sortable columns
- [ ] Use `RowActionButtons` for row actions (icons first, `⋯` overflow past ~6)
- [ ] Use `DataTableEmptyState` with correct `colSpan`
- [ ] Use `TablePagination` at the bottom
- [ ] Dashboard page does **not** fetch table data server-side

---

## 14. Related Files

| File | Purpose |
|------|---------|
| `components/shared/data-table-container.tsx` | Loading container, empty state, loading helper |
| `components/shared/table-skeleton.tsx` | Skeleton table |
| `components/shared/data-table-toolbar.tsx` | Toolbar with left filters + right refresh |
| `components/shared/pinned-column.tsx` | Pinned column cells |
| `components/shared/sortable-header.tsx` | Sortable headers |
| `components/shared/row-action-buttons.tsx` | Row action icon buttons (tones, overflow menu) |
| `components/shared/table-elements.tsx` | Pagination (`info`/`navLabels` overrides for localized pages), pinned column constants |
| `components/ui/table.tsx` | shadcn/ui base table |
| `components/providers/query-provider.tsx` | React Query provider |
| `hooks/use-data-table.ts` | React Query powered data table hook (columns, filters, sorting) |
| `hooks/use-paged-query.ts` | React Query powered paged list hook (page index only) |
