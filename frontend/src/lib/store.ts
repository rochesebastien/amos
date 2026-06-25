import { create } from "zustand";

export type View = "chat" | "projects" | "mcps" | "settings";
export type ThemeMode = "light" | "dark" | "system";

type AppState = {
  view: View;
  setView: (v: View) => void;

  activeConversationId: number | null;
  setActiveConversation: (id: number | null) => void;

  // when starting a brand-new chat, optionally scoped to a project
  draftProjectId: number | null;
  startNewChat: (projectId?: number | null) => void;

  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;

  // bumped to trigger refetches across components after a mutation
  dataVersion: number;
  refresh: () => void;
};

const THEME_KEY = "cheveluai.theme";

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

const initialTheme = (localStorage.getItem(THEME_KEY) as ThemeMode) || "light";
applyTheme(initialTheme);
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if ((localStorage.getItem(THEME_KEY) as ThemeMode) === "system") {
      applyTheme("system");
    }
  });

export const useApp = create<AppState>((set) => ({
  view: "chat",
  setView: (v) => set({ view: v }),

  activeConversationId: null,
  setActiveConversation: (id) => set({ activeConversationId: id, view: "chat" }),

  draftProjectId: null,
  startNewChat: (projectId = null) =>
    set({ activeConversationId: null, draftProjectId: projectId, view: "chat" }),

  theme: initialTheme,
  setTheme: (t) => {
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
    set({ theme: t });
  },

  dataVersion: 0,
  refresh: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}));
