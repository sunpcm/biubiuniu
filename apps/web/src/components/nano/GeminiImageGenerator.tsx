// [CUSTOM: START] - Gemini AI image generator component (Nano feature)
"use client";

import { Button } from "@niu/ui/button";
import { Card, CardContent } from "@niu/ui/card";
import { Textarea } from "@niu/ui/textarea";
import { downloadBase64File } from "@/lib/downloadFile";
import { AlertTriangle, Download, ImageIcon, Loader2, Sparkles, Upload, X } from "lucide-react";
import Image from "next/image";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useUserBenefits } from "@/hooks/useUserBenefits";
import { ExampleSelector } from "./ExampleSelector";
import { useAuth } from "@/components/providers/AuthProvider";

export default function GeminiImageGenerator() {
  const t = useTranslations("Nano");
  const { user } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { benefits, optimisticDeduct } = useUserBenefits();

  // 显示登录提示 toast
  useEffect(() => {
    if (!user) {
      const timer = setTimeout(() => {
        toast.info(t("ui.loginPrompt.message"), {
          duration: 5000,
          position: "top-center",
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [user, t]);

  const handleSelectExample = async (examplePrompt: string, imageUrl?: string) => {
    // 未登录用户可以看到案例但不能选择
    if (!user) {
      toast.warning(t("ui.errors.loginRequired"));
      return;
    }

    // 先设置loading状态
    setImageLoading(true);

    // 设置提示词
    setPrompt(examplePrompt);

    // 如果有示例图片，加载它
    if (imageUrl) {
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const file = new File([blob], "example-image.jpg", {
          type: "image/jpeg",
        });

        setSelectedImage(file);
        setImagePreview(imageUrl);

        toast.success(t("ui.exampleSelector.caseLoaded"));
      } catch (error) {
        console.error("Failed to load example image:", error);
        toast.error(t("ui.exampleSelector.imageLoadFailed"));
      } finally {
        setImageLoading(false);
      }
    } else {
      // 如果没有输入图片，清空上传区域
      setSelectedImage(null);
      setImagePreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setImageLoading(false);
      toast.success(t("ui.exampleSelector.caseLoadedNoImage"));
    }
  };

  const handleSubmit = async () => {
    // 检查是否已登录
    if (!user) {
      toast.error(t("ui.errors.loginRequired"));
      return;
    }

    if (!prompt.trim()) {
      toast.error(t("ui.errors.noPrompt"));
      return;
    }

    if (!selectedImage) {
      toast.error(t("ui.errors.noImage"));
      return;
    }

    // Check if user has enough credits
    if (!benefits || benefits.totalAvailableCredits < 1) {
      toast.error(t("ui.errors.insufficientCredits"));
      return;
    }

    setLoading(true);
    setImages([]);
    setError(null);

    try {
      // Convert image to base64
      const imageBase64 = await fileToBase64(selectedImage);

      const response = await fetch("/api/nano/gemini-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          image: imageBase64,
          mimeType: selectedImage.type,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`);
      }

      if (!result.success) {
        throw new Error(result.error || "Failed to generate image");
      }

      if (result.data?.images && result.data.images.length > 0) {
        setImages(result.data.images);
        toast.success(t("ui.results.success", { count: result.data.images.length }));
        // 只有在成功时才进行乐观更新（因为后端已经扣除了积分）
        optimisticDeduct(1);
      } else {
        throw new Error("API did not return any images.");
      }
    } catch (err: any) {
      console.error("API call failed:", err);
      const errorMessage = err.message || "Failed to generate image.";
      setError(errorMessage);
      toast.error(errorMessage);
      // 如果失败，不需要回滚，因为我们没有预先扣除积分
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDownload = (imageData: string, index: number) => {
    downloadBase64File(imageData, `gemini-generated-image-${index + 1}.png`);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data:image/jpeg;base64, or data:image/png;base64, prefix
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        toast.error(t("ui.errors.invalidFile"));
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error(t("ui.errors.fileTooLarge"));
        return;
      }

      setImageLoading(true);
      setSelectedImage(file);

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string);
        setImageLoading(false);
      };
      reader.onerror = () => {
        toast.error(t("ui.imageLoading.failed"));
        setImageLoading(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setImageLoading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="mb-2 text-xl font-bold">{t("subTitle")}</h2>
        <p className="text-muted-foreground mb-6 text-sm">{t("subDescription")}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4">
          {/* Example Selector */}
          <ExampleSelector
            onSelectExample={handleSelectExample}
            disabled={!user}
            loading={imageLoading}
          />

          {/* Image Upload Section */}
          <div>
            <label className="mb-2 block text-sm font-medium">{t("ui.uploadSection.title")}</label>
            {imageLoading ? (
              <div className="bg-muted flex h-64 flex-col items-center justify-center rounded-md border">
                <Loader2 className="text-primary mb-3 h-8 w-8 animate-spin" />
                <span className="text-muted-foreground text-sm">
                  {t("ui.imageLoading.loading")}
                </span>
              </div>
            ) : imagePreview ? (
              <div className="relative h-64 overflow-hidden rounded-md border">
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 z-10 h-7 w-7"
                  onClick={handleRemoveImage}
                >
                  <X className="h-4 w-4" />
                </Button>
                <Image
                  src={imagePreview}
                  alt="Selected image"
                  className="object-contain"
                  fill
                  onLoad={() => setImageLoading(false)}
                  onError={() => setImageLoading(false)}
                />
                <div className="absolute right-2 bottom-2 left-2">
                  <div className="rounded bg-black/50 px-2 py-1 text-xs text-white">
                    {selectedImage?.name} ({((selectedImage?.size || 0) / 1024 / 1024).toFixed(2)}{" "}
                    MB)
                  </div>
                </div>
              </div>
            ) : (
              <label className="hover:border-primary/50 flex h-64 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-8 transition-colors">
                <Upload className="text-muted-foreground mb-4 h-10 w-10" />
                <span className="text-muted-foreground text-center text-sm">
                  {t("ui.uploadSection.placeholder")}
                  <br />
                  {t("ui.uploadSection.supportedFormats")}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                  aria-label="Upload image file"
                />
              </label>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">{t("ui.promptSection.title")}</label>
            <Textarea
              placeholder={user ? t("ui.promptSection.placeholder") : t("ui.loginPrompt.message")}
              className="min-h-24 resize-none"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading || !user}
              readOnly={!user}
            />
            {!user && (
              <p className="mt-1 rounded border border-orange-200 bg-orange-50 p-1.5 text-xs text-orange-600 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400">
                {t("ui.errors.loginRequired")}
              </p>
            )}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={
              !!(
                loading ||
                !prompt.trim() ||
                !selectedImage ||
                !user ||
                (benefits && benefits.totalAvailableCredits < 1)
              )
            }
            className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("ui.buttons.transforming")}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                {t("ui.buttons.transform")}
                {user && (
                  <span className="flex h-full flex-col items-center justify-center pl-2">
                    ♥️ × {benefits?.totalAvailableCredits ?? 0}
                  </span>
                )}
              </>
            )}
          </Button>

          {!user && (
            <p className="rounded-md border border-orange-200 bg-orange-50 p-2 text-center text-xs text-orange-600 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-400">
              {t("ui.loginPrompt.title")}
            </p>
          )}
        </div>

        <div className="lg:col-span-2">
          <label className="mb-2 block text-sm font-medium">{t("ui.results.title")}</label>
          <Card className="h-[calc(100%-28px)]">
            <CardContent className="flex h-full flex-col items-center justify-center p-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center text-center">
                  <Loader2 className="text-primary mb-2 h-8 w-8 animate-spin" />
                  <p className="text-muted-foreground text-sm">{t("ui.results.creating")}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("ui.results.creatingSubtext")}
                  </p>
                </div>
              ) : error ? (
                <div className="text-destructive flex flex-col items-center justify-center text-center">
                  <AlertTriangle className="mb-2 h-8 w-8" />
                  <p className="text-sm font-medium">{t("ui.results.failed")}</p>
                  <p className="mt-1 px-4 text-xs">{error}</p>
                </div>
              ) : images.length > 0 ? (
                <div className="flex h-full w-full flex-col">
                  <div className="flex-1 space-y-4 overflow-auto">
                    {images.map((imageData, index) => (
                      <div key={index} className="overflow-hidden rounded-md border">
                        <div className="relative aspect-video">
                          <div className="absolute top-1 left-1 z-10 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                            {t("ui.results.imageNumber", { number: index + 1 })}
                          </div>
                          <Image
                            src={`data:image/png;base64,${imageData}`}
                            alt={`Transformed image ${index + 1}`}
                            className="bg-muted object-contain"
                            fill
                            priority
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-end gap-2 border-t pt-3">
                    {images.map((imageData, index) => (
                      <Button
                        key={index}
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(imageData, index)}
                      >
                        <Download className="mr-1 h-4 w-4" />
                        {t("ui.buttons.download")} {index + 1}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground flex h-full items-center justify-center text-center">
                  <div className="flex flex-col items-center space-y-4">
                    <ImageIcon className="text-muted-foreground/50 h-12 w-12" />
                    <div className="space-y-2">
                      <p className="text-lg font-medium">{t("ui.results.ready")}</p>
                      <p className="max-w-md text-sm">{t("ui.results.readySubtext")}</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
// [CUSTOM: END]
