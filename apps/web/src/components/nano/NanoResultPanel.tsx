"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { nanoResultImageAlt, nanoResultImageSource } from "./contract";
import { NanoImage } from "./NanoImage";
import type { NanoTask, NanoTaskStatus } from "./types";
import { useTranslations } from "next-intl";

/** Renders the frozen discriminated result union; no guessed string variant. */
export function NanoResultPanel({ task }: { task: NanoTask | null }) {
  const t = useTranslations("Landing.Nano.ui.result");

  if (!task) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {t("empty")}
        </CardContent>
      </Card>
    );
  }

  const images = task.result?.images ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
        <Badge variant="outline">
          {t(`status.${task.status as NanoTaskStatus}`)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>{t("taskId", { id: task.taskId })}</span>
          <span>{t("cost", { cost: task.cost })}</span>
          <span>{t("updatedAt", { time: task.updatedAt })}</span>
        </div>

        {task.status === "unknown" && (
          <p role="status" className="border-warning text-warning-foreground rounded-md border p-3 text-sm">
            {t("unknown")}
          </p>
        )}
        {task.status === "failed" && (
          <p role="alert" className="text-destructive text-sm">
            {t("failed")}
          </p>
        )}
        {task.status === "canceled" && (
          <p role="status" className="text-muted-foreground text-sm">
            {t("canceled")}
          </p>
        )}

        {images.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {images.map((image, index) => {
              const source = nanoResultImageSource(image);
              return (
                <div
                  key={`${task.taskId}:${index}`}
                  className="bg-muted relative aspect-square overflow-hidden rounded-md"
                >
                  {source ? (
                    <NanoImage
                      src={source}
                      alt={nanoResultImageAlt(image, index)}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="text-destructive flex h-full items-center justify-center p-4 text-center text-xs">
                      {t("unsafeResultUrl")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noImages")}</p>
        )}

        {task.result?.text && (
          <div className="space-y-1">
            <div className="text-sm font-medium">{t("text")}</div>
            <p className="bg-muted rounded-md p-3 whitespace-pre-wrap text-sm">
              {task.result.text}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
