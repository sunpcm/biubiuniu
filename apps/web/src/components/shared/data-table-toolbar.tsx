"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import { ReactNode } from "react";

interface DataTableToolbarProps {
  /**
   * Left side content: search input, filters, etc.
   */
  children?: ReactNode;
  /**
   * Right side content: action buttons (placed before the refresh button).
   */
  actions?: ReactNode;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  className?: string;
}

/**
 * Standard table toolbar.
 *
 * Layout:
 * - Left side (children) takes all remaining space after the right side.
 * - Right side (actions + refresh) is sized to its content and never shrinks.
 * - Refresh button is always the last item on the right.
 */
export function DataTableToolbar({
  children,
  actions,
  onRefresh,
  isRefreshing,
  className,
}: DataTableToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-start sm:items-center gap-3",
        className
      )}
    >
      <div className="flex flex-1 flex-wrap items-center gap-3 min-w-0">
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {onRefresh && (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh"
          >
            <RefreshCw
              className={cn("h-4 w-4", isRefreshing && "animate-spin")}
            />
          </Button>
        )}
      </div>
    </div>
  );
}
