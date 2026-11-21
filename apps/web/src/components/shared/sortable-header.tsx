"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

// ============================================
// TanStack Table mode
// ============================================

interface SortableHeaderProps<TData> {
  column: Column<TData, unknown>;
  title: string;
  className?: string;
}

/**
 * Sortable header for use with `@tanstack/react-table` columns.
 *
 * @example
 * ```tsx
 * {
 *   accessorKey: "createdAt",
 *   header: ({ column }) => <SortableHeader column={column} title="Created At" />,
 * }
 * ```
 */
export function SortableHeader<TData>({
  column,
  title,
  className,
}: SortableHeaderProps<TData>) {
  const isSorted = column.getIsSorted();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => column.toggleSorting()}
      className={cn("h-8 px-2 -ml-2 font-medium", className)}
    >
      {title}
      {isSorted === "asc" ? (
        <ArrowUp className="ml-1 h-3 w-3" />
      ) : isSorted === "desc" ? (
        <ArrowDown className="ml-1 h-3 w-3" />
      ) : (
        <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
      )}
    </Button>
  );
}

// ============================================
// Manual mode
// ============================================

export type SortDirection = "asc" | "desc" | false;

interface SortableTableHeaderProps {
  title: string;
  direction: SortDirection;
  onClick: () => void;
  className?: string;
}

/**
 * Sortable header for manually-managed sort state.
 */
export function SortableTableHeader({
  title,
  direction,
  onClick,
  className,
}: SortableTableHeaderProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn("h-8 px-2 -ml-2 font-medium", className)}
    >
      {title}
      {direction === "asc" ? (
        <ArrowUp className="ml-1 h-3 w-3" />
      ) : direction === "desc" ? (
        <ArrowDown className="ml-1 h-3 w-3" />
      ) : (
        <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
      )}
    </Button>
  );
}

export default SortableHeader;
