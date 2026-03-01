"use client";

import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";

interface ImageGridItem {
  src: string;
  alt?: string;
  caption?: string;
  link?: string;
}

export function ImageGridReadOnlyView({ node }: NodeViewProps) {
  const { images, columns: _columns } = node.attrs;

  const handleImageClick = (link?: string) => {
    if (link) {
      window.open(link, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <NodeViewWrapper className="image-grid-wrapper my-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {images.map((image: ImageGridItem, index: number) => (
          <div key={image.src} className="flex flex-col gap-1">
            <div
              className={`bg-background relative flex items-center justify-center overflow-hidden rounded-xl ${
                image.link ? "cursor-pointer transition-opacity hover:opacity-90" : ""
              }`}
              style={{ aspectRatio: "1/1" }}
              onClick={() => handleImageClick(image.link)}
              role={image.link ? "button" : undefined}
              tabIndex={image.link ? 0 : undefined}
              onKeyDown={(e) => {
                if (image.link && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  handleImageClick(image.link);
                }
              }}
            >
              <img
                src={image.src}
                alt={image.alt || `Image ${index + 1}`}
                className="h-full w-full object-contain"
              />
            </div>
            {image.caption && (
              <span
                className={`text-muted-foreground px-1 text-center text-sm leading-tight ${
                  image.link ? "hover:text-foreground cursor-pointer transition-colors" : ""
                }`}
                onClick={() => handleImageClick(image.link)}
                role={image.link ? "button" : undefined}
                tabIndex={image.link ? 0 : undefined}
                onKeyDown={(e) => {
                  if (image.link && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    handleImageClick(image.link);
                  }
                }}
              >
                {image.caption}
              </span>
            )}
          </div>
        ))}
      </div>
    </NodeViewWrapper>
  );
}
