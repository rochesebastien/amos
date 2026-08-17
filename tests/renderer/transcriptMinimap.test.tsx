// @vitest-environment jsdom
//
// The transcript ruler, and the two message-row details it sits next to.
//
// The ruler's whole job is to be a control surface: a tick has to be a real
// button carrying where it goes, and clicking it has to ask the scroller to
// move — none of which is visible in a screenshot, and all of which is easy to
// lose to a refactor that keeps the ticks looking right.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TranscriptMinimap } from "@/components/TranscriptMinimap";
import { MessageAvatar } from "@/components/ui/message";
import { BackendGlyph } from "@/components/BrandIcons";
import { dict } from "@/lib/dictionaries";

const scrollToMessage = vi.fn();
let visibility = { currentAnchorId: "m2", visibleMessageIds: ["m2"] };

// The ruler reads its position from the scroller primitive; stub that seam so
// the test can place the reader anywhere in the transcript it likes.
vi.mock("@/components/ui/message-scroller", () => ({
  useMessageScroller: () => ({ scrollToMessage }),
  useMessageScrollerVisibility: () => visibility,
}));

const PROMPTS = [
  { id: "m1", content: "Refactor the deploy pipeline" },
  { id: "m2", content: "Now add a rollback step" },
  { id: "m3", content: "Write the tests for it" },
];

afterEach(() => {
  cleanup();
  scrollToMessage.mockClear();
  visibility = { currentAnchorId: "m2", visibleMessageIds: ["m2"] };
});

describe("<TranscriptMinimap />", () => {
  it("draws one tick per prompt, each naming where it leads", () => {
    render(<TranscriptMinimap prompts={PROMPTS} />);

    const ticks = screen.getAllByRole("button");
    expect(ticks).toHaveLength(3);
    expect(ticks[0]!.getAttribute("aria-label")).toBe(
      dict.en["chat.minimapGoTo"].replace("{index}", "1").replace("{total}", "3"),
    );
  });

  it("marks the prompt the reader is on, and only that one", () => {
    render(<TranscriptMinimap prompts={PROMPTS} />);

    const ticks = screen.getAllByRole("button");
    expect(ticks.map((tick) => tick.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
  });

  it("scrolls to that message when a tick is clicked", () => {
    render(<TranscriptMinimap prompts={PROMPTS} />);

    fireEvent.click(screen.getAllByRole("button")[2]!);

    expect(scrollToMessage).toHaveBeenCalledWith("m3", {
      align: "start",
      behavior: "smooth",
    });
  });

  it("stays out of the way of a conversation with nothing to navigate", () => {
    const { container } = render(<TranscriptMinimap prompts={PROMPTS.slice(0, 1)} />);

    expect(container.innerHTML).toBe("");
  });

  it("keeps the ruler inside the transcript's own padding", () => {
    render(<TranscriptMinimap prompts={PROMPTS} />);

    // The column is always on rather than hidden behind a breakpoint, so it
    // must never be wide enough to reach the text.
    const nav = screen.getByRole("navigation", { name: dict.en["chat.minimapLabel"] });
    expect(nav.className).toContain("left-1");
    expect(screen.getAllByRole("button")[0]!.className).toContain("w-2.5");
  });
});

describe("message row details", () => {
  it("centres the avatar on the first line rather than the last", () => {
    const { container } = render(<MessageAvatar />);
    const avatar = container.firstElementChild!;

    // Bottom-anchoring is the regression: it drifts further from the name the
    // longer the answer gets.
    expect(avatar.className).toContain("items-center");
    expect(avatar.className).not.toContain("items-end");
  });

  it("gives every backend a mark, the dev driver included", () => {
    const { container: claude } = render(<BackendGlyph backend="claude" />);
    const { container: echo } = render(<BackendGlyph backend="echo" />);

    // A column where some rows have an icon and some do not reads as broken.
    expect(claude.querySelector("svg")).toBeTruthy();
    expect(echo.querySelector("svg")).toBeTruthy();
  });
});
