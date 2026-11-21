/**
 * [INPUT]: Depends on @/actions/feedback/user for getMyFeedback,
 *          @/constants/feedback for FEEDBACK_TYPES/FEEDBACK_STATUSES/FEEDBACK_STATUS_COLORS/FEEDBACK_TYPE_ICONS,
 *          @/components/DynamicIcon for icon rendering,
 *          @/components/feedback/FeedbackProvider for useFeedback dialog,
 *          @tanstack/react-query for useQuery
 * [OUTPUT]: Exports FeedbackList component
 * [POS]: Main card-list view for user's feedback, renders inside page.tsx,
 *        opens FeedbackDetailSheet on card click
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

"use client";

import { getMyFeedback, type GetMyFeedbackResult } from "@/actions/feedback/user";
import { DynamicIcon } from "@/components/DynamicIcon";
import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FEEDBACK_STATUS_COLORS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPE_ICONS,
  FEEDBACK_TYPES,
  isFeedbackStatus,
  isFeedbackType,
  type FeedbackStatus,
  type FeedbackType,
} from "@/constants/feedback";
import { FeedbackWithReplyCount } from "@/types/admin/feedback";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  MessageSquarePlus,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { FeedbackDetailSheet } from "./FeedbackDetailSheet";

dayjs.extend(relativeTime);

// ============================================================
// Constants
// ============================================================

const PAGE_SIZE = 10;

// ============================================================
// Component
// ============================================================

export function FeedbackList() {
  const t = useTranslations("Feedback");
  const { openDialog } = useFeedback();

  // ----------------------------------------------------------
  // State: filters, pagination, detail sheet
  // ----------------------------------------------------------

  const [filterType, setFilterType] = useState<FeedbackType | "">("");
  const [filterStatus, setFilterStatus] = useState<FeedbackStatus | "">("");
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // ----------------------------------------------------------
  // Data fetching
  // ----------------------------------------------------------

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["my-feedbacks", pageIndex, filterType, filterStatus],
    queryFn: async () => {
      const result: GetMyFeedbackResult = await getMyFeedback({
        pageIndex,
        pageSize: PAGE_SIZE,
        filterType: filterType || undefined,
        filterStatus: filterStatus || undefined,
      });

      if (!result.success) {
        toast.error(result.error);
        return { feedbacks: [] as FeedbackWithReplyCount[], totalCount: 0 };
      }

      return (
        result.data ?? {
          feedbacks: [] as FeedbackWithReplyCount[],
          totalCount: 0,
        }
      );
    },
  });

  const feedbacks = data?.feedbacks ?? [];
  const totalCount = data?.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // ----------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------

  const handleTypeFilterChange = useCallback((value: string) => {
    if (value === "all") {
      setFilterType("");
      setPageIndex(0);
      return;
    }

    if (isFeedbackType(value)) {
      setFilterType(value);
      setPageIndex(0);
    }
  }, []);

  const handleStatusFilterChange = useCallback((value: string) => {
    if (value === "all") {
      setFilterStatus("");
      setPageIndex(0);
      return;
    }

    if (isFeedbackStatus(value)) {
      setFilterStatus(value);
      setPageIndex(0);
    }
  }, []);

  const openDetail = useCallback((id: string) => {
    setSelectedFeedbackId(id);
    setSheetOpen(true);
  }, []);

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <Select value={filterType || "all"} onValueChange={handleTypeFilterChange}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder={t("filter.type")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filter.all")}</SelectItem>
              {FEEDBACK_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`type.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterStatus || "all"} onValueChange={handleStatusFilterChange}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder={t("filter.status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filter.all")}</SelectItem>
              {FEEDBACK_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`status.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={openDialog} size="sm">
            <MessageSquarePlus className="size-4" />
            {t("button.newFeedback")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <FeedbackListSkeleton />
      ) : feedbacks.length === 0 ? (
        <EmptyState onSendFeedback={openDialog} />
      ) : (
        <div className={`space-y-3 ${isFetching ? "opacity-60" : ""}`}>
          {feedbacks.map((fb) => (
            <FeedbackCard key={fb.id} feedback={fb} onClick={() => openDetail(fb.id)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            {pageIndex * PAGE_SIZE + 1}-{Math.min((pageIndex + 1) * PAGE_SIZE, totalCount)} /{" "}
            {totalCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pageIndex === 0 || isFetching}
              onClick={() => setPageIndex((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 size-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pageIndex >= pageCount - 1 || isFetching}
              onClick={() => setPageIndex((p) => p + 1)}
            >
              Next
              <ChevronRight className="ml-1 size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      {selectedFeedbackId && (
        <FeedbackDetailSheet
          feedbackId={selectedFeedbackId}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />
      )}
    </>
  );
}

// ============================================================
// FeedbackCard — Single feedback item
// ============================================================

function FeedbackCard({
  feedback,
  onClick,
}: {
  feedback: FeedbackWithReplyCount;
  onClick: () => void;
}) {
  const t = useTranslations("Feedback");
  const iconName = FEEDBACK_TYPE_ICONS[feedback.type] ?? "Wrench";
  const statusColor = FEEDBACK_STATUS_COLORS[feedback.status] ?? "";

  return (
    <Card className="hover:bg-accent/50 cursor-pointer p-4 transition-colors" onClick={onClick}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <DynamicIcon name={iconName} className="text-muted-foreground size-5" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-medium">{feedback.title}</h3>
            <span className="text-muted-foreground shrink-0 text-xs">
              {dayjs(feedback.updatedAt).fromNow()}
            </span>
          </div>

          <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
            {feedback.description}
          </p>

          <div className="mt-2 flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              {t(`type.${feedback.type}`)}
            </Badge>
            <Badge variant="secondary" className={`text-[10px] ${statusColor}`}>
              {t(`status.${feedback.status}`)}
            </Badge>
            {feedback.replyCount > 0 && (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <MessageSquare className="size-3" />
                {feedback.replyCount}
              </span>
            )}
          </div>

          {/* Latest reply preview */}
          {feedback.latestReply && (
            <div className="bg-muted/50 mt-2 rounded-md px-2.5 py-1.5">
              <p className="text-muted-foreground line-clamp-2 text-xs">
                <span className="font-medium">
                  {feedback.latestReply.isAdmin
                    ? `${t("detail.latestReplyAdmin")}:`
                    : `${t("title")}:`}
                </span>{" "}
                {feedback.latestReply.content}
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ============================================================
// EmptyState
// ============================================================

function EmptyState({ onSendFeedback }: { onSendFeedback: () => void }) {
  const t = useTranslations("Feedback");

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-muted mb-4 flex size-16 items-center justify-center rounded-full">
        <MessageSquare className="text-muted-foreground size-8" />
      </div>
      <h3 className="text-lg font-medium">{t("emptyState.title")}</h3>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">{t("emptyState.description")}</p>
      <Button className="mt-4" onClick={onSendFeedback}>
        <MessageSquarePlus className="mr-2 size-4" />
        {t("button.newFeedback")}
      </Button>
    </div>
  );
}

// ============================================================
// Loading skeleton
// ============================================================

function FeedbackListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
