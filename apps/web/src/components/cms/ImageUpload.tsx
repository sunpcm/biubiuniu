"use client";

import { generateAdminPresignedUploadUrl } from "@/actions/r2-resources";
import { R2ResourceSelector } from "@/components/tiptap/R2ResourceSelector";
import { Button } from "@niu/ui/button";
import { Input } from "@niu/ui/input";
import { BLOGS_IMAGE_PATH } from "@/config/common";
import { getErrorMessage } from "@/lib/error-utils";
import { Cloud, Link, Loader2, Upload, UploadCloud, X } from "lucide-react";
import Image from "next/image";
import { ChangeEvent, useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

interface ImageUploadProps {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  imagePath?: string;
  maxSize?: number;
  r2PublicUrl?: string;
  enableR2Selector?: boolean;
}

export function ImageUpload({
  value,
  onChange,
  disabled,
  imagePath = BLOGS_IMAGE_PATH,
  maxSize = 10 * 1024 * 1024, // 10MB
  r2PublicUrl,
  enableR2Selector = false,
}: ImageUploadProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(value || null);
  const [isLoading, setIsLoading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelected = async (file: File | null) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Upload Error", {
        description: "Invalid file type.",
      });
      return;
    }

    if (file.size > maxSize) {
      toast.error("Upload Error", {
        description: `File size cannot exceed ${maxSize / 1024 / 1024}MB.`,
      });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);

    setIsLoading(true);

    try {
      const filenamePrefix = "featured-image";

      const presignedUrlActionResponse = await generateAdminPresignedUploadUrl({
        fileName: file.name,
        contentType: file.type,
        prefix: filenamePrefix,
        path: imagePath,
      });

      if (!presignedUrlActionResponse.success || !presignedUrlActionResponse.data) {
        setPreviewUrl(null);
        toast.error("Upload Error", {
          description: presignedUrlActionResponse.error || "Failed to generate presigned URL.",
        });
        return "";
      }

      const { presignedUrl, publicObjectUrl } = presignedUrlActionResponse.data;

      const uploadResponse = await fetch(presignedUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      if (!uploadResponse.ok) {
        let r2Error = "";
        try {
          r2Error = await uploadResponse.text();
        } catch {
          // intentionally empty
        }
        console.error("R2 Upload Error:", r2Error, uploadResponse);
        throw new Error(r2Error);
      }

      onChange(publicObjectUrl);
      toast.success("Upload successful", {
        description: "Your image has been uploaded successfully.",
      });
    } catch (error) {
      setPreviewUrl(null);
      console.error("MDX Image Upload failed:", error);
      toast.error(getErrorMessage(error) || "An unexpected error occurred during upload.");
      throw error;
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles && acceptedFiles.length > 0) {
        handleFileSelected(acceptedFiles[0]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, onChange],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
    },
    multiple: false,
    disabled: disabled || isLoading,
  });

  const handleLegacyFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    handleFileSelected(file || null);
  };

  const handleRemoveImage = async () => {
    setPreviewUrl(null);
    onChange("");
  };

  const handleUrlSubmit = () => {
    const url = urlInputValue.trim();
    if (!url) {
      toast.error("Please enter a URL");
      return;
    }

    // Validate URL format
    try {
      const parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        toast.error("Please enter a valid HTTP or HTTPS URL");
        return;
      }
    } catch {
      toast.error("Please enter a valid URL");
      return;
    }

    setPreviewUrl(url);
    onChange(url);
    setShowUrlInput(false);
    setUrlInputValue("");
    toast.success("Image URL applied");
  };

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={`mt-2 flex flex-col items-center space-y-4 rounded-lg border border-dashed border-gray-300 p-6 transition-colors ${isDragActive ? "border-primary bg-primary/10" : ""} ${
          disabled || isLoading
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:border-gray-400"
        }`}
      >
        <input
          {...getInputProps()}
          id="featured-image-upload"
          ref={fileInputRef}
          onChange={handleLegacyFileChange}
        />
        {isLoading ? (
          <div className="flex h-32 flex-col items-center justify-center">
            <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
            <p className="text-muted-foreground mt-2 text-sm">Uploading...</p>
          </div>
        ) : previewUrl ? (
          <div className="group relative">
            <Image
              src={previewUrl}
              alt="Featured image preview"
              width={1200}
              height={630}
              className="max-h-48 w-auto rounded-md object-contain"
            />
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-1 right-1 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveImage();
              }}
              disabled={disabled}
              aria-label="Remove image"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="text-center">
            <UploadCloud className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm text-gray-600">
              {isDragActive ? "Drop the image here..." : "Drag & drop or click to upload"}
            </p>
            <p className="text-xs text-gray-500">PNG, JPG, WEBP up to 5MB</p>
          </div>
        )}
        {!isLoading && !previewUrl && !showUrlInput && (
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={disabled || isLoading}
              className="mt-4"
            >
              <Upload className="h-4 w-4" />
              Select Image
            </Button>
            {enableR2Selector && r2PublicUrl && (
              <R2ResourceSelector
                onSelect={(url) => {
                  const selectedUrl = Array.isArray(url) ? url[0] : url;
                  setPreviewUrl(selectedUrl);
                  onChange(selectedUrl);
                }}
                r2PublicUrl={r2PublicUrl}
                fileTypeFilter="image"
                multiple={false}
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || isLoading}
                  className="mt-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Cloud className="h-4 w-4" />
                  Select from R2
                </Button>
              </R2ResourceSelector>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setShowUrlInput(true);
              }}
              disabled={disabled || isLoading}
              className="mt-4"
            >
              <Link className="h-4 w-4" />
              Enter URL
            </Button>
          </div>
        )}
        {!isLoading && !previewUrl && showUrlInput && (
          <div className="flex w-full max-w-md flex-col gap-2" onClick={(e) => e.stopPropagation()}>
            <Input
              type="url"
              placeholder="https://example.com/image.jpg"
              value={urlInputValue}
              onChange={(e) => setUrlInputValue(e.target.value)}
              disabled={disabled}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleUrlSubmit();
                }
              }}
            />
            <div className="flex justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowUrlInput(false);
                  setUrlInputValue("");
                }}
                disabled={disabled}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleUrlSubmit}
                disabled={disabled || !urlInputValue.trim()}
              >
                Apply URL
              </Button>
            </div>
          </div>
        )}
        {!isLoading && previewUrl && !showUrlInput && (
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={disabled || isLoading}
              className="mt-4"
            >
              Change Image
            </Button>
            {enableR2Selector && r2PublicUrl && (
              <R2ResourceSelector
                onSelect={(url) => {
                  const selectedUrl = Array.isArray(url) ? url[0] : url;
                  setPreviewUrl(selectedUrl);
                  onChange(selectedUrl);
                }}
                r2PublicUrl={r2PublicUrl}
                fileTypeFilter="image"
                multiple={false}
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || isLoading}
                  className="mt-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Cloud className="mr-2 h-4 w-4" />
                  Select from R2
                </Button>
              </R2ResourceSelector>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setShowUrlInput(true);
              }}
              disabled={disabled || isLoading}
              className="mt-4"
            >
              <Link className="mr-2 h-4 w-4" />
              Enter URL
            </Button>
          </div>
        )}
        {!isLoading && previewUrl && showUrlInput && (
          <div
            className="mt-4 flex w-full max-w-md flex-col gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <Input
              type="url"
              placeholder="https://example.com/image.jpg"
              value={urlInputValue}
              onChange={(e) => setUrlInputValue(e.target.value)}
              disabled={disabled}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleUrlSubmit();
                }
              }}
            />
            <div className="flex justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowUrlInput(false);
                  setUrlInputValue("");
                }}
                disabled={disabled}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleUrlSubmit}
                disabled={disabled || !urlInputValue.trim()}
              >
                Apply URL
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
