import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline" | "primary";

const variants: Record<Variant, string> = {
  default: "bg-foreground text-background",
  secondary: "bg-secondary text-secondary-foreground",
  outline: "border border-border text-muted-foreground",
  primary: "bg-primary/15 text-foreground border border-primary/30",
};

export function Badge({
  className,
  variant = "secondary",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
