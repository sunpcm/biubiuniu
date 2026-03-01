import { cn } from "@/lib/utils";

interface AsideProps {
  icon?: string;
  children?: React.ReactNode;
  type?: "default" | "warning" | "danger";
}

export function Aside({ children, icon, type: _type = "default", ...props }: AsideProps) {
  return (
    <div
      className={cn(
        "ms-md-0 rounded-1 my-10 ms-2 flex rounded border-5 px-4 py-3 shadow-sm",
        "border-[#6edff633] border-l-[#f6ef6e] bg-[#6edff633]",
      )}
      {...props}
    >
      <div className="rounded-1 relative top-[-30px] left-[-30px] h-8 w-8 rounded bg-[#6edff6] text-center text-2xl">
        {icon || "💡"}
      </div>
      <div>{children}</div>
    </div>
  );
}
