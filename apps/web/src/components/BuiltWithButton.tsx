import { buttonVariants } from "@niu/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

// BiuBiuNiu Affiliate Link: https://biubiuniu.com/
// sign up and use your affiliate link on BuiltWithButton to earn money

export default function BuiltWithButton() {
  return (
    <Link
      href="https://biubiuniu.com"
      title="Built with BiuBiuNiu"
      prefetch={false}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "rounded-md border-gray-500 bg-transparent px-4 text-white hover:bg-gray-950 hover:text-gray-100",
      )}
    >
      <span>Built with</span>
      <span>
        <LogoNiu className="size-4 rounded-full" />
      </span>
      <span className="text-base-content flex items-center gap-0.5 font-bold tracking-tight">
        BiuBiuNiu
      </span>
    </Link>
  );
}

function LogoNiu({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="Logo"
      title="Logo"
      width={96}
      height={96}
      className={cn("size-8 rounded-md", className)}
    />
  );
}
