import { create } from "zustand";
import type { TerminalKind } from "@shared/terminal";
import { STORAGE_KEYS } from "./storage";

/**
 * State of the terminals side panel: whether it is open, its tabs, and which
 * one is active. The panel is app-level (mounted once, in the root shell) so a
 * terminal keeps running as the user moves between views; this store is how
 * the project header's terminal button reaches it.
 *
 * A tab is created here first, in a "pending" shape; the panel is what calls
 * the main process to spawn the child and fills in the returned `terminalId`.
 * That keeps the IPC — and the xterm instance — out of the store.
 */

export type TerminalTab = {
  /** Local id, stable for the life of the tab. */
  key: string;
  projectId: string;
  projectName: string;
  kind: TerminalKind;
  /** The backend id, once the child has been spawned. */
  terminalId: string | null;
  /** Set when the child exited or failed to start. */
  exited: boolean;
  /** A human title for the tab. */
  title: string;
};

/**
 * Width bounds of the panel. The floor is not cosmetic: a TUI like Claude
 * Code reflows badly under ~40 columns, and 320px is about where that starts.
 */
export const TERMINAL_MIN_WIDTH = 320;
export const TERMINAL_MAX_WIDTH = 1100;
export const TERMINAL_DEFAULT_WIDTH = 440;

const WIDTH_KEY = STORAGE_KEYS.terminalWidth;

function clampWidth(w: number) {
  return Math.min(TERMINAL_MAX_WIDTH, Math.max(TERMINAL_MIN_WIDTH, Math.round(w)));
}

type TerminalState = {
  open: boolean;
  width: number;
  tabs: TerminalTab[];
  activeKey: string | null;
  /** Open the panel and add a tab for this project + kind. */
  openTab: (input: { projectId: string; projectName: string; kind: TerminalKind }) => void;
  closeTab: (key: string) => void;
  setActive: (key: string) => void;
  setOpen: (open: boolean) => void;
  setWidth: (w: number) => void;
  bindTerminalId: (key: string, terminalId: string) => void;
  markExited: (terminalId: string) => void;
};

const LABELS: Record<TerminalKind, string> = {
  claude: "Claude",
  codex: "Codex",
  shell: "Shell",
};

let counter = 0;
const nextKey = () => `term-${++counter}`;

const storedWidth = Number(localStorage.getItem(WIDTH_KEY));

export const useTerminals = create<TerminalState>((set) => ({
  open: false,
  width: storedWidth ? clampWidth(storedWidth) : TERMINAL_DEFAULT_WIDTH,
  tabs: [],
  activeKey: null,

  openTab: ({ projectId, projectName, kind }) => {
    const key = nextKey();
    const tab: TerminalTab = {
      key,
      projectId,
      projectName,
      kind,
      terminalId: null,
      exited: false,
      title: LABELS[kind],
    };
    set((s) => ({ open: true, tabs: [...s.tabs, tab], activeKey: key }));
  },

  closeTab: (key) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.key !== key);
      const activeKey =
        s.activeKey === key ? (tabs[tabs.length - 1]?.key ?? null) : s.activeKey;
      return { tabs, activeKey, open: tabs.length > 0 ? s.open : false };
    }),

  setActive: (key) => set({ activeKey: key }),
  setOpen: (open) => set({ open }),

  setWidth: (w) => {
    const width = clampWidth(w);
    localStorage.setItem(WIDTH_KEY, String(width));
    set({ width });
  },

  bindTerminalId: (key, terminalId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === key ? { ...t, terminalId } : t)),
    })),

  markExited: (terminalId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.terminalId === terminalId ? { ...t, exited: true } : t)),
    })),
}));
