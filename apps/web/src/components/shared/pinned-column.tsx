"use client";

import { TableCell, TableHead } from "@/components/ui/table";
import { Cell, Column, flexRender, Header } from "@tanstack/react-table";
import { PINNED_COLUMN_STYLES } from "./table-elements";

// ============================================
// Helper: getPinnedColumnStyles
// ============================================

interface PinnedStylesOptions {
  isHeader?: boolean;
}

export function getPinnedColumnStyles(
  column: Column<any, unknown>,
  options: PinnedStylesOptions = {}
): React.CSSProperties {
  const { isHeader = false } = options;
  const isPinned = column.getIsPinned?.();

  if (!isPinned) return {};

  const isLeft = isPinned === "left";
  const isLastLeft = column.getIsLastColumn?.("left") ?? false;
  const isFirstRight = column.getIsFirstColumn?.("right") ?? false;

  return {
    position: "sticky",
    top: isHeader ? 0 : undefined,
    left: isLeft ? `${column.getStart?.("left") ?? 0}px` : undefined,
    right: !isLeft ? `${column.getAfter?.("right") ?? 0}px` : undefined,
    zIndex: isHeader
      ? PINNED_COLUMN_STYLES.headerZIndex
      : PINNED_COLUMN_STYLES.cellZIndex,
    backgroundColor: PINNED_COLUMN_STYLES.backgroundColor,
    boxShadow:
      isLeft && isLastLeft
        ? PINNED_COLUMN_STYLES.leftShadow
        : !isLeft && isFirstRight
          ? PINNED_COLUMN_STYLES.rightShadow
          : undefined,
  };
}

// ============================================
// Component: PinnedTableHead
// ============================================

interface PinnedTableHeadProps<TData> {
  header: Header<TData, unknown>;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Table head cell that supports column pinning.
 *
 * Use for **all** header cells in a table, not just pinned ones.
 */
export function PinnedTableHead<TData>({
  header,
  children,
  className,
}: PinnedTableHeadProps<TData>) {
  const pinnedStyles = getPinnedColumnStyles(header.column, { isHeader: true });

  return (
    <TableHead
      key={header.id}
      className={className}
      style={{
        width: header.getSize(),
        minWidth: header.column.columnDef.minSize,
        maxWidth: header.column.columnDef.maxSize,
        ...pinnedStyles,
      }}
    >
      {children ??
        flexRender(header.column.columnDef.header, header.getContext())}
    </TableHead>
  );
}

// ============================================
// Component: PinnedTableCell
// ============================================

interface PinnedTableCellProps<TData> {
  cell: Cell<TData, unknown>;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Table body cell that supports column pinning.
 *
 * Use for **all** body cells in a table, not just pinned ones.
 */
export function PinnedTableCell<TData>({
  cell,
  children,
  className,
}: PinnedTableCellProps<TData>) {
  const pinnedStyles = getPinnedColumnStyles(cell.column, { isHeader: false });

  return (
    <TableCell
      key={cell.id}
      className={className}
      style={{
        width: cell.column.getSize(),
        minWidth: cell.column.columnDef.minSize,
        maxWidth: cell.column.columnDef.maxSize,
        ...pinnedStyles,
      }}
    >
      {children ?? flexRender(cell.column.columnDef.cell, cell.getContext())}
    </TableCell>
  );
}
