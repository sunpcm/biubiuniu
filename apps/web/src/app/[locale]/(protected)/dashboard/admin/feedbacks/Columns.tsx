/**
 * [INPUT]: Depends on @/actions/feedback/admin for updateFeedbackStatus/updateFeedbackPriority/deleteFeedback,
 *          @/constants/feedback for status/type/priority constants and color maps,
 *          @/components/DynamicIcon for type icons, @/components/ui for Badge/Select/Avatar/Button/AlertDialog,
 *          @/lib/auth/auth-client for session, @/lib/auth/permissions for role checks,
 *          @/types/admin/feedback for FeedbackWithUser
 * [OUTPUT]: Exports columns definition array for the feedback data table
 * [POS]: Column definitions consumed by FeedbackDataTable, handles inline status/priority editing
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import {
  deleteFeedback,
  updateFeedbackPriority,
  updateFeedbackStatus,
} from "@/actions/feedback/admin";
import { DynamicIcon } from "@/components/DynamicIcon";
import { SortableHeader } from "@/components/shared/sortable-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FEEDBACK_PRIORITIES,
  FEEDBACK_PRIORITY_COLORS,
  FEEDBACK_STATUS_COLORS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPE_ICONS,
} from "@/constants/feedback";
import { authClient } from "@/lib/auth/auth-client";
import { isSuperAdminUserRole } from "@/lib/auth/permissions";
import { FeedbackWithUser } from "@/types/admin/feedback";
import { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Eye, Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

dayjs.extend(relativeTime);

// ──────────────────────────────────────────────
//  Inline Priority Select
// ──────────────────────────────────────────────

const PriorityCell = ({
  feedbackId,
  value,
  onUpdate,
}: {
  feedbackId: string;
  value: (typeof FEEDBACK_PRIORITIES)[number];
  onUpdate?: () => void;
}) => {
  const [isPending, startTransition] = useTransition();

  const handleChange = (newPriority: string) => {
    if (newPriority === value) return;
    startTransition(async () => {
      const result = await updateFeedbackPriority({
        feedbackId,
        priority: newPriority,
      });
      if (result.success) {
        onUpdate?.();
      } else {
        toast.error("Failed to update priority", {
          description: result.error,
        });
      }
    });
  };

  const colorClass = FEEDBACK_PRIORITY_COLORS[value] || "";

  return (
    <Select value={value} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger
        className={`w-[100px] text-xs border-0 ${colorClass} ${
          isPending ? "opacity-50" : ""
        }`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FEEDBACK_PRIORITIES.map((p) => (
          <SelectItem key={p} value={p} className="text-xs capitalize">
            {p}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// ──────────────────────────────────────────────
//  Inline Status Select
// ──────────────────────────────────────────────

const StatusCell = ({
  feedbackId,
  value,
  onUpdate,
}: {
  feedbackId: string;
  value: (typeof FEEDBACK_STATUSES)[number];
  onUpdate?: () => void;
}) => {
  const [isPending, startTransition] = useTransition();

  const handleChange = (newStatus: string) => {
    if (newStatus === value) return;
    startTransition(async () => {
      const result = await updateFeedbackStatus({
        feedbackId,
        status: newStatus,
      });
      if (result.success) {
        toast.success("Status updated");
        onUpdate?.();
      } else {
        toast.error("Failed to update status", {
          description: result.error,
        });
      }
    });
  };

  const colorClass = FEEDBACK_STATUS_COLORS[value] || "";

  return (
    <Select value={value} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger
        className={`h-7 w-[120px] text-xs border-0 ${colorClass} ${
          isPending ? "opacity-50" : ""
        }`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FEEDBACK_STATUSES.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {s.replace(/_/g, " ")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// ──────────────────────────────────────────────
//  Actions Cell (view + delete)
// ──────────────────────────────────────────────

const ActionsCell = ({
  feedbackId,
  onView,
  onDelete,
}: {
  feedbackId: string;
  onView: () => void;
  onDelete?: () => void;
}) => {
  const [isPending, startTransition] = useTransition();
  const { data: session } = authClient.useSession();
  const isSuperAdmin = isSuperAdminUserRole(
    (session?.user as { role?: string } | undefined)?.role,
  );

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteFeedback(feedbackId);
      if (result.success) {
        toast.success("Feedback deleted");
        onDelete?.();
      } else {
        toast.error("Failed to delete feedback", {
          description: result.error,
        });
      }
    });
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onView}>
        <Eye className="h-4 w-4" />
        <span className="sr-only">View feedback</span>
      </Button>

      {isSuperAdmin && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              disabled={isPending}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Delete feedback</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete feedback</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the
                feedback and all associated replies.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────
//  Column definitions
//
//  The `meta` object on each ColumnDef carries callback slots
//  that DataTable populates at render time. This avoids coupling
//  the static column array to component state.
// ──────────────────────────────────────────────

export interface FeedbackColumnMeta {
  onViewDetail?: (feedbackId: string) => void;
  onRefetch?: () => void;
}

export const columns: ColumnDef<FeedbackWithUser>[] = [
  {
    id: "user",
    header: "User",
    size: 200,
    minSize: 160,
    cell: ({ row }) => {
      const { user } = row.original;
      const displayName = user.name || user.email;

      return (
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7">
            <AvatarImage src={user.image || undefined} alt={displayName} />
            <AvatarFallback className="text-xs">
              {(displayName?.[0] || "?").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">
              {user.name || "—"}
            </span>
            <span
              className="text-xs text-muted-foreground truncate cursor-pointer hover:underline"
              onClick={() => {
                navigator.clipboard.writeText(user.email);
                toast.success("Copied email to clipboard");
              }}
            >
              {user.email}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "title",
    header: ({ column }) => <SortableHeader column={column} title="Title" />,
    size: 250,
    minSize: 180,
    cell: ({ row, table }) => {
      const meta = table.options.meta as FeedbackColumnMeta | undefined;
      return (
        <span
          className="text-sm font-medium truncate block max-w-[230px] cursor-pointer hover:underline"
          onClick={() => meta?.onViewDetail?.(row.original.id)}
        >
          {row.original.title}
        </span>
      );
    },
  },
  {
    accessorKey: "type",
    header: "Type",
    size: 130,
    minSize: 110,
    cell: ({ row }) => {
      const type = row.original.type;
      const iconName = FEEDBACK_TYPE_ICONS[type] || "Wrench";
      return (
        <Badge variant="outline" className="gap-1 text-xs capitalize">
          <DynamicIcon name={iconName} className="h-3 w-3" />
          {type.replace(/_/g, " ")}
        </Badge>
      );
    },
  },
  {
    accessorKey: "priority",
    header: "Priority",
    size: 130,
    minSize: 110,
    cell: ({ row, table }) => {
      const meta = table.options.meta as FeedbackColumnMeta | undefined;
      return (
        <PriorityCell
          feedbackId={row.original.id}
          value={row.original.priority}
          onUpdate={meta?.onRefetch}
        />
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 140,
    minSize: 120,
    cell: ({ row, table }) => {
      const meta = table.options.meta as FeedbackColumnMeta | undefined;
      return (
        <StatusCell
          feedbackId={row.original.id}
          value={row.original.status}
          onUpdate={meta?.onRefetch}
        />
      );
    },
  },
  {
    id: "replyCount",
    header: "Replies",
    size: 80,
    minSize: 60,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.replyCount}
      </span>
    ),
  },
  {
    accessorKey: "updatedAt",
    header: ({ column }) => <SortableHeader column={column} title="Updated" />,
    size: 130,
    minSize: 100,
    cell: ({ row }) => {
      const date = row.original.updatedAt;
      return (
        <span className="text-sm text-muted-foreground">
          {date ? dayjs(date).fromNow() : "—"}
        </span>
      );
    },
  },
  {
    id: "actions",
    header: "Actions",
    size: 80,
    minSize: 60,
    cell: ({ row, table }) => {
      const meta = table.options.meta as FeedbackColumnMeta | undefined;
      return (
        <ActionsCell
          feedbackId={row.original.id}
          onView={() => meta?.onViewDetail?.(row.original.id)}
          onDelete={meta?.onRefetch}
        />
      );
    },
  },
];
