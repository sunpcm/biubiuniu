import React from "react";

import { cn } from "./cn.js";

const variants = {
  gray: "bg-gray-700 text-white fill-white",
  "gray-subtle": "bg-gray-200 text-gray-950 fill-gray-950",
  blue: "bg-blue-700 text-white fill-white",
  "blue-subtle": "bg-blue-200 text-blue-900 fill-blue-900",
  purple: "bg-purple-700 text-white fill-white",
  "purple-subtle": "bg-purple-200 text-purple-900 fill-purple-900",
  amber: "bg-amber-700 text-black fill-black",
  "amber-subtle": "bg-amber-200 text-amber-900 fill-amber-900",
  red: "bg-red-700 text-white fill-white",
  "red-subtle": "bg-red-200 text-red-900 fill-red-900",
  pink: "bg-pink-700 text-white fill-white",
  "pink-subtle": "bg-pink-300 text-pink-900 fill-pink-900",
  green: "bg-green-700 text-white fill-white",
  "green-subtle": "bg-green-200 text-green-900 fill-green-900",
  teal: "bg-teal-700 text-white fill-white",
  "teal-subtle": "bg-teal-300 text-teal-900 fill-teal-900",
  inverted: "bg-gray-950 text-gray-100 fill-gray-100",
  trial: "bg-gradient-to-br from-trial-start to-trial-end text-white fill-white",
  turbo: "bg-gradient-to-br from-turbo-start to-turbo-end text-white fill-white",
  pill: "bg-background text-foreground fill-foreground border border-gray-alpha-400",
};

const sizes = {
  sm: "text-[11px] h-5 px-1.5 tracking-[0.2px] gap-[3px] [&_svg]:size-[11px]",
  md: "text-[12px] h-6 px-2.5 tracking-normal gap-1 [&_svg]:size-[14px]",
  lg: "text-[14px] h-8 px-3 tracking-normal gap-1.5 [&_svg]:size-[16px]",
};

type BadgeLinkComponent = React.ElementType<{
  href: string;
  className?: string;
  children?: React.ReactNode;
}>;

interface BadgeProps {
  children?: React.ReactNode;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  capitalize?: boolean;
  icon?: React.ReactNode;
  as?: BadgeLinkComponent;
  href?: string;
}

const Content = ({ icon, children }: Pick<BadgeProps, "icon" | "children">) => (
  <>
    {icon && <span className="inline-flex items-center justify-center">{icon}</span>}
    {children}
  </>
);

export const Badge = ({
  children,
  variant = "gray",
  size = "md",
  capitalize = true,
  icon,
  as,
  href,
}: BadgeProps) => {
  const className = cn(
    "inline-flex shrink-0 items-center justify-center rounded-[9999px] font-sans font-medium whitespace-nowrap tabular-nums",
    capitalize && "capitalize",
    variants[variant],
    sizes[size],
  );

  if (href) {
    const LinkComponent = as ?? "a";

    return (
      <LinkComponent
        className={cn(className, "no-underline!")}
        href={href}
      >
        <Content icon={icon}>
          {children}
        </Content>
      </LinkComponent>
    );
  }

  return (
    <div className={className}>
      <Content icon={icon}>
        {children}
      </Content>
    </div>
  );
};
