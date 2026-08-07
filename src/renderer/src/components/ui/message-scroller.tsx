import * as React from "react";
import { ChevronDown } from "lucide-react";
import {
  MessageScroller as Primitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";
import { cn } from "@/lib/utils";

// shadcn "Message Scroller" — a chat transcript scroller. Behavior comes from
// the headless @shadcn/react primitive; this file is the styled frame, themed
// to the CheveluAI tokens. See docs/components/message-scroller.

const MessageScrollerProvider = Primitive.Provider;

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Viewport>) {
  return (
    <Primitive.Viewport
      className={cn(
        "min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Content
      className={cn("mx-auto flex w-full max-w-3xl flex-col", className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "[content-visibility:auto] [contain-intrinsic-size:auto_88px]",
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerButton({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.Button>) {
  return (
    <Primitive.Button
      className={cn(
        "absolute bottom-4 left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-opacity hover:bg-accent",
        "data-[active=false]:pointer-events-none data-[active=false]:opacity-0",
        className,
      )}
      {...props}
    >
      {children ?? <ChevronDown className="size-4" />}
    </Primitive.Button>
  );
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
