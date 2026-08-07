import { create } from "zustand";

// App-wide UI preferences that aren't part of the URL. Navigation and server
// data now live in TanStack Router and TanStack Query respectively; this store
// is intentionally limited to the theme.

export type ThemeMode = "light" | "dark" | "system";

type AppState = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
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
  theme: initialTheme,
  setTheme: (t) => {
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
    set({ theme: t });
  },
}));
