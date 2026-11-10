"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  NANO_LIST_PAGE_SIZE,
  toNanoClientError,
} from "./contract";
import type {
  NanoClientErrorLike,
  NanoTaskList,
  NanoTaskSummary,
} from "./history-types";

export interface NanoHistoryApi {
  list(options?: {
    pageSize?: number;
    nextCursor?: string;
    signal?: AbortSignal;
  }): Promise<NanoTaskList>;
  get(taskId: string, options?: { signal?: AbortSignal }): Promise<unknown>;
}

interface NanoTaskHistoryProps {
  api: NanoHistoryApi;
  selectedTaskId: string | null;
  disabled?: boolean;
  canRead: boolean;
  sessionUserId: string | null;
  onSelect: (task: NanoTaskSummary) => void;
  onCancel: (taskId: string) => void;
  onRefresh: () => void;
  onError: (error: NanoClientErrorLike) => void;
  refreshToken: number;
}

/** Bounded cursor history: no full-table fetch, no image payload in list rows. */
export function NanoTaskHistory({
  api,
  selectedTaskId,
  disabled = false,
  canRead,
  sessionUserId,
  onSelect,
  onCancel,
  onRefresh,
  onError,
  refreshToken,
}: NanoTaskHistoryProps) {
  const t = useTranslations("Landing.Nano.ui.history");
  const [tasks, setTasks] = useState<NanoTaskSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const sessionUserRef = useRef<string | null>(sessionUserId);

  const load = useCallback(
    async (cursor?: string) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const page = await api.list({
          pageSize: NANO_LIST_PAGE_SIZE,
          ...(cursor ? { nextCursor: cursor } : {}),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setTasks((previous) =>
          cursor
            ? [
                ...previous,
                ...page.tasks.filter(
                  (item) =>
                    !previous.some((existing) => existing.taskId === item.taskId),
                ),
              ]
            : page.tasks,
        );
        setNextCursor(page.nextCursor);
      } catch (error) {
        if (!controller.signal.aborted) onError(toNanoClientError(error));
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [api, onError],
  );

  useEffect(() => {
    if (sessionUserRef.current !== sessionUserId) {
      sessionUserRef.current = sessionUserId;
      requestRef.current?.abort();
      requestRef.current = null;
      setTasks([]);
      setNextCursor(null);
      setLoading(false);
      setLoadingMore(false);
    }
    if (!canRead) return;
    void load();
    return () => requestRef.current?.abort();
  }, [canRead, load, refreshToken, sessionUserId]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canRead || loading}
          onClick={() => {
            if (!canRead) return;
            onRefresh();
            void load();
          }}
        >
          {t("refresh")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && tasks.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        )}
        {!loading && tasks.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        )}
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.taskId}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 ${
                task.taskId === selectedTaskId ? "border-primary" : ""
              }`}
            >
              <div className="min-w-0 space-y-1">
                <button
                  type="button"
                  className="max-w-56 truncate font-mono text-xs underline-offset-2 hover:underline"
                  onClick={() => onSelect(task)}
                  title={task.taskId}
                >
                  {task.taskId}
                </button>
                <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">
                    {t(`status.${task.status}`)}
                  </Badge>
                  <span>{t("createdAt", { time: task.createdAt })}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onSelect(task)}
                >
                  {t("open")}
                </Button>
                {task.status === "queued" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={disabled}
                    onClick={() => onCancel(task.taskId)}
                  >
                    {t("cancel")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {nextCursor && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!canRead || loadingMore}
            onClick={() => {
              if (!canRead || !nextCursor) return;
              void load(nextCursor);
            }}
          >
            {loadingMore ? t("loading") : t("loadMore")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
