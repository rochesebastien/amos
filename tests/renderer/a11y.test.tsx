// @vitest-environment jsdom
//
// Accessibility guard for the parts of the renderer that are mostly icons.
//
// The failure this catches is silent by construction: an icon-only button
// looks finished on screen and reads as "button" to a screen reader, and a
// Radix tooltip does not fix that — it describes the control, it does not name
// it. So rather than trusting a review pass, the sidebar and one editor are
// really rendered here and every control is required to have an accessible
// name, computed by the same algorithm assistive technology uses.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { AgentItem } from "@shared/capabilities";
import type { Project } from "@shared/ipc";
import { Sidebar } from "@/components/Sidebar";
import { AgentEditor } from "@/components/editors/AgentEditor";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/ui/confirm";
import { useSidebar } from "@/lib/sidebar";
import { dict } from "@/lib/dictionaries";

const PROJECTS: Project[] = [
  {
    id: "p1",
    path: "/home/dev/amos",
    name: "amos",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "p2",
    path: "/home/dev/other",
    name: "other",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: null,
  },
];

const AGENT: AgentItem = {
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
    body: "You review code.",
  },
};

/** Enough of the preload bridge for the components under test. */
function installBridge() {
  window.amos = {
    projects: { list: async () => PROJECTS },
    scan: { project: async () => ({ items: [], instructions: [] }) },
    settings: { get: async () => ({ key: "", value: null }) },
  } as unknown as typeof window.amos;
}

/** Render `ui` with the providers the app shell gives it. */
function renderInApp(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfirmProvider>
          <RouterProvider router={router as never} />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/**
 * Elements of `role` that no assistive technology could announce. Both queries
 * run through testing-library's accessible-name computation, so a name coming
 * from text content, `aria-label`, `aria-labelledby` or `title` all count —
 * and a Radix tooltip, which only sets `aria-describedby`, does not.
 */
function unnamed(role: string, container?: HTMLElement): HTMLElement[] {
  const scope = container ? within(container) : screen;
  const all = scope.queryAllByRole(role);
  const named = new Set(scope.queryAllByRole(role, { name: /\S/ }));
  return all.filter((element) => !named.has(element));
}

function describeElements(elements: HTMLElement[]): string[] {
  return elements.map((element) => element.outerHTML.slice(0, 160));
}

beforeEach(() => {
  installBridge();
  localStorage.clear();
  useSidebar.getState().setCollapsed(false);
});

afterEach(() => {
  cleanup();
});

describe("sidebar accessibility", () => {
  it("names every control of the expanded sidebar", async () => {
    renderInApp(<Sidebar />);
    await screen.findByRole("button", { name: dict.en["sidebar.openProject"].replace("{name}", "amos") });

    expect(describeElements(unnamed("button"))).toEqual([]);
    expect(describeElements(unnamed("link"))).toEqual([]);
  });

  it("names every control of the collapsed rail", async () => {
    useSidebar.getState().setCollapsed(true);
    renderInApp(<Sidebar />);
    await screen.findByRole("button", { name: dict.en["nav.expandSidebar"] });

    expect(describeElements(unnamed("button"))).toEqual([]);
    expect(describeElements(unnamed("link"))).toEqual([]);
  });

  it("opens a project from a real button, not a bare clickable div", async () => {
    renderInApp(<Sidebar />);
    const row = await screen.findByRole("button", { name: "Open amos" });

    // A <button> is keyboard-operable for free; a div with onClick is not, and
    // that is exactly the regression this asserts against.
    expect(row.tagName).toBe("BUTTON");
  });

  it("labels the expand chevron and reports its state", async () => {
    renderInApp(<Sidebar />);
    const chevrons = await screen.findAllByRole("button", {
      name: dict.en["sidebar.expandProject"],
    });

    expect(chevrons).toHaveLength(PROJECTS.length);
    expect(chevrons[0]!.getAttribute("aria-expanded")).toBe("false");
  });

  it("puts the project list in a landmark of its own", async () => {
    renderInApp(<Sidebar />);
    expect(await screen.findByRole("navigation", { name: dict.en["sidebar.projects"] })).toBeTruthy();
  });
});

describe("editor accessibility", () => {
  it("names every control and every field of the agent editor", () => {
    const { container } = renderInApp(<AgentEditor projectId="p1" item={AGENT} />);
    const root = container as HTMLElement;

    expect(describeElements(unnamed("button", root))).toEqual([]);
    expect(describeElements(unnamed("textbox", root))).toEqual([]);
  });
});
