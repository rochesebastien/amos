// @vitest-environment jsdom
//
// The sidebar's two tabs and the tree they drive.
//
// Two things here are easy to break and invisible in review. The first is the
// split itself: the Agentic tab is the only one that should pay for a scan, so
// a regression that scans on the Chats tab costs a filesystem walk per project
// on every open. The second is the icon column — section titles and their rows
// have to share one indent, which is a property of the markup rather than of
// anything that renders visibly in jsdom, so it is asserted directly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { CapabilityItem, ProjectScan } from "@shared/capabilities";
import type { ChatSession } from "@shared/chat";
import { Sidebar } from "@/components/Sidebar";
import { useSidebar } from "@/lib/sidebar";
import { dict } from "@/lib/dictionaries";
import { EMPTY_SCAN, installBridge, PROJECTS, renderInApp } from "./helpers";

const AGENT: CapabilityItem = {
  id: "a1",
  kind: "agent",
  ecosystem: "claude",
  scope: "project",
  name: "code-reviewer",
  path: "/home/dev/amos/.claude/agents/code-reviewer.md",
  sourceFile: "/home/dev/amos/.claude/agents/code-reviewer.md",
  mtimeMs: 1,
  data: {
    frontmatter: { name: "code-reviewer" },
    description: "Reviews code",
    model: "sonnet",
    tools: ["Read"],
    body: "",
  },
};

const SESSIONS: ChatSession[] = [
  {
    id: "s1",
    projectId: "p1",
    backend: "claude",
    title: "Refactor the deploy pipeline",
    resumeToken: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "s2",
    projectId: "p1",
    backend: "codex",
    title: "Fix the flaky test",
    resumeToken: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const SCAN: ProjectScan = { ...EMPTY_SCAN, items: [AGENT] };

/** Render the sidebar with one project unfolded, counting scan calls. */
function renderSidebar() {
  const scan = vi.fn(() => SCAN);
  installBridge({
    projects: [PROJECTS[0]!],
    scan,
    sessions: () => SESSIONS,
  });
  return { ...renderInApp(<Sidebar />), scan };
}

/** Unfold the only project and wait for its subtree. */
async function unfold() {
  const chevron = await screen.findByRole("button", {
    name: dict.en["sidebar.expandProject"],
  });
  fireEvent.click(chevron);
}

beforeEach(() => {
  localStorage.clear();
  useSidebar.setState({ collapsed: false, view: "chats", expanded: [] });
});

afterEach(() => {
  cleanup();
});

describe("sidebar view tabs", () => {
  it("offers exactly the two tabs, Chats selected by default", async () => {
    renderSidebar();

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      dict.en["sidebar.viewChats"],
      dict.en["sidebar.viewAgentic"],
    ]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("lists the project's conversations under the Chats tab", async () => {
    renderSidebar();
    await unfold();

    expect(await screen.findByRole("link", { name: /Refactor the deploy pipeline/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Fix the flaky test/ })).toBeTruthy();
    // The capability sections belong to the other tab.
    expect(screen.queryByText(dict.en["project.agents"])).toBeNull();
  });

  it("does not scan while the Chats tab is the one on screen", async () => {
    const { scan } = renderSidebar();
    await unfold();
    await screen.findByRole("link", { name: /Refactor the deploy pipeline/ });

    expect(scan).not.toHaveBeenCalled();
  });

  it("swaps to agents, MCP servers and skills on the Agentic tab", async () => {
    const { scan } = renderSidebar();
    await unfold();
    fireEvent.click(screen.getByRole("tab", { name: dict.en["sidebar.viewAgentic"] }));

    expect(await screen.findByRole("link", { name: /code-reviewer/ })).toBeTruthy();
    for (const label of ["project.agents", "project.mcps", "project.skills"] as const) {
      expect(screen.getByText(dict.en[label])).toBeTruthy();
    }
    expect(screen.queryByRole("link", { name: /Refactor the deploy pipeline/ })).toBeNull();
    expect(scan).toHaveBeenCalled();
  });

  it("remembers the chosen tab across mounts", async () => {
    renderSidebar();
    fireEvent.click(await screen.findByRole("tab", { name: dict.en["sidebar.viewAgentic"] }));
    cleanup();

    renderSidebar();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
  });
});

describe("sidebar tree alignment", () => {
  it("indents section titles and their rows by the same amount", async () => {
    renderSidebar();
    await unfold();
    fireEvent.click(screen.getByRole("tab", { name: dict.en["sidebar.viewAgentic"] }));

    const title = (await screen.findByText(dict.en["project.agents"])).parentElement!;
    const row = screen.getByRole("link", { name: /code-reviewer/ });

    // The staircase this guards against is a title and its items landing on
    // two different left edges, which is what the tree looked like before.
    const indent = (el: HTMLElement) =>
      [...el.classList].filter((c) => /^p[lx]-/.test(c)).sort();
    expect(indent(title)).toEqual(indent(row));
  });

  it("gives every icon the same fixed slot, whatever glyph is inside", async () => {
    renderSidebar();
    await unfold();

    const row = await screen.findByRole("link", { name: /Refactor the deploy pipeline/ });
    const slot = row.firstElementChild!;

    // A 12px brand mark and a 14px lucide icon must still occupy one column.
    expect(slot.className).toContain("size-3.5");
  });
});
