/**
 * The single typed IPC contract shared by the main process, the preload
 * bridge and the renderer. Every channel added in later phases lands here so
 * that `window.amos` stays fully typed on both sides.
 */

/** Request/response shape of every `ipcRenderer.invoke` channel. */
export type IpcInvokeMap = {
  /** Liveness probe: proves the contextBridge is wired up. */
  "app:ping": { request: void; response: PingResult };
};

export type IpcChannel = keyof IpcInvokeMap;

export type IpcRequest<C extends IpcChannel> = IpcInvokeMap[C]["request"];
export type IpcResponse<C extends IpcChannel> = IpcInvokeMap[C]["response"];

export type PingResult = {
  pong: true;
  /** AMOS version, taken from package.json at build time. */
  version: string;
  /** `process.platform` of the main process. */
  platform: NodeJS.Platform;
};

/** Main → renderer push channels (subscriptions), populated in later phases. */
export type IpcEventMap = Record<string, never>;

/** The API surface exposed on `window.amos` by the preload script. */
export type AmosApi = {
  ping(): Promise<PingResult>;
};
