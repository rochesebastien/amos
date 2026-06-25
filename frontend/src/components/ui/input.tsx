import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-shadow focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
