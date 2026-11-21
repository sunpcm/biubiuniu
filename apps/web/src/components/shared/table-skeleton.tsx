"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface TableSkeletonProps {
  /**
   * Number of columns
   */
  columnCount: number;
  /**
   * Number of rows (default 5)
   */
  rowCount?: number;
  /**
   * Custom class name
   */
  className?: string;
}

/**
 * Skeleton placeholder shown while a table is loading for the first time.
 */
export function TableSkeleton({
  columnCount,
  rowCount = 5,
  className,
}: TableSkeletonProps) {
  return (
    <div className={cn("w-full", className)}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {Array.from({ length: columnCount }).map((_, index) => (
              <TableHead key={index} className="h-10">
                <Skeleton className="h-4 w-20" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rowCount }).map((_, rowIndex) => (
            <TableRow key={rowIndex} className="hover:bg-transparent">
              {Array.from({ length: columnCount }).map((_, colIndex) => (
                <TableCell key={colIndex} className="py-3">
                  <Skeleton
                    className={cn(
                      "h-4",
                      colIndex === 0 ? "w-[80%]" : "w-[60%]"
                    )}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
