/**
 * The single typed IPC contract shared by the main process, the preload
 * bridge and the renderer. Every channel added in later phases lands here so
 * that `window.amos` stays fully typed on both sides.
 *
 * This module must stay free of Node and Electron imports: it is bundled into
 * the sandboxed renderer as well.
 */

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

  /** Read one persisted setting. */
  "settings:get": { request: { key: string }; response: SettingValue };
  /** Write one persisted setting. */
  "settings:set": { request: { key: string; value: string }; response: SettingValue };
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
  "settings:get",
  "settings:set",
] as const satisfies readonly IpcChannel[];

/** Main → renderer push channels (subscriptions), populated in later phases. */
export type IpcEventMap = Record<string, never>;

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
  settings: {
    get(input: { key: string }): Promise<SettingValue>;
    set(input: { key: string; value: string }): Promise<SettingValue>;
  };
};
