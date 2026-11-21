"use client";

import { deleteR2File, listR2Files } from "@/actions/r2-resources";
import {
  DataTableContainer,
  DataTableEmptyState,
  getTableLoadingState,
} from "@/components/shared/data-table-container";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import {
  PinnedTableCell,
  PinnedTableHead,
} from "@/components/shared/pinned-column";
import { TablePagination } from "@/components/shared/table-elements";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { ADMIN_UPLOAD_IMAGE_PATH } from "@/config/common";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import { getColumns } from "./Columns";
import { UploadImageDialog } from "./UploadImageDialog";

interface ImagesDataTableProps {
  categoryPrefix: string;
  r2PublicUrl?: string;
  pageSize: number;
}

export function ImagesDataTable({
  categoryPrefix,
  r2PublicUrl,
  pageSize,
}: ImagesDataTableProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [debouncedFilter] = useDebounce(filter, 500);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const pageTokensRef = useRef<Record<number, string | null>>({});

  const [columnPinning] = useState({
    right: ["actions"],
  });

  const {
    data: files = [],
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["r2-files", categoryPrefix, debouncedFilter, currentPageIndex],
    queryFn: async () => {
      const tokenForThisPage =
        currentPageIndex === 0
          ? undefined
          : pageTokensRef.current[currentPageIndex - 1];

      if (currentPageIndex > 0 && tokenForThisPage === undefined) {
        console.warn(`Token missing for page ${currentPageIndex}.`);
        return [];
      }

      const result = await listR2Files({
        categoryPrefix,
        filterPrefix: debouncedFilter,
        continuationToken: tokenForThisPage ?? undefined,
        pageSize,
      });

      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to fetch files");
      }

      pageTokensRef.current = {
        ...pageTokensRef.current,
        [currentPageIndex]: result.data.nextContinuationToken ?? null,
      };

      return result.data.files;
    },
  });

  // Reset pagination when category or filter changes
  useEffect(() => {
    setCurrentPageIndex(0);
    pageTokensRef.current = {};
  }, [categoryPrefix, debouncedFilter]);

  const handleDelete = useCallback(
    async (key: string) => {
      setIsDeleting(true);
      const deleteOpResult = await deleteR2File(key);

      if (deleteOpResult.success) {
        toast.success(`Successfully deleted ${key}`);
        await refetch();
      } else {
        toast.error(`Failed to delete ${key}`, {
          description: deleteOpResult.error,
        });
      }
      setIsDeleting(false);
    },
    [refetch]
  );

  const columns = useMemo(
    () => getColumns(r2PublicUrl, handleDelete),
    [r2PublicUrl, handleDelete]
  );

  const token = pageTokensRef.current[currentPageIndex];
  const hasMore = token !== null && token !== undefined;

  const table = useReactTable({
    data: files,
    columns,
    pageCount: currentPageIndex + (hasMore ? 2 : 1),
    state: {
      pagination: { pageIndex: currentPageIndex, pageSize },
      sorting,
      columnPinning,
    },
    onPaginationChange: (updater) => {
      const newPageIndex =
        typeof updater === "function"
          ? updater(table.getState().pagination).pageIndex
          : updater.pageIndex;
      if (newPageIndex !== currentPageIndex) {
        setCurrentPageIndex(newPageIndex);
      }
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    manualFiltering: true,
    enableColumnPinning: true,
    debugTable: process.env.NODE_ENV === "development",
  });

  const handleUploadSuccess = useCallback(() => {
    setCurrentPageIndex(0);
    pageTokensRef.current = {};
    queryClient.invalidateQueries({
      queryKey: ["r2-files", categoryPrefix],
    });
  }, [queryClient, categoryPrefix]);

  const {
    isInitialLoading,
    isFetching: isTableFetching,
    hasData,
  } = getTableLoadingState({
    isLoading: isLoading || isDeleting,
    dataLength: files.length,
  });

  const canGoNext = hasMore;
  const canGoPrevious = currentPageIndex > 0;

  const handleNextPage = () => {
    if (canGoNext) {
      setCurrentPageIndex((prev) => prev + 1);
    }
  };

  const handlePreviousPage = () => {
    if (canGoPrevious) {
      setCurrentPageIndex((prev) => prev - 1);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4 pt-4">
      <DataTableToolbar
        onRefresh={refetch}
        isRefreshing={isFetching}
        actions={
          (categoryPrefix === "" ||
            categoryPrefix === `${ADMIN_UPLOAD_IMAGE_PATH}/`) && (
            <UploadImageDialog
              onUploadSuccess={handleUploadSuccess}
              uploadPath={ADMIN_UPLOAD_IMAGE_PATH}
              categoryName="Admin Uploads"
            />
          )
        }
      >
        <Input
          placeholder="Filter by filename prefix..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 max-w-sm"
          disabled={isLoading || isDeleting}
        />
      </DataTableToolbar>

      {isError && error && (
        <div className="text-sm text-destructive">{error.message}</div>
      )}

      <DataTableContainer
        isInitialLoading={isInitialLoading}
        isFetching={isTableFetching}
        hasData={hasData}
        columnCount={columns.length}
        fillAvailableSpace
      >
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <PinnedTableHead key={header.id} header={header}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </PinnedTableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <PinnedTableCell key={cell.id} cell={cell} />
                  ))}
                </TableRow>
              ))
            ) : (
              <DataTableEmptyState colSpan={columns.length} />
            )}
          </TableBody>
        </Table>
      </DataTableContainer>

      <TablePagination
        pageIndex={currentPageIndex}
        pageCount={currentPageIndex + (hasMore ? 2 : 1)}
        isLoading={isLoading || isDeleting}
        onPrevious={handlePreviousPage}
        onNext={handleNextPage}
        infoMode="page"
      />
    </div>
  );
}
