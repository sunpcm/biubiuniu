/**
 * [INPUT]: Depends on @/components/ui/card's Card/CardContent, @/lib/utils' cn
 * [OUTPUT]: exports the SectionError component
 * [POS]: The failure state shared by every admin/overview section — one section failing
 *        to fetch affects only itself, the rest render as usual
 * [PROTOCOL]: Update this header on changes, then check CLAUDE.md
 */

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SectionError({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <Card className={cn("py-0", className)}>
      <CardContent className="py-10 text-center text-sm text-destructive">
        {message}
      </CardContent>
    </Card>
  );
}
