import { ArrowRight } from "lucide-react";

interface FeatureBadgeProps {
  label?: string;
  text?: string;
  href?: string;
  target?: "_blank" | "_self" | "_parent" | "_top";
  rel?: string;
  className?: string;
}

export default function FeatureBadge({
  label,
  text,
  href,
  target = "_self",
  rel = "",
  className = "",
}: FeatureBadgeProps) {
  const content = (
    <div className="hover:bg-muted hover:border-primary/20 group flex items-center gap-x-1 rounded-full border px-1 py-1 pr-1 text-center text-sm font-medium transition-all duration-300 ease-in-out sm:gap-x-2 sm:px-2 sm:pr-2">
      {label && (
        <div className="bg-primary rounded-2xl border px-1 py-0.5 text-[10px] font-semibold tracking-tight whitespace-nowrap text-white sm:px-1.5 sm:text-xs">
          {label}
        </div>
      )}

      {text && <div className="px-1 text-xs sm:px-2 sm:text-sm">{text}</div>}

      {href && (
        <div className="pr-1 transition-transform duration-300 group-hover:translate-x-1 sm:pr-3">
          <ArrowRight name="ArrowRight" className="h-4 w-4 text-gray-400 dark:text-gray-500" />
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <div className={`mb-8 flex ${className}`}>
        <a href={href} target={target} rel={rel} className="inline-flex">
          {content}
        </a>
      </div>
    );
  }

  return <div className={`flex justify-center ${className}`}>{content}</div>;
}
