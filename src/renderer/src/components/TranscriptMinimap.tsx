import { useT, type TFunc } from "@/lib/i18n";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";

/**
 * A ruler of the conversation down the left edge: one tick per prompt the user
 * sent, the one you are reading picked out from the rest. Hovering a tick
 * shows what that prompt said; clicking it scrolls there.
 *
 * A long transcript has no landmarks — every turn looks like the last one when
 * scrolled past at speed — and the thing a user actually navigates by is "the
 * message where I asked about X". So the ticks map the prompts, not every
 * message: answers are found by way of the question that produced them.
 *
 * The column is 10px wide and sits at `left-1`, which keeps it inside the
 * transcript's own horizontal padding. That is what lets it be always-on
 * rather than hidden behind a breakpoint: it never reaches the text, however
 * narrow the window or however wide the terminal panel is pulled.
 */

export type MinimapPrompt = { id: string; content: string };

export function TranscriptMinimap({ prompts }: { prompts: MinimapPrompt[] }) {
  const t = useT();
  const { scrollToMessage } = useMessageScroller();
  const { currentAnchorId, visibleMessageIds } = useMessageScrollerVisibility();

  // One prompt is not a conversation to navigate; the ruler would be noise.
  if (prompts.length < 2) return null;

  const onScreen = new Set(visibleMessageIds);

  return (
    <nav
      aria-label={t("chat.minimapLabel")}
      className="absolute inset-y-0 left-1 z-20 flex items-center"
    >
      <ul className="flex max-h-full flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {prompts.map((prompt, index) => (
          <li key={prompt.id}>
            <MinimapTick
              t={t}
              prompt={prompt}
              index={index}
              total={prompts.length}
              current={prompt.id === currentAnchorId}
              onScreen={onScreen.has(prompt.id)}
              onSelect={() =>
                scrollToMessage(prompt.id, { align: "start", behavior: "smooth" })
              }
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function MinimapTick({
  t,
  prompt,
  index,
  total,
  current,
  onScreen,
  onSelect,
}: {
  t: TFunc;
  prompt: MinimapPrompt;
  index: number;
  total: number;
  current: boolean;
  onScreen: boolean;
  onSelect: () => void;
}) {
  const preview = prompt.content.trim();
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          aria-label={t("chat.minimapGoTo", { index: index + 1, total })}
          aria-current={current ? "true" : undefined}
          // The bar is 2px tall; the padding is what makes it clickable.
          className="group/tick flex w-2.5 justify-end py-[3px] outline-none"
        >
          <span
            className={cn(
              "h-0.5 rounded-full transition-all",
              current
                ? "w-2.5 bg-foreground"
                : onScreen
                  ? "w-2 bg-muted-foreground/60"
                  : "w-1.5 bg-muted-foreground/25",
              "group-hover/tick:w-2.5 group-hover/tick:bg-foreground group-focus-visible/tick:w-2.5 group-focus-visible/tick:bg-foreground",
            )}
          />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="center" className="w-80">
        <p className="line-clamp-4 whitespace-pre-wrap text-[13px] text-foreground">
          {preview || t("chat.minimapEmpty")}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground/60">
          {t("chat.minimapPosition", { index: index + 1, total })}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
