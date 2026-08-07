import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-xs";

// A near-black (or, in dark mode, near-white) solid does not react to a
// brightness filter, so the filled variants dim on hover instead.
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90 active:opacity-80 font-medium",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-accent",
  outline:
    "border border-input bg-transparent hover:bg-accent text-foreground",
  ghost: "hover:bg-accent text-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-6 text-base gap-2",
  icon: "h-9 w-9",
  "icon-sm": "size-8",
  "icon-xs": "size-6",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-md whitespace-nowrap transition-[background,color,opacity] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none select-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
