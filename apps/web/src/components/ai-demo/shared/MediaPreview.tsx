"use client";

import { Button } from "@niu/ui/button";
import { Card, CardContent } from "@niu/ui/card";
import { downloadBase64File } from "@/lib/downloadFile";
import { Download, ImageIcon, VideoIcon } from "lucide-react";
import Image from "next/image";

interface MediaPreviewProps {
  type: "image" | "video";
  src: string | null;
  alt?: string;
  showDownload?: boolean;
  downloadFileName?: string;
  className?: string;
  emptyText?: string;
}

function downloadVideoFromUrl(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function MediaPreview({
  type,
  src,
  alt = "Generated media",
  showDownload = true,
  downloadFileName,
  className,
  emptyText = "No result yet. Generate something!",
}: MediaPreviewProps) {
  if (!src) {
    return (
      <Card className={`h-full ${className || ""}`}>
        <CardContent className="flex h-full min-h-[200px] flex-col items-center justify-center p-4">
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-center">
            {type === "image" ? (
              <ImageIcon className="h-10 w-10 opacity-30" />
            ) : (
              <VideoIcon className="h-10 w-10 opacity-30" />
            )}
            <p>{emptyText}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleDownload = () => {
    if (type === "image") {
      downloadBase64File(src, downloadFileName || "generated-image.png");
    } else {
      downloadVideoFromUrl(src, downloadFileName || "generated-video.mp4");
    }
  };

  return (
    <Card className={`h-full ${className || ""}`}>
      <CardContent className="flex h-full flex-col p-4">
        <div className="relative min-h-[200px] flex-1">
          {type === "image" ? (
            <Image src={src} alt={alt} className="rounded-md object-contain" fill />
          ) : (
            <video
              src={src}
              controls
              className="h-full w-full rounded-md object-contain"
              autoPlay
              muted
              loop
            >
              Your browser does not support the video tag.
            </video>
          )}
        </div>
        {showDownload && (
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={handleDownload}>
              <Download className="mr-1 h-4 w-4" />
              Download
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
