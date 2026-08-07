// Typed client for the main process, replacing the old HTTP `lib/api.ts`.
// Everything here goes through the `window.amos` bridge installed by the
// preload script — the renderer itself has no Node access.
import type { AmosApi, PickFolderResult, Project, SettingValue } from "@shared/ipc";

export type { Project, PickFolderResult, SettingValue };

/**
 * The bridge is missing only when the renderer is opened outside Electron
 * (e.g. hitting the Vite dev server in a browser). Fail loudly instead of
 * silently returning empty data.
 */
function bridge(): AmosApi {
  const api = typeof window === "undefined" ? undefined : window.amos;
  if (!api) {
    throw new Error("AMOS bridge unavailable — open this window from the AMOS desktop app.");
  }
  return api;
}

export const ipc = {
  ping: () => bridge().ping(),

  listProjects: () => bridge().projects.list(),
  addProject: (path: string) => bridge().projects.add({ path }),
  removeProject: (id: string) => bridge().projects.remove({ id }),
  touchProject: (id: string) => bridge().projects.touch({ id }),

  pickFolder: () => bridge().dialog.pickFolder(),

  getSetting: (key: string) => bridge().settings.get({ key }),
  setSetting: (key: string, value: string) => bridge().settings.set({ key, value }),
};
