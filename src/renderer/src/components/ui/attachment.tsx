import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// shadcn "Attachment" — a file or image attachment with media, metadata,
// upload state, and actions. Adapted to the CheveluAI tokens.

type AttachmentState = "idle" | "uploading" | "processing" | "error" | "done";

const AttachmentStateContext = React.createContext<AttachmentState>("done");

const attachmentVariants = cva(
  "group/attachment relative flex rounded-xl border border-border bg-card text-left transition-colors",
  {
    variants: {
      size: {
        default: "gap-3 p-2.5",
        sm: "gap-2.5 p-2",
        xs: "gap-2 p-1.5",
      },
      orientation: {
        horizontal: "flex-row items-center",
        vertical: "flex-col items-stretch",
      },
      state: {
        idle: "",
        uploading: "",
        processing: "",
        done: "",
        error: "border-destructive/50 bg-destructive/5",
      },
    },
    defaultVariants: {
      size: "default",
      orientation: "horizontal",
      state: "done",
    },
  },
);

function Attachment({
  className,
  size,
  orientation,
  state = "done",
  ...props
}: React.ComponentProps<"div"> &
  Omit<VariantProps<typeof attachmentVariants>, "state"> & {
    state?: AttachmentState;
  }) {
  return (
    <AttachmentStateContext.Provider value={state}>
      <div
        data-slot="attachment"
        data-state={state}
        className={cn(attachmentVariants({ size, orientation, state }), className)}
        {...props}
      />
    </AttachmentStateContext.Provider>
  );
}

const mediaVariants = cva(
  "flex shrink-0 items-center justify-center overflow-hidden rounded-lg [&_svg]:size-5",
  {
    variants: {
      variant: {
        icon: "size-10 bg-muted text-muted-foreground",
        image: "size-10 bg-muted [&_img]:size-full [&_img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "icon",
    },
  },
);

function AttachmentMedia({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof mediaVariants>) {
  return (
    <div
      data-slot="attachment-media"
      className={cn(mediaVariants({ variant }), className)}
      {...props}
    />
  );
}

function AttachmentContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn("flex min-w-0 flex-1 flex-col justify-center gap-0.5", className)}
      {...props}
    />
  );
}

function AttachmentTitle({ className, ...props }: React.ComponentProps<"div">) {
  const state = React.useContext(AttachmentStateContext);
  const loading = state === "uploading" || state === "processing";
  return (
    <div
      data-slot="attachment-title"
      className={cn(
        "truncate text-[13px] font-medium text-foreground",
        loading && "shimmer",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const state = React.useContext(AttachmentStateContext);
  return (
    <div
      data-slot="attachment-description"
      className={cn(
        "truncate text-[11px] text-muted-foreground",
        state === "error" && "text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn("relative z-10 flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}

function AttachmentAction({
  className,
  variant = "ghost",
  size = "icon-xs",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="attachment-action"
      variant={variant}
      size={size}
      className={cn(className)}
      {...props}
    />
  );
}

function AttachmentTrigger({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="attachment-trigger"
      className={cn(
        "absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-group"
      className={cn(
        "flex snap-x snap-mandatory gap-2 overflow-x-auto [&>*]:snap-start [&>*]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
  AttachmentGroup,
};
