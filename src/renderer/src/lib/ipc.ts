// Typed client for the main process, replacing the old HTTP `lib/api.ts`.
// Everything here goes through the `window.amos` bridge installed by the
// preload script — the renderer itself has no Node access.
import type {
  AmosApi,
  ListDirResult,
  PickFolderResult,
  Project,
  ReadFileResult,
  SaveAgentRequest,
  SaveCapabilityResult,
  SaveMcpRequest,
  ScanChangedEvent,
  SettingValue,
  WriteFileResult,
} from "@shared/ipc";
import type { ProjectScan } from "@shared/capabilities";

export type {
  Project,
  PickFolderResult,
  SettingValue,
  ProjectScan,
  ReadFileResult,
  WriteFileResult,
  ListDirResult,
  SaveCapabilityResult,
  ScanChangedEvent,
};

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

  scanProject: (projectId: string) => bridge().scan.project({ projectId }),
  /** Start pushing `scan:changed` for this project. Safe to call twice. */
  watchProject: (projectId: string) => bridge().scan.watch({ projectId }),
  unwatchProject: (projectId: string) => bridge().scan.unwatch({ projectId }),
  /** Subscribe to filesystem changes; the return value unsubscribes. */
  onScanChanged: (listener: (event: ScanChangedEvent) => void) =>
    bridge().scan.onChanged(listener),

  readFile: (path: string) => bridge().fs.readFile({ path }),
  writeFile: (input: { path: string; content: string; expectedMtimeMs?: number | null }) =>
    bridge().fs.writeFile(input),
  listDir: (path: string, maxDepth?: number) => bridge().fs.listDir({ path, maxDepth }),

  saveAgent: (input: SaveAgentRequest) => bridge().cap.saveAgent(input),
  saveMcp: (input: SaveMcpRequest) => bridge().cap.saveMcp(input),

  getSetting: (key: string) => bridge().settings.get({ key }),
  setSetting: (key: string, value: string) => bridge().settings.set({ key, value }),
};
