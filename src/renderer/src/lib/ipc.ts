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
import type {
  ChatBackend,
  ChatEventMessage,
  ChatSession,
  ChatSessionDetail,
  CliDetection,
  ReasoningEffort,
} from "@shared/chat";
import type { TerminalDataEvent, TerminalExitEvent, TerminalKind } from "@shared/terminal";

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
  ChatBackend,
  ChatEventMessage,
  ChatSession,
  ChatSessionDetail,
  CliDetection,
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

  /** The project's git branch; `head` is null when it is not a repository. */
  gitHead: (projectId: string) => bridge().git.head({ projectId }),
  gitBranches: (projectId: string) => bridge().git.branches({ projectId }),
  /** Move the working tree; rejects with git's own message when it refuses. */
  gitCheckout: (projectId: string, branch: string) =>
    bridge().git.checkout({ projectId, branch }),

  readFile: (path: string) => bridge().fs.readFile({ path }),
  writeFile: (input: { path: string; content: string; expectedMtimeMs?: number | null }) =>
    bridge().fs.writeFile(input),
  listDir: (path: string, maxDepth?: number) => bridge().fs.listDir({ path, maxDepth }),

  saveAgent: (input: SaveAgentRequest) => bridge().cap.saveAgent(input),
  saveMcp: (input: SaveMcpRequest) => bridge().cap.saveMcp(input),

  /** Locate the vendor CLIs. `refresh` also forgets remembered auth failures. */
  detectClis: (refresh = false) => bridge().cli.detect({ refresh }),
  /** Subscribe to detection changes; the return value unsubscribes. */
  onCliChanged: (listener: (detection: CliDetection) => void) => bridge().cli.onChanged(listener),

  sendChat: (input: {
    projectId: string;
    sessionId?: string | null;
    backend: ChatBackend;
    prompt: string;
    model?: string | null;
    effort?: ReasoningEffort | null;
  }) => bridge().chat.send(input),
  abortChat: (sessionId: string) => bridge().chat.abort({ sessionId }),
  listChatSessions: (projectId: string) => bridge().chat.listSessions({ projectId }),
  getChatSession: (sessionId: string) => bridge().chat.getSession({ sessionId }),
  deleteChatSession: (sessionId: string) => bridge().chat.deleteSession({ sessionId }),
  /** Subscribe to streaming chat events; the return value unsubscribes. */
  onChatEvent: (listener: (message: ChatEventMessage) => void) => bridge().chat.onEvent(listener),

  getSetting: (key: string) => bridge().settings.get({ key }),
  setSetting: (key: string, value: string) => bridge().settings.set({ key, value }),

  createTerminal: (input: { projectId: string; kind: TerminalKind; cols: number; rows: number }) =>
    bridge().terminal.create(input),
  writeTerminal: (id: string, data: string) => bridge().terminal.write({ id, data }),
  resizeTerminal: (id: string, cols: number, rows: number) =>
    bridge().terminal.resize({ id, cols, rows }),
  killTerminal: (id: string) => bridge().terminal.kill({ id }),
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => bridge().terminal.onData(listener),
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) => bridge().terminal.onExit(listener),
};
