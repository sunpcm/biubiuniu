// [CUSTOM: START] - Nano AI example case selector component
"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@niu/ui/button";
import { Card, CardContent } from "@niu/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@niu/ui/hover-card";
import { Badge } from "@niu/ui/badge";
import Image from "next/image";
import { getAllCases, getCaseById, type NanoCase } from "@/lib/nanoCases";
import { ExternalLink, User, Wand2, ChevronDown, Check, Search, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCaseStats } from "@/hooks/useCaseStats";

interface ExampleSelectorProps {
  onSelectExample: (prompt: string, imageUrl?: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

export function ExampleSelector({
  onSelectExample,
  disabled = false,
  loading = false,
}: ExampleSelectorProps) {
  const t = useTranslations("Nano");
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const allCases = getAllCases();
  const { topCases, recordCaseSelection } = useCaseStats();

  // 根据搜索查询过滤案例
  const filteredCases = allCases.filter(
    (nanoCase) =>
      nanoCase.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      nanoCase.author?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      nanoCase.prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
      nanoCase.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // 重置高亮索引当过滤结果改变时
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchQuery]);

  // 键盘导航处理
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || disabled) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < filteredCases.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredCases.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filteredCases.length) {
          handleSelectCase(filteredCases[highlightedIndex].id);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setSearchQuery("");
        setHighlightedIndex(-1);
        break;
    }
  };

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery(""); // 关闭时清空搜索
        setHighlightedIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // 打开下拉菜单时自动聚焦搜索框
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleSelectCase = async (caseId: string) => {
    // 如果未登录或正在loading，不执行选择逻辑
    if (disabled || loading) {
      return;
    }

    setSelectedCaseId(caseId);
    setIsOpen(false);
    setSearchQuery(""); // 选择后清空搜索
    setHighlightedIndex(-1);
    const selectedCase = getCaseById(caseId);
    if (selectedCase) {
      // 记录案例选择统计
      await recordCaseSelection(caseId);

      // 使用第一张输入图片作为默认图片
      const imageUrl = selectedCase.inputImages[0];
      onSelectExample(selectedCase.prompt, imageUrl);
    }
  };

  // 判断案例是否为热门案例
  const isHotCase = (caseId: string) => {
    return topCases.includes(caseId);
  };

  // 获取选中案例的名称
  const getSelectedCaseName = () => {
    if (!selectedCaseId) return null;
    const selectedCase = getCaseById(selectedCaseId);
    return selectedCase?.name;
  };

  const ExamplePreview = ({ nanoCase }: { nanoCase: NanoCase }) => (
    <Card className="max-h-96 w-80 overflow-y-auto border shadow-lg">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* 头部信息 */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-foreground truncate text-sm font-semibold">{nanoCase.name}</h3>
                {isHotCase(nanoCase.id) && <span className="text-sm">🔥</span>}
              </div>
              {nanoCase.author && (
                <div className="mb-2 flex items-center gap-1">
                  <User className="text-muted-foreground h-3 w-3 flex-shrink-0" />
                  <span className="text-muted-foreground truncate text-xs">{nanoCase.author}</span>
                  {nanoCase.url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-1 h-4 w-4 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(nanoCase.url, "_blank");
                      }}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              )}
              {nanoCase.description && (
                <p className="text-muted-foreground mb-2 text-xs leading-relaxed">
                  {nanoCase.description}
                </p>
              )}
            </div>
          </div>

          {/* 输入图片预览 */}
          {nanoCase.inputImages.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                  {t("ui.exampleSelector.inputExample")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {nanoCase.inputImages.slice(0, 2).map((imageUrl, index) => (
                  <div
                    key={index}
                    className="bg-muted relative aspect-square overflow-hidden rounded border"
                  >
                    <Image
                      src={imageUrl}
                      alt={`${nanoCase.name} 输入 ${index + 1}`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 160px) 100vw, 160px"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 输出图片预览 */}
          {nanoCase.outputImages.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                <span className="text-xs font-medium text-green-700 dark:text-green-300">
                  {t("ui.exampleSelector.outputExample")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {nanoCase.outputImages.slice(0, 2).map((imageUrl, index) => (
                  <div
                    key={index}
                    className="bg-muted relative aspect-square overflow-hidden rounded border"
                  >
                    <Image
                      src={imageUrl}
                      alt={`${nanoCase.name} 输出 ${index + 1}`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 160px) 100vw, 160px"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 提示词区域 */}
          <div className="space-y-2 border-t pt-2">
            <div className="flex items-center gap-1">
              <Wand2 className="h-3 w-3 text-purple-600 dark:text-purple-400" />
              <span className="text-xs font-medium text-purple-700 dark:text-purple-300">
                {t("ui.exampleSelector.prompt")}
              </span>
            </div>
            <div className="bg-muted text-foreground max-h-16 overflow-y-auto rounded p-2 text-xs leading-relaxed">
              {nanoCase.prompt}
            </div>
          </div>

          {/* 注意事项 */}
          {nanoCase.notes && (
            <div className="border-t pt-2">
              <Badge variant="secondary" className="text-xs">
                💡 {nanoCase.notes}
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{t("ui.exampleSelector.title")}</label>

      {/* 自定义下拉菜单 */}
      <div ref={dropdownRef} className="relative" onKeyDown={handleKeyDown}>
        <Button
          variant="outline"
          className="w-full justify-between"
          onClick={() => !disabled && !loading && setIsOpen(!isOpen)}
          disabled={disabled || loading}
        >
          <span className="truncate">
            {loading
              ? t("ui.exampleSelector.loading")
              : getSelectedCaseName() ||
                (disabled
                  ? t("ui.exampleSelector.loginRequired")
                  : t("ui.exampleSelector.placeholder"))}
          </span>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          )}
        </Button>

        {/* 下拉内容 */}
        {isOpen && !disabled && !loading && (
          <div className="bg-popover absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-hidden rounded-md border shadow-md">
            {/* 搜索框 */}
            <div className="bg-background/95 sticky top-0 border-b p-3">
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={t("ui.exampleSelector.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-md border py-2 pr-3 pl-10 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setHighlightedIndex(-1);
                      searchInputRef.current?.focus();
                    }}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transform"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* 案例列表 */}
            <div className="max-h-60 overflow-y-auto">
              {filteredCases.length === 0 ? (
                <div className="text-muted-foreground px-3 py-6 text-center text-sm">
                  {t("ui.exampleSelector.noResults")}
                </div>
              ) : (
                filteredCases.map((nanoCase, index) => (
                  <HoverCard key={nanoCase.id} openDelay={200} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <button
                        type="button"
                        className={`hover:bg-accent hover:text-accent-foreground group border-border/50 flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                          highlightedIndex === index ? "bg-accent text-accent-foreground" : ""
                        }`}
                        onClick={() => handleSelectCase(nanoCase.id)}
                        onMouseEnter={() => setHighlightedIndex(index)}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          {String(index + 1).padStart(2, "0")}.
                          <span className="truncate">{nanoCase.name}</span>
                          {isHotCase(nanoCase.id) && (
                            <span className="flex-shrink-0 animate-pulse text-xs">🔥</span>
                          )}
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {nanoCase.author && (
                            <span className="text-muted-foreground max-w-20 truncate text-xs">
                              {nanoCase.author}
                            </span>
                          )}
                          {selectedCaseId === nanoCase.id && (
                            <Check className="text-primary h-4 w-4" />
                          )}
                        </div>
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent
                      side="right"
                      align="start"
                      className="z-[60] w-fit p-0"
                      sideOffset={10}
                    >
                      <ExamplePreview nanoCase={nanoCase} />
                    </HoverCardContent>
                  </HoverCard>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {selectedCaseId && !disabled && (
        <div className="text-muted-foreground text-xs">{t("ui.exampleSelector.selectedHint")}</div>
      )}

      {disabled && (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-2 text-xs text-orange-600 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400">
          {t("ui.exampleSelector.loginHint")}
        </div>
      )}
    </div>
  );
}
// [CUSTOM: END]
