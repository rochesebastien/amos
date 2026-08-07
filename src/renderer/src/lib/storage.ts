// Renderer-local UI preferences (theme, language, sidebar geometry) live in
// localStorage. Everything the *main* process owns lives in SQLite instead.
//
// Every module that touches localStorage imports its key from here so the
// namespace stays in one place.

const PREFIX = "amos.";

/** Canonical key names. Values are what actually gets read/written. */
export const STORAGE_KEYS = {
  lang: `${PREFIX}lang`,
  theme: `${PREFIX}theme`,
  sidebarWidth: `${PREFIX}sidebar.width`,
  sidebarCollapsed: `${PREFIX}sidebar.collapsed`,
  projectsSort: `${PREFIX}projects.sort`,
  projectsExpanded: `${PREFIX}projects.expanded`,
} as const;
