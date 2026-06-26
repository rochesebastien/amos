import { create } from "zustand";

export type ProjectSort = "recent" | "name";

const WIDTH_KEY = "cheveluai.sidebar.width";
const COLLAPSED_KEY = "cheveluai.sidebar.collapsed";
const SORT_KEY = "cheveluai.projects.sort";
const FOLDED_KEY = "cheveluai.projects.folded";

export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_RAIL = 56;
export const SIDEBAR_DEFAULT = 280;

type SidebarState = {
  width: number;
  collapsed: boolean;
  sort: ProjectSort;
  folded: number[];
  setWidth: (w: number) => void;
  setCollapsed: (c: boolean) => void;
  toggle: () => void;
  setSort: (s: ProjectSort) => void;
  toggleFold: (id: number) => void;
};

function clampWidth(w: number) {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
}

const storedWidth = Number(localStorage.getItem(WIDTH_KEY));
const storedSort = (localStorage.getItem(SORT_KEY) as ProjectSort) || "recent";

function loadFolded(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDED_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
}

export const useSidebar = create<SidebarState>((set) => ({
  width: storedWidth ? clampWidth(storedWidth) : SIDEBAR_DEFAULT,
  collapsed: localStorage.getItem(COLLAPSED_KEY) === "1",
  sort: storedSort,
  folded: loadFolded(),
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
  setSort: (s) => {
    localStorage.setItem(SORT_KEY, s);
    set({ sort: s });
  },
  toggleFold: (id) =>
    set((s) => {
      const folded = s.folded.includes(id)
        ? s.folded.filter((x) => x !== id)
        : [...s.folded, id];
      localStorage.setItem(FOLDED_KEY, JSON.stringify(folded));
      return { folded };
    }),
}));
