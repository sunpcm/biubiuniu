"use client";

import { TagManagementDialog } from "@/components/cms/TagManagementDialog";
import {
  DataTableContainer,
  DataTableEmptyState,
} from "@/components/shared/data-table-container";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";
import {
  PinnedTableCell,
  PinnedTableHead,
} from "@/components/shared/pinned-column";
import { TablePagination } from "@/components/shared/table-elements";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableHeader, TableRow } from "@/components/ui/table";
import { useDataTable } from "@/hooks/use-data-table";
import { Link as I18nLink } from "@/i18n/routing";
import { PostType } from "@/lib/db/schema";
import { ColumnDef } from "@tanstack/react-table";
import { PlusCircle } from "lucide-react";

interface PostDataTableConfig<TData> {
  postType: PostType;
  columns: ColumnDef<TData, any>[];
  listAction: (params: {
    postType: PostType;
    pageIndex: number;
    pageSize: number;
    filter: string;
  }) => Promise<any>;
  createUrl: string;
  enableTags?: boolean;
  searchPlaceholder?: string;
}

interface DataTableProps<TData> {
  config: PostDataTableConfig<TData>;
  pageSize: number;
}

interface PostFilters {
  search: string;
}

export function PostDataTable<TData>({
  config,
  pageSize,
}: DataTableProps<TData>) {
  const {
    postType,
    columns,
    listAction,
    createUrl,
    enableTags = false,
    searchPlaceholder,
  } = config;

  const {
    table,
    data,
    isLoading,
    isInitialLoading,
    isFetching,
    isPlaceholderData,
    pagination,
    pageCount,
    totalCount,
    filters,
    updateFilter,
    refetch,
  } = useDataTable<TData, PostFilters>({
    columns,
    queryKey: ["posts", postType],
    pageSize,
    initialFilters: { search: "" },
    fetchData: async ({ pageIndex, pageSize, filters }) => {
      const result = await listAction({
        postType,
        pageIndex,
        pageSize,
        filter: filters.search,
      });

      if (!result.success) {
        throw new Error(result.error || `Failed to fetch ${postType}s.`);
      }

      return {
        data: result.data?.posts as TData[],
        totalCount: result.data?.count || 0,
      };
    },
  });

  const hasData = data.length > 0;

  return (
    <div className="w-full flex flex-col flex-1 min-h-0 gap-4">
      <DataTableToolbar
        onRefresh={refetch}
        isRefreshing={isFetching}
        actions={
          <div className="flex items-center gap-2">
            {enableTags && <TagManagementDialog postType={postType} />}
            <Button asChild size="sm">
              <I18nLink href={createUrl} title="Create New Post" prefetch={false}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Create New Post
              </I18nLink>
            </Button>
          </div>
        }
      >
        <Input
          placeholder={searchPlaceholder || `Search ${postType}s...`}
          value={filters.search}
          onChange={(event) => updateFilter("search", event.target.value)}
          className="h-8 max-w-sm"
        />
      </DataTableToolbar>

      <DataTableContainer
        isInitialLoading={isInitialLoading}
        isFetching={isPlaceholderData}
        hasData={hasData}
        columnCount={columns.length}
        fillAvailableSpace
      >
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <PinnedTableHead key={header.id} header={header} />
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
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
        pageIndex={pagination.pageIndex}
        pageCount={pageCount}
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
    </div>
  );
}
