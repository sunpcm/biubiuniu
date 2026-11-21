"use client";

import { PostListActions } from "@/components/cms/PostListActions";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/shared/sortable-header";
import { PostWithTags } from "@/types/cms";
import { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { Pin } from "lucide-react";

const getStatusBadgeVariant = (
  status: string
): "default" | "secondary" | "outline" | "destructive" => {
  switch (status) {
    case "published":
      return "default";
    case "draft":
      return "secondary";
    case "archived":
      return "outline";
    default:
      return "secondary";
  }
};

const getVisibilityBadgeVariant = (
  visibility: string
): "default" | "secondary" | "outline" | "destructive" => {
  switch (visibility) {
    case "public":
      return "secondary";
    case "logged_in":
      return "outline";
    case "subscribers":
      return "default";
    default:
      return "secondary";
  }
};

export const columns: ColumnDef<PostWithTags>[] = [
  {
    accessorKey: "title",
    header: ({ column }) => <SortableHeader column={column} title="Title" />,
    size: 280,
    minSize: 200,
    cell: ({ row }) => {
      return <div className="font-medium">{row.getValue("title")}</div>;
    },
  },
  {
    accessorKey: "language",
    header: ({ column }) => <SortableHeader column={column} title="Language" />,
    size: 120,
    minSize: 100,
    cell: ({ row }) => (
      <Badge variant="outline">{row.getValue("language")}</Badge>
    ),
  },
  {
    accessorKey: "isPinned",
    header: ({ column }) => <SortableHeader column={column} title="Pinned" />,
    size: 100,
    minSize: 80,
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        {row.getValue("isPinned") ? <Pin className="w-4 h-4" /> : "-"}
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortableHeader column={column} title="Status" />,
    size: 120,
    minSize: 100,
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      return <Badge variant={getStatusBadgeVariant(status)}>{status}</Badge>;
    },
  },
  {
    accessorKey: "visibility",
    header: ({ column }) => <SortableHeader column={column} title="Visibility" />,
    size: 140,
    minSize: 120,
    cell: ({ row }) => {
      const visibility = row.getValue("visibility") as string;
      return (
        <Badge variant={getVisibilityBadgeVariant(visibility)}>
          {visibility}
        </Badge>
      );
    },
  },
  {
    accessorKey: "tags",
    header: "Tags",
    size: 200,
    minSize: 150,
    cell: ({ row }) => {
      const tags = row.original.tags || [];
      if (tags.length === 0)
        return <span className="text-muted-foreground">-</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag.id} variant="secondary" className="text-xs">
              {tag.name}
            </Badge>
          ))}
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "publishedAt",
    header: ({ column }) => <SortableHeader column={column} title="Published" />,
    size: 170,
    minSize: 150,
    cell: ({ row }) => {
      const date = row.getValue("publishedAt") as string | Date;
      try {
        return date ? dayjs(date).format("YYYY-MM-DD HH:mm") : "-";
      } catch {
        return "-";
      }
    },
  },
  {
    id: "actions",
    header: "Actions",
    size: 80,
    minSize: 60,
    enableSorting: false,
    cell: ({ row }) => {
      const post = row.original;
      return (
        <PostListActions
          post={post}
          config={{
            postType: "glossary",
            editUrl: `/dashboard/admin/glossary/${post.id}/edit`,
            duplicateUrl: `/dashboard/admin/glossary/new?duplicatePostId=${post.id}`,
          }}
        />
      );
    },
  },
];
