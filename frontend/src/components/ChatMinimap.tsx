import {
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@/components/ui/message-scroller";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

export type ChatMinimapItem = { index: number; content: string };

// Claude.ai-style chat minimap: a vertical rail of ticks, one per user message.
// Hovering a tick previews its text; clicking scrolls the transcript to it.
export function ChatMinimap({ items }: { items: ChatMinimapItem[] }) {
  const { scrollToMessage } = useMessageScroller();
  const { currentAnchorId } = useMessageScrollerVisibility();

  if (items.length === 0) return null;

  return (
    // pointer-events-none so the rail never blocks transcript scroll; only the
    // ticks themselves opt back in.
    <div className="pointer-events-none absolute right-2 top-1/2 z-10 -translate-y-1/2">
      <div className="flex flex-col items-end gap-1.5">
        {items.map((item) => {
          const active = currentAnchorId === String(item.index);
          return (
            <HoverCard key={item.index}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  aria-label="Jump to message"
                  onClick={() =>
                    scrollToMessage(String(item.index), {
                      align: "start",
                      behavior: "smooth",
                    })
                  }
                  className="group pointer-events-auto flex h-3 items-center justify-end"
                >
                  <span
                    className={cn(
                      "h-0.5 w-4 rounded-full bg-muted-foreground/30 transition-all duration-150 ease-out",
                      "group-hover:w-7 group-hover:bg-foreground",
                      active && "w-6 bg-foreground/70",
                    )}
                  />
                </button>
              </HoverCardTrigger>
              <HoverCardContent
                side="left"
                align="center"
                sideOffset={8}
                className="w-auto max-w-[20rem] p-2.5"
              >
                <p className="line-clamp-5 whitespace-pre-wrap break-words text-[13px] leading-snug text-popover-foreground">
                  {item.content}
                </p>
              </HoverCardContent>
            </HoverCard>
          );
        })}
      </div>
    </div>
  );
}
