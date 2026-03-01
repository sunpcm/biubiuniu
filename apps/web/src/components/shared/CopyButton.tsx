"use client";

import { cn } from "@/lib/utils";
import { Check, Copy, CopyCheck } from "lucide-react";
import { useCallback, useState } from "react";

/**
 * A unified copy-to-clipboard button with three visual variants:
 *
 * - `"icon"`   (default) — icon only, no label. Uses CopyCheck on success.
 * - `"ghost"`  — icon + text label ("Copy" / "Copied"), ghost button style.
 * - `"bubble"` — small floating icon button, typically shown on group hover.
 */
export type CopyButtonVariant = "icon" | "ghost" | "bubble";

interface CopyButtonProps {
  /** The text to copy to clipboard. */
  text: string;
  /** Additional CSS classes. */
  className?: string;
  /** Visual style variant. Defaults to "icon". */
  variant?: CopyButtonVariant;
  /** Label shown next to the icon in "ghost" variant. Defaults to "Copy". */
  label?: string;
  /** Milliseconds before the copied state resets. Defaults to 2000. */
  resetDelay?: number;
}

const CopyButton = ({
  text,
  className,
  variant = "icon",
  label = "Copy",
  resetDelay = 2000,
}: CopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);

  const copy = useCallback(() => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), resetDelay);
    });
  }, [text, resetDelay]);

  if (variant === "ghost") {
    return (
      <button
        onClick={copy}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs",
          "hover:bg-accent transition-colors",
          isCopied ? "text-green-500" : "text-muted-foreground",
          className,
        )}
      >
        {isCopied ? (
          <>
            <Check className="h-3 w-3" />
            <span>Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            <span>{label}</span>
          </>
        )}
      </button>
    );
  }

  if (variant === "bubble") {
    return (
      <button
        onClick={copy}
        className={cn(
          "bg-background hover:bg-muted rounded-md border p-1 shadow-sm transition-colors",
          className,
        )}
      >
        {isCopied ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="text-muted-foreground h-3 w-3" />
        )}
      </button>
    );
  }

  // "icon" variant — original MDX code block style
  return (
    <button className={className} onClick={copy}>
      {isCopied ? (
        <CopyCheck className="text-muted-foreground h-4 w-4" />
      ) : (
        <Copy className="text-muted-foreground h-4 w-4" />
      )}
    </button>
  );
};

export default CopyButton;
