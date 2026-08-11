/**
 * The single typed IPC contract shared by the main process, the preload
 * bridge and the renderer. Every channel added in later phases lands here so
 * that `window.amos` stays fully typed on both sides.
 *
 * This module must stay free of Node and Electron imports: it is bundled into
 * the sandboxed renderer as well.
 */

import type { McpTransport, ProjectScan } from "./capabilities.js";
import type {
  ChatBackend,
  ChatEventMessage,
  ChatSession,
  ChatSessionDetail,
  CliDetection,
} from "./chat.js";
import type {
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
} from "./terminal.js";

// ---------------------------------------------------------------- data model

/** A project is a folder on disk that AMOS knows about. */
export type Project = {
  /** Opaque uuid, stable across renames of the folder. */
  id: string;
  /** Absolute, symlink-resolved path of the project folder. */
  path: string;
  /** Display name — the folder's basename unless renamed. */
  name: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp of the last time the project was opened, if ever. */
  lastOpenedAt: string | null;
};

export type PingResult = {
  pong: true;
  /** AMOS version, taken from package.json at build time. */
  version: string;
  /** `process.platform` of the main process. */
  platform: NodeJS.Platform;
};

/** Result of the native folder picker: `null` when the user cancelled. */
export type PickFolderResult = { path: string | null };

/** A single row of the `settings` key/value table. */
export type SettingValue = { key: string; value: string | null };

// ------------------------------------------------------------------ file i/o

/** One entry of a `fs:listDir` listing. */
export type FsEntry = {
  /** Basename. */
  name: string;
  /** Path relative to the listed directory, with `/` separators. */
  relativePath: string;
  /** Absolute path. */
  path: string;
  kind: "file" | "directory";
  /** Size in bytes; `0` for directories. */
  bytes: number;
};

export type ReadFileResult = {
  path: string;
  content: string;
  /** Modification time when the content was read — the save's conflict token. */
  mtimeMs: number;
  bytes: number;
};

export type WriteFileResult = {
  path: string;
  /** Modification time after the write, to keep editing without a re-read. */
  mtimeMs: number;
  bytes: number;
  /** The `.bak` copy of the previous content, or `null` for a new file. */
  backupPath: string | null;
};

export type ListDirResult = {
  path: string;
  entries: FsEntry[];
  /** `true` when the listing hit the entry cap and is therefore partial. */
  truncated: boolean;
};

// --------------------------------------------------------------- capabilities

/** Which markdown document `cap:saveAgent` is writing. */
export type CapabilityDocument = "agent" | "skill";

/**
 * The frontmatter keys AMOS's forms know about. A key left out is not touched
 * on disk; a key set to `null` or `""` is removed. Everything else in the file
 * survives untouched — the merge happens in the main process, against the
 * bytes currently on disk.
 */
export type FrontmatterFields = {
  name?: string | null;
  description?: string | null;
  model?: string | null;
  tools?: string[] | null;
};

export type SaveAgentRequest = {
  document: CapabilityDocument;
  /** Absolute path of the `.md` file (a skill's is its `SKILL.md`). */
  filePath: string;
  fields: FrontmatterFields;
  body: string;
  /**
   * `undefined` skips the check (an explicit overwrite), a number requires the
   * file to still carry that mtime, `null` requires the file not to exist yet.
   */
  expectedMtimeMs?: number | null;
};

/** The MCP entry keys the editor owns; everything else in the entry survives. */
export type McpFields = {
  transport: McpTransport;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  url: string | null;
  headers: Record<string, string>;
};

export type SaveMcpRequest = {
  /** Absolute path of the `.mcp.json` / `~/.claude.json` / `config.toml`. */
  sourceFile: string;
  /** Server key to write. */
  name: string;
  /** Key currently in the file, when renaming. */
  previousName?: string;
  /** Omitted together with `remove: true`. */
  fields?: McpFields;
  /** Delete the entry instead of writing it. */
  remove?: boolean;
  expectedMtimeMs?: number | null;
};

export type SaveCapabilityResult = {
  path: string;
  mtimeMs: number;
  backupPath: string | null;
  /**
   * `true` when the rewritten document was TOML that carried comments: the
   * TOML serialiser cannot keep them, so the UI has to say so.
   */
  commentsLost: boolean;
};

/**
 * Marker carried in the message of a rejected save. Electron flattens a thrown
 * error to its message across the bridge, so the sentinel — not a class — is
 * what the renderer matches on to open its conflict dialog.
 */
export const WRITE_CONFLICT_CODE = "AMOS_WRITE_CONFLICT";

/** Marker of a path the main process refused to read or write. */
export const PATH_DENIED_CODE = "AMOS_PATH_DENIED";

/** `true` when a rejected IPC call failed the mtime check. */
export function isWriteConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes(WRITE_CONFLICT_CODE);
}

/** Payload of the `scan:changed` push: something under a watched root moved. */
export type ScanChangedEvent = {
  projectId: string;
  /** ISO-8601 timestamp of the debounced change. */
  at: string;
};

// ------------------------------------------------------------ invoke channels

/** Request/response shape of every `ipcRenderer.invoke` channel. */
export type IpcInvokeMap = {
  /** Liveness probe: proves the contextBridge is wired up. */
  "app:ping": { request: void; response: PingResult };

  /** Every known project, most recently opened first. */
  "projects:list": { request: void; response: Project[] };
  /** Register a folder; returns the existing project when already known. */
  "projects:add": { request: { path: string }; response: Project };
  /** Forget a project. The folder on disk is never touched. */
  "projects:remove": { request: { id: string }; response: { ok: true } };
  /** Stamp `last_opened_at`, moving the project to the top of the recents. */
  "projects:touch": { request: { id: string }; response: Project };

  /** Native "choose a directory" dialog. */
  "dialog:pickFolder": { request: void; response: PickFolderResult };

  /**
   * Walk a known project (and the user's home) for agents, skills and MCP
   * servers. Never cached in the database: the filesystem is the truth.
   */
  "scan:project": { request: { projectId: string }; response: ProjectScan };
  /** Start watching a project's capability roots; pushes `scan:changed`. */
  "scan:watch": { request: { projectId: string }; response: { ok: true } };
  /** Stop watching a project. Idempotent. */
  "scan:unwatch": { request: { projectId: string }; response: { ok: true } };

  /** Read a UTF-8 file inside an allowed root. */
  "fs:readFile": { request: { path: string }; response: ReadFileResult };
  /** Atomically replace a UTF-8 file inside an allowed root. */
  "fs:writeFile": {
    request: { path: string; content: string; expectedMtimeMs?: number | null };
    response: WriteFileResult;
  };
  /** Recursively list a directory inside an allowed root. */
  "fs:listDir": { request: { path: string; maxDepth?: number }; response: ListDirResult };

  /** Write an agent `.md` (or a `SKILL.md`), preserving unknown frontmatter. */
  "cap:saveAgent": { request: SaveAgentRequest; response: SaveCapabilityResult };
  /** Write one MCP server entry, preserving the rest of the config file. */
  "cap:saveMcp": { request: SaveMcpRequest; response: SaveCapabilityResult };

  /**
   * Locate the vendor CLIs and report how usable they look. `refresh` forces
   * a fresh probe and clears the remembered auth failures — it is what the
   * "check again" button on the setup screen calls.
   */
  "cli:detect": { request: { refresh?: boolean } | undefined; response: CliDetection };

  /**
   * Start a turn. Resolves as soon as the session exists; everything the user
   * reads arrives on the `chat:event` push.
   */
  "chat:send": {
    request: {
      projectId: string;
      sessionId?: string | null;
      backend: ChatBackend;
      prompt: string;
    };
    response: { sessionId: string };
  };
  /** Stop the running turn of a session. A no-op when nothing is running. */
  "chat:abort": { request: { sessionId: string }; response: { ok: true } };
  /** Sessions of one project, most recently used first. */
  "chat:listSessions": { request: { projectId: string }; response: ChatSession[] };
  /** One session with its full transcript, or `null` when it is gone. */
  "chat:getSession": { request: { sessionId: string }; response: ChatSessionDetail | null };
  /** Delete a session and its messages. */
  "chat:deleteSession": { request: { sessionId: string }; response: { ok: true } };

  /** Read one persisted setting. */
  "settings:get": { request: { key: string }; response: SettingValue };
  /** Write one persisted setting. */
  "settings:set": { request: { key: string; value: string }; response: SettingValue };

  /** Spawn a terminal in a project's folder; output arrives on `terminal:data`. */
  "terminal:create": { request: TerminalCreateRequest; response: TerminalCreateResult };
  /** Feed keystrokes to a terminal's child process. */
  "terminal:write": { request: { id: string; data: string }; response: { ok: true } };
  /** Tell a terminal its emulator was resized. */
  "terminal:resize": { request: { id: string; cols: number; rows: number }; response: { ok: true } };
  /** Kill a terminal's child process and forget it. Idempotent. */
  "terminal:kill": { request: { id: string }; response: { ok: true } };
};

export type IpcChannel = keyof IpcInvokeMap;

export type IpcRequest<C extends IpcChannel> = IpcInvokeMap[C]["request"];
export type IpcResponse<C extends IpcChannel> = IpcInvokeMap[C]["response"];

/** The channel names, for the main process to iterate over when registering. */
export const IPC_CHANNELS = [
  "app:ping",
  "projects:list",
  "projects:add",
  "projects:remove",
  "projects:touch",
  "dialog:pickFolder",
  "scan:project",
  "scan:watch",
  "scan:unwatch",
  "fs:readFile",
  "fs:writeFile",
  "fs:listDir",
  "cap:saveAgent",
  "cap:saveMcp",
  "cli:detect",
  "chat:send",
  "chat:abort",
  "chat:listSessions",
  "chat:getSession",
  "chat:deleteSession",
  "settings:get",
  "settings:set",
  "terminal:create",
  "terminal:write",
  "terminal:resize",
  "terminal:kill",
] as const satisfies readonly IpcChannel[];

/** Main → renderer push channels (subscriptions). */
export type IpcEventMap = {
  "scan:changed": ScanChangedEvent;
  /** One event of a streaming turn. */
  "chat:event": ChatEventMessage;
  /** CLI detection changed — a binary appeared, or an auth error landed. */
  "cli:changed": CliDetection;
  /** One chunk of a terminal's output. */
  "terminal:data": TerminalDataEvent;
  /** A terminal's child process exited. */
  "terminal:exit": TerminalExitEvent;
};

export type IpcEventChannel = keyof IpcEventMap;

// -------------------------------------------------------------- bridge shape

/** The API surface exposed on `window.amos` by the preload script. */
export type AmosApi = {
  ping(): Promise<PingResult>;
  projects: {
    list(): Promise<Project[]>;
    add(input: { path: string }): Promise<Project>;
    remove(input: { id: string }): Promise<{ ok: true }>;
    touch(input: { id: string }): Promise<Project>;
  };
  dialog: {
    pickFolder(): Promise<PickFolderResult>;
  };
  scan: {
    project(input: { projectId: string }): Promise<ProjectScan>;
    watch(input: { projectId: string }): Promise<{ ok: true }>;
    unwatch(input: { projectId: string }): Promise<{ ok: true }>;
    /** Subscribe to debounced filesystem changes; returns an unsubscribe. */
    onChanged(listener: (event: ScanChangedEvent) => void): () => void;
  };
  fs: {
    readFile(input: { path: string }): Promise<ReadFileResult>;
    writeFile(input: {
      path: string;
      content: string;
      expectedMtimeMs?: number | null;
    }): Promise<WriteFileResult>;
    listDir(input: { path: string; maxDepth?: number }): Promise<ListDirResult>;
  };
  cap: {
    saveAgent(input: SaveAgentRequest): Promise<SaveCapabilityResult>;
    saveMcp(input: SaveMcpRequest): Promise<SaveCapabilityResult>;
  };
  cli: {
    detect(input?: { refresh?: boolean }): Promise<CliDetection>;
    /** Subscribe to detection changes; returns an unsubscribe. */
    onChanged(listener: (detection: CliDetection) => void): () => void;
  };
  chat: {
    send(input: {
      projectId: string;
      sessionId?: string | null;
      backend: ChatBackend;
      prompt: string;
    }): Promise<{ sessionId: string }>;
    abort(input: { sessionId: string }): Promise<{ ok: true }>;
    listSessions(input: { projectId: string }): Promise<ChatSession[]>;
    getSession(input: { sessionId: string }): Promise<ChatSessionDetail | null>;
    deleteSession(input: { sessionId: string }): Promise<{ ok: true }>;
    /** Subscribe to streaming chat events; returns an unsubscribe. */
    onEvent(listener: (message: ChatEventMessage) => void): () => void;
  };
  settings: {
    get(input: { key: string }): Promise<SettingValue>;
    set(input: { key: string; value: string }): Promise<SettingValue>;
  };
  terminal: {
    create(input: TerminalCreateRequest): Promise<TerminalCreateResult>;
    write(input: { id: string; data: string }): Promise<{ ok: true }>;
    resize(input: { id: string; cols: number; rows: number }): Promise<{ ok: true }>;
    kill(input: { id: string }): Promise<{ ok: true }>;
    /** Subscribe to a terminal's output; returns an unsubscribe. */
    onData(listener: (event: TerminalDataEvent) => void): () => void;
    /** Subscribe to terminal exits; returns an unsubscribe. */
    onExit(listener: (event: TerminalExitEvent) => void): () => void;
  };
};
