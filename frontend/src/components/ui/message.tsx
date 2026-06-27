import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn "Message" — row layout for a single conversation message: avatar,
// alignment, header, and footer around the message surface (a Bubble).

const messageVariants = cva("flex w-full gap-3", {
  variants: {
    align: {
      start: "flex-row",
      end: "flex-row-reverse",
    },
  },
  defaultVariants: {
    align: "start",
  },
});

const MessageAlignContext = React.createContext<"start" | "end">("start");

function Message({
  className,
  align,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof messageVariants>) {
  const resolved = align ?? "start";
  return (
    <MessageAlignContext.Provider value={resolved}>
      <div
        data-slot="message"
        data-align={resolved}
        className={cn(messageVariants({ align }), className)}
        {...props}
      />
    </MessageAlignContext.Provider>
  );
}

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-group"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn("flex shrink-0 items-end pb-0.5", className)}
      {...props}
    />
  );
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  const align = React.useContext(MessageAlignContext);
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex min-w-0 flex-col gap-1",
        align === "end" ? "items-end" : "items-start",
        className,
      )}
      {...props}
    />
  );
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        "flex items-center gap-2 px-1 text-[13px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  const align = React.useContext(MessageAlignContext);
  return (
    <div
      data-slot="message-footer"
      className={cn(
        "flex items-center gap-1 px-1 text-[12px] text-muted-foreground",
        align === "end" && "flex-row-reverse",
        className,
      )}
      {...props}
    />
  );
}

export {
  Message,
  MessageGroup,
  MessageAvatar,
  MessageContent,
  MessageHeader,
  MessageFooter,
};
