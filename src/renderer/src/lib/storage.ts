// Renderer-local UI preferences (theme, language, sidebar geometry) live in
// localStorage. Everything the *main* process owns lives in SQLite instead.
//
// The app was called CheveluAI before the AMOS rebrand and namespaced its keys
// with the legacy prefix below. This module renames them to `amos.*` and does
// the one-time copy on boot: for every known key, if the new name is absent and
// the legacy one is present, the value is copied across. The legacy key is
// deliberately left in place — it costs a few bytes and keeps a downgrade
// working.
//
// Every module that touches localStorage imports its key from here, which also
// guarantees this migration runs before their top-level code does (ES modules
// evaluate dependencies first).

const PREFIX = "amos.";

/** The pre-rebrand namespace. The only place the old product name survives. */
const LEGACY_PREFIX = "cheveluai.";

/** Canonical key names. Values are what actually gets read/written. */
export const STORAGE_KEYS = {
  lang: `${PREFIX}lang`,
  theme: `${PREFIX}theme`,
  sidebarWidth: `${PREFIX}sidebar.width`,
  sidebarCollapsed: `${PREFIX}sidebar.collapsed`,
  projectsSort: `${PREFIX}projects.sort`,
  projectsExpanded: `${PREFIX}projects.expanded`,
} as const;

// Written by a pre-P2 sidebar that folded sections by numeric project id. Ids
// are uuids now, so the stored value can only ever decode to an empty list:
// there is nothing to migrate, only something to clean up.
const DEAD_KEYS = [`${LEGACY_PREFIX}projects.folded`];

/**
 * Copy each legacy-prefixed value onto its `amos.*` name when the latter has
 * never been written. Safe to call more than once; a no-op after the first boot.
 */
export function migrateLegacyStorage(store: Storage = localStorage): void {
  try {
    for (const next of Object.values(STORAGE_KEYS)) {
      if (store.getItem(next) !== null) continue;
      const value = store.getItem(LEGACY_PREFIX + next.slice(PREFIX.length));
      if (value !== null) store.setItem(next, value);
    }
    for (const dead of DEAD_KEYS) store.removeItem(dead);
  } catch {
    // Private-mode / disabled storage: preferences fall back to their defaults.
  }
}

migrateLegacyStorage();
