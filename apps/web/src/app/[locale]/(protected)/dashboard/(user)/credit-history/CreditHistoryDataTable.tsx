"use client";

import { CreditLog, getCreditLogs } from "@/actions/usage/logs";
import { Button } from "@niu/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@niu/ui/table";
import { flexRender, getCoreRowModel, PaginationState, useReactTable } from "@tanstack/react-table";
import { AlertCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getColumns } from "./Columns";

interface CreditHistoryDataTableProps {
  initialData: CreditLog[];
  initialTotalCount: number;
  pageSize?: number;
}

export function CreditHistoryDataTable({
  initialData,
  initialTotalCount,
  pageSize = 4,
}: CreditHistoryDataTableProps) {
  const t = useTranslations("CreditHistory");

  const [data, setData] = useState<CreditLog[]>(initialData);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSize,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageCount = useMemo(
    () => Math.ceil(totalCount / pagination.pageSize),
    [totalCount, pagination.pageSize],
  );

  const columns = useMemo(() => getColumns(t), [t]);

  useEffect(() => {
    const fetchPage = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getCreditLogs({
          pageIndex: pagination.pageIndex,
          pageSize: pagination.pageSize,
        });
        if (result.success && result.data) {
          setData(result.data.logs);
          setTotalCount(result.data.count);
        } else {
          throw new Error(result.error || t("load_error"));
        }
      } catch (err: any) {
        const errorMessage = err.message || t("load_error");
        setError(errorMessage);
        toast.error("Error", { description: errorMessage });
        setData([]);
        setTotalCount(0);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPage();
  }, [pagination.pageIndex, pagination.pageSize, t]);

  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: {
      pagination,
    },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualFiltering: true,
  });

  return (
    <div className="space-y-4">
      {error && (
        <div className="mb-4 flex items-center space-x-2 rounded border border-red-400 bg-red-100 p-4 text-red-600">
          <AlertCircle className="h-5 w-5" />
          <span>
            {t("load_error")}: {error}
          </span>
        </div>
      )}

      <div className="relative max-h-[calc(100vh-270px)] min-h-[200px] overflow-y-auto rounded-md border">
        {isLoading && (
          <div className="bg-background/50 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-xs">
            <Loader2 className="text-primary h-8 w-8 animate-spin" />
          </div>
        )}
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length
              ? table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : !isLoading && (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center">
                      {t("no_records")}
                    </TableCell>
                  </TableRow>
                )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between space-x-2">
        <div className="text-muted-foreground text-sm">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} ({totalCount}{" "}
          Logs)
        </div>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage() || isLoading}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage() || isLoading}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
