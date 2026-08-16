// @vitest-environment jsdom
//
// The command palette, tested at its two natural seams:
//
//  1. `search()` — the pure ranking function. Corpus in, hits out; no DOM.
//  2. The component — what the user actually sees and presses. These tests go
//     through the same fake bridge as the other renderer suites, so the
//     palette exercises its real data path (fetchQuery → ipc → bridge).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { CapabilityItem, InstructionFile, ProjectScan } from "@shared/capabilities";
import type { ChatSession } from "@shared/chat";
import { search, SearchPalette, type ProjectSources } from "@/components/SearchPalette";
import { dict } from "@/lib/dictionaries";
import { EMPTY_SCAN, installBridge, PROJECTS, renderInApp } from "./helpers";

// ------------------------------------------------------------------ fixtures

function skill(name: string, description = ""): CapabilityItem {
  const directory = `/home/dev/amos/.claude/skills/${name}`;
  return {
    id: `skill-${name}`,
    kind: "skill",
    ecosystem: "claude",
    scope: "project",
    name,
    path: directory,
    sourceFile: `${directory}/SKILL.md`,
    mtimeMs: 1,
    data: { frontmatter: { name }, description, body: "", directory, files: [] },
  };
}

const INSTRUCTION: InstructionFile = {
  id: "i1",
  ecosystem: "claude",
  scope: "project",
  name: "CLAUDE.md",
  path: "/home/dev/amos/CLAUDE.md",
  relativePath: "CLAUDE.md",
  bytes: 120,
  mtimeMs: 1,
};

const CHAT: ChatSession = {
  id: "s1",
  projectId: "p1",
  backend: "claude",
  title: "Refactor the deploy pipeline",
  resumeToken: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function sources(overrides: Partial<ProjectScan> = {}, sessions: ChatSession[] = []): ProjectSources[] {
  return [
    {
      project: PROJECTS[0]!,
      scan: { ...EMPTY_SCAN, ...overrides },
      sessions,
    },
    { project: PROJECTS[1]!, scan: EMPTY_SCAN, sessions: [] },
  ];
}

// -------------------------------------------------------- search(), the logic

describe("search()", () => {
  it("acts as a project launcher on the empty query", () => {
    const hits = search(sources({ items: [skill("deploy-helper")] }, [CHAT]), "");

    // Projects only — capabilities and chats stay out until the user types.
    expect(hits.map((h) => h.type)).toEqual(["project", "project"]);
  });

  it("matches case-insensitively on name and description", () => {
    const corpus = sources({ items: [skill("deploy-helper", "Ships the app")] });

    expect(search(corpus, "DEPLOY").some((h) => h.type === "item")).toBe(true);
    expect(search(corpus, "ships the").some((h) => h.type === "item")).toBe(true);
    expect(search(corpus, "nonexistent")).toEqual([]);
  });

  it("finds instructions by path and chats by title", () => {
    const corpus = sources({ instructions: [INSTRUCTION] }, [CHAT]);

    expect(search(corpus, "claude.md").map((h) => h.type)).toEqual(["instruction"]);
    expect(search(corpus, "pipeline").map((h) => h.type)).toEqual(["chat"]);
  });

  it("keeps group order stable: projects before items before chats", () => {
    const corpus = sources({ items: [skill("amos-tools")] }, [
      { ...CHAT, title: "amos session" },
    ]);

    expect(search(corpus, "amos").map((h) => h.type)).toEqual(["project", "item", "chat"]);
  });

  it("caps every group so one noisy kind cannot flood the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => skill(`deploy-${i}`));
    const hits = search(sources({ items: many }), "deploy");

    expect(hits).toHaveLength(8);
  });
});

// ----------------------------------------------------- the palette, rendered

function renderPalette(onClose = vi.fn()) {
  installBridge({
    scan: (projectId) =>
      projectId === "p1"
        ? { ...EMPTY_SCAN, items: [skill("deploy-helper", "Ships the app")] }
        : EMPTY_SCAN,
    sessions: (projectId) => (projectId === "p1" ? [CHAT] : []),
  });
  const rendered = renderInApp(<SearchPalette open onClose={onClose} />);
  return { ...rendered, onClose };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("<SearchPalette />", () => {
  it("focuses the input and lists projects before anything is typed", async () => {
    renderPalette();

    const input = await screen.findByRole("combobox", { name: dict.en["search.title"] });
    expect(document.activeElement).toBe(input);
    expect(await screen.findByRole("option", { name: /amos/ })).toBeTruthy();
  });

  it("has no keyboard-hint footer", async () => {
    renderPalette();
    await screen.findByRole("combobox", { name: dict.en["search.title"] });

    // The old footer rendered <kbd> chips ("↑↓ navigate / ↵ open / esc close").
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("filters as the user types", async () => {
    renderPalette();
    const input = await screen.findByRole("combobox", { name: dict.en["search.title"] });

    fireEvent.change(input, { target: { value: "deploy" } });

    expect(await screen.findByRole("option", { name: /deploy-helper/ })).toBeTruthy();
    // Both projects match nothing for "deploy", so they are gone.
    expect(screen.queryByRole("option", { name: /other/ })).toBeNull();
  });

  it("opens the active hit with Enter and closes the palette", async () => {
    const { router, onClose } = renderPalette();
    const input = await screen.findByRole("combobox", { name: dict.en["search.title"] });
    await screen.findByRole("option", { name: /amos/ });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onClose).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe("/p/p1");
    });
  });

  it("moves the active row with the arrow keys", async () => {
    renderPalette();
    const input = await screen.findByRole("combobox", { name: dict.en["search.title"] });
    await screen.findByRole("option", { name: /amos/ });

    fireEvent.keyDown(input, { key: "ArrowDown" });

    const options = screen.getAllByRole("option");
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("closes on Escape", async () => {
    const { onClose } = renderPalette();
    await screen.findByRole("combobox", { name: dict.en["search.title"] });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
