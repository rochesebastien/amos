import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "h-9 w-full appearance-none rounded-md border border-input bg-card pl-3 pr-9 text-sm text-foreground outline-none transition-shadow focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
  </div>
));
Select.displayName = "Select";

export const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="flex flex-col gap-1.5">
    <span className="text-[13px] text-muted-foreground">{label}</span>
    {children}
    {hint && <span className="text-[12px] text-muted-foreground/70">{hint}</span>}
  </label>
);
