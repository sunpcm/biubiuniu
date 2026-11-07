"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { nanoCases, type NanoCase } from "@/config/nano-cases";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useMemo, useState } from "react";

interface NanoCaseGalleryProps {
  selectedCaseId?: string;
  topCases?: readonly string[];
  disabled?: boolean;
  onSelect: (caseId: string) => void;
}

/** 47 stable product cases, rendered in source order with search/hot badges. */
export function NanoCaseGallery({
  selectedCaseId,
  topCases = [],
  disabled = false,
  onSelect,
}: NanoCaseGalleryProps) {
  const t = useTranslations("Landing.Nano.ui.cases");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const cases: readonly NanoCase[] = nanoCases;
    if (!needle) return cases;
    return cases.filter((item) =>
      [item.id, item.name, item.author, item.prompt, item.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [query]);

  return (
    <section aria-label={t("title")} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">
            {t("description", { count: nanoCases.length })}
          </p>
        </div>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="sm:max-w-64"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item: NanoCase) => {
          const selected = item.id === selectedCaseId;
          const firstInput = item.inputImages[0];
          const firstOutput = item.outputImages[0] ?? firstInput;
          const thumbnail = firstOutput ?? firstInput;
          return (
            <Card
              key={item.id}
              className={selected ? "border-primary" : undefined}
            >
              <CardContent className="space-y-3 p-3">
                <div className="bg-muted relative aspect-video overflow-hidden rounded-md">
                  {thumbnail ? (
                    <Image
                      src={thumbnail}
                      alt={item.name}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                      {t("noAsset")}
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{item.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {item.id}
                      {item.author ? ` · ${item.author}` : ""}
                    </div>
                  </div>
                  {topCases.includes(item.id) && (
                    <Badge variant="secondary">{t("hot")}</Badge>
                  )}
                </div>
                {item.description && (
                  <p className="text-muted-foreground line-clamp-2 text-xs">
                    {item.description}
                  </p>
                )}
                <div className="text-muted-foreground flex gap-3 text-xs">
                  <span>{t("inputs", { count: item.inputImages.length })}</span>
                  <span>{t("outputs", { count: item.outputImages.length })}</span>
                </div>
                <Button
                  type="button"
                  variant={selected ? "default" : "outline"}
                  size="sm"
                  className="w-full"
                  disabled={disabled}
                  onClick={() => onSelect(item.id)}
                >
                  {selected ? t("selected") : t("select")}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {t("noMatch")}
        </p>
      )}
    </section>
  );
}
