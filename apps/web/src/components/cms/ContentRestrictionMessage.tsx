import { Button } from "@/components/ui/button";
import { Link as I18nLink } from "@/i18n/routing";
import { ArrowLeftIcon, ArrowRightIcon, LockIcon } from "lucide-react";

interface ContentRestrictionMessageProps {
  title: string;
  message: string;
  actionText?: string;
  actionLink?: string;
  backText: string;
  backLink: string;
}

export function ContentRestrictionMessage({
  title,
  message,
  actionText,
  actionLink,
  backText,
  backLink,
}: ContentRestrictionMessageProps) {
  return (
    <div className="bg-secondary/30 border-border/50 my-10 flex flex-col items-center justify-center rounded-2xl border px-4 py-16">
      <div className="bg-background border-border/50 mb-6 rounded-full border p-4 shadow-sm">
        <LockIcon className="text-muted-foreground h-8 w-8" />
      </div>

      <h2 className="mb-3 text-center text-2xl font-semibold tracking-tight">{title}</h2>

      <p className="text-muted-foreground mb-8 max-w-md text-center text-base leading-relaxed">
        {message}
      </p>

      <div className="flex w-full max-w-sm flex-col items-center gap-3 sm:flex-row">
        {actionText && actionLink ? (
          <>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="bg-background hover:bg-accent/50 w-full sm:flex-1"
            >
              <I18nLink
                href={backLink}
                title={backText}
                prefetch={false}
                className="inline-flex items-center justify-center gap-2"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                {backText}
              </I18nLink>
            </Button>
            <Button asChild size="lg" className="w-full font-medium sm:flex-1">
              <I18nLink
                href={actionLink}
                title={actionText}
                prefetch={false}
                className="inline-flex items-center justify-center gap-2"
              >
                {actionText}
                <ArrowRightIcon className="h-4 w-4" />
              </I18nLink>
            </Button>
          </>
        ) : (
          <Button asChild variant="default" size="lg" className="w-full min-w-[200px] sm:w-auto">
            <I18nLink
              href={backLink}
              title={backText}
              prefetch={false}
              className="inline-flex items-center justify-center gap-2"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              {backText}
            </I18nLink>
          </Button>
        )}
      </div>
    </div>
  );
}
