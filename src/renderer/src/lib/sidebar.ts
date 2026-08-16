import { create } from "zustand";
import { STORAGE_KEYS } from "./storage";

export type ProjectSort = "recent" | "name";

/**
 * What an unfolded project shows. The sidebar answers two different questions —
 * "where was I talking?" and "what is this project made of?" — and stacking
 * both under every project buried each one. The tabs pick which is on screen.
 */
export type SidebarView = "chats" | "agentic";

const WIDTH_KEY = STORAGE_KEYS.sidebarWidth;
const COLLAPSED_KEY = STORAGE_KEYS.sidebarCollapsed;
const VIEW_KEY = STORAGE_KEYS.sidebarView;
const SORT_KEY = STORAGE_KEYS.projectsSort;
/** Ids of the projects whose Agents / MCPs / Skills sections are unfolded. */
const EXPANDED_KEY = STORAGE_KEYS.projectsExpanded;

export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_RAIL = 56;
export const SIDEBAR_DEFAULT = 280;

type SidebarState = {
  width: number;
  collapsed: boolean;
  view: SidebarView;
  sort: ProjectSort;
  /** Projects whose capability sections are open in the sidebar. */
  expanded: string[];
  setWidth: (w: number) => void;
  setCollapsed: (c: boolean) => void;
  toggle: () => void;
  setView: (v: SidebarView) => void;
  setSort: (s: ProjectSort) => void;
  toggleExpanded: (id: string) => void;
};

function clampWidth(w: number) {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
}

const storedWidth = Number(localStorage.getItem(WIDTH_KEY));
const storedSort = (localStorage.getItem(SORT_KEY) as ProjectSort) || "recent";
const storedView = localStorage.getItem(VIEW_KEY);

function loadExpanded(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export const useSidebar = create<SidebarState>((set) => ({
  width: storedWidth ? clampWidth(storedWidth) : SIDEBAR_DEFAULT,
  collapsed: localStorage.getItem(COLLAPSED_KEY) === "1",
  view: storedView === "agentic" ? "agentic" : "chats",
  sort: storedSort,
  expanded: loadExpanded(),
  setWidth: (w) => {
    const cw = clampWidth(w);
    localStorage.setItem(WIDTH_KEY, String(cw));
    set({ width: cw });
  },
  setCollapsed: (c) => {
    localStorage.setItem(COLLAPSED_KEY, c ? "1" : "0");
    set({ collapsed: c });
  },
  toggle: () =>
    set((s) => {
      const next = !s.collapsed;
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      return { collapsed: next };
    }),
  setView: (v) => {
    localStorage.setItem(VIEW_KEY, v);
    set({ view: v });
  },
  setSort: (s) => {
    localStorage.setItem(SORT_KEY, s);
    set({ sort: s });
  },
  toggleExpanded: (id) =>
    set((s) => {
      const expanded = s.expanded.includes(id)
        ? s.expanded.filter((x) => x !== id)
        : [...s.expanded, id];
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded));
      return { expanded };
    }),
}));
