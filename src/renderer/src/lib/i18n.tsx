// Lightweight i18n: a Zustand-backed language store + a `useT()` hook.
// No external dependency. Translations are flat dot-namespaced keys with
// optional `{var}` interpolation. Missing keys fall back to the key itself.
// Every user-facing string must exist in BOTH dictionaries (`dictionaries.ts`);
// tests/renderer/i18n.test.ts fails the build when they drift apart.
import { create } from "zustand";
import { ipc } from "./ipc";
import { STORAGE_KEYS } from "./storage";
import { dict } from "./dictionaries";
import { LANGUAGES } from "./lang";
import type { Lang } from "./lang";

export { LANGUAGES };
export type { Lang };

const LANG_KEY = STORAGE_KEYS.lang;

/** Key of the persisted (main-process) language preference. */
export const LANG_SETTING = "language";

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const table = dict[lang] ?? dict.en;
  const value = table[key] ?? dict.en[key] ?? key;
  return interpolate(value, vars);
}

type LangState = {
  lang: Lang;
  setLang: (l: Lang, opts?: { persist?: boolean }) => void;
};

// whether the user already has an explicit local choice (vs. defaulting to en)
export const hadStoredLang = localStorage.getItem(LANG_KEY) != null;
const stored = (localStorage.getItem(LANG_KEY) as Lang) || "en";
document.documentElement.lang = stored;

export const useLang = create<LangState>((set) => ({
  lang: stored,
  setLang: (l, opts = { persist: true }) => {
    localStorage.setItem(LANG_KEY, l);
    document.documentElement.lang = l;
    set({ lang: l });
    if (opts.persist !== false) {
      // mirror into the main-process database so the choice survives a reset
      // of the renderer's local storage
      ipc.setSetting(LANG_SETTING, l).catch(() => {});
    }
  },
}));

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

export function useT(): TFunc {
  const lang = useLang((s) => s.lang);
  return (key, vars) => translate(lang, key, vars);
}

// Adopt the persisted language on first load when the user has never made an
// explicit local choice (fresh install, or a brand new renderer profile).
let adopted = hadStoredLang;
export function adoptStoredLanguage(lang?: string | null) {
  if (adopted || !lang) return;
  adopted = true;
  if (LANGUAGES.some((l) => l.value === lang)) {
    useLang.getState().setLang(lang as Lang, { persist: false });
  }
}

/** Localised, compact "time since" label used by the recents lists. */
export function relativeTime(t: TFunc, iso: string | null): string {
  if (!iso) return t("projects.never");
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return t("projects.never");
  const minutes = Math.floor(Math.max(0, Date.now() - then) / 60_000);
  if (minutes < 1) return t("time.now");
  if (minutes < 60) return t("time.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("time.days", { n: days });
  return t("time.weeks", { n: Math.floor(days / 7) });
}
