import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn "Marker" — inline conversation markers: status updates, system notes,
// bordered rows, and labeled separators.

const markerVariants = cva(
  "flex items-center gap-2 text-[13px] text-muted-foreground",
  {
    variants: {
      variant: {
        default: "",
        border: "border-b border-border pb-2",
        separator:
          "justify-center text-center before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Marker({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof markerVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      data-slot="marker"
      data-variant={variant ?? "default"}
      className={cn(
        markerVariants({ variant }),
        asChild &&
          "cursor-pointer outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center text-current [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn("min-w-0", className)}
      {...props}
    />
  );
}

export { Marker, MarkerIcon, MarkerContent, markerVariants };
