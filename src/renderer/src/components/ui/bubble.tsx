import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn "Bubble" — framed conversational content. Adapted to the AMOS
// palette and tokens. See DESIGN.md / docs/components/bubble.

const bubbleVariants = cva(
  "relative w-fit max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        muted: "bg-muted text-foreground",
        tinted: "bg-primary/15 text-foreground",
        outline: "border border-border bg-card text-foreground",
        ghost: "max-w-none bg-transparent px-0 py-0 text-foreground",
        destructive:
          "border border-destructive/40 bg-destructive/10 text-destructive",
      },
      align: {
        start: "mr-auto rounded-bl-md",
        end: "ml-auto rounded-br-md",
      },
    },
    defaultVariants: {
      variant: "default",
      align: "start",
    },
  },
);

function Bubble({
  className,
  variant,
  align,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof bubbleVariants>) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant ?? "default"}
      data-align={align ?? "start"}
      className={cn(bubbleVariants({ variant, align }), className)}
      {...props}
    />
  );
}

function BubbleContent({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      data-slot="bubble-content"
      className={cn(
        "whitespace-pre-wrap break-words [&:is(a,button)]:cursor-pointer [&:is(a,button)]:outline-none [&:is(a,button)]:focus-visible:ring-2 [&:is(a,button)]:focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

const reactionVariants = cva(
  "absolute z-10 flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs shadow-sm",
  {
    variants: {
      side: {
        top: "-top-3",
        bottom: "-bottom-3",
      },
      align: {
        start: "start-2",
        end: "end-2",
      },
    },
    defaultVariants: {
      side: "bottom",
      align: "end",
    },
  },
);

function BubbleReactions({
  className,
  side,
  align,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof reactionVariants>) {
  return (
    <div
      data-slot="bubble-reactions"
      className={cn(reactionVariants({ side, align }), className)}
      {...props}
    />
  );
}

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  );
}

export { Bubble, BubbleContent, BubbleReactions, BubbleGroup, bubbleVariants };
