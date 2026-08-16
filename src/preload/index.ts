import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AmosApi,
  IpcChannel,
  IpcEventChannel,
  IpcEventMap,
  IpcRequest,
  IpcResponse,
} from "../shared/ipc.js";

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Nothing from Node is handed over — only these explicit, typed functions,
 * each one a thin wrapper over a channel declared in the shared contract.
 */
function invoke<C extends IpcChannel>(channel: C, payload?: IpcRequest<C>): Promise<IpcResponse<C>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResponse<C>>;
}

/**
 * Subscribe to a main → renderer push channel. The raw `IpcRendererEvent` is
 * deliberately dropped: it carries a `sender` the renderer has no business
 * holding. The returned function is the only way to unsubscribe.
 */
function subscribe<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEventMap[C]) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, payload: IpcEventMap[C]) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const amos: AmosApi = {
  ping: () => invoke("app:ping"),
  projects: {
    list: () => invoke("projects:list"),
    add: (input) => invoke("projects:add", input),
    remove: (input) => invoke("projects:remove", input),
    touch: (input) => invoke("projects:touch", input),
  },
  dialog: {
    pickFolder: () => invoke("dialog:pickFolder"),
  },
  scan: {
    project: (input) => invoke("scan:project", input),
    watch: (input) => invoke("scan:watch", input),
    unwatch: (input) => invoke("scan:unwatch", input),
    onChanged: (listener) => subscribe("scan:changed", listener),
  },
  git: {
    head: (input) => invoke("git:head", input),
  },
  fs: {
    readFile: (input) => invoke("fs:readFile", input),
    writeFile: (input) => invoke("fs:writeFile", input),
    listDir: (input) => invoke("fs:listDir", input),
  },
  cap: {
    saveAgent: (input) => invoke("cap:saveAgent", input),
    saveMcp: (input) => invoke("cap:saveMcp", input),
  },
  cli: {
    detect: (input) => invoke("cli:detect", input),
    onChanged: (listener) => subscribe("cli:changed", listener),
  },
  chat: {
    send: (input) => invoke("chat:send", input),
    abort: (input) => invoke("chat:abort", input),
    listSessions: (input) => invoke("chat:listSessions", input),
    getSession: (input) => invoke("chat:getSession", input),
    deleteSession: (input) => invoke("chat:deleteSession", input),
    onEvent: (listener) => subscribe("chat:event", listener),
  },
  settings: {
    get: (input) => invoke("settings:get", input),
    set: (input) => invoke("settings:set", input),
  },
  terminal: {
    create: (input) => invoke("terminal:create", input),
    write: (input) => invoke("terminal:write", input),
    resize: (input) => invoke("terminal:resize", input),
    kill: (input) => invoke("terminal:kill", input),
    onData: (listener) => subscribe("terminal:data", listener),
    onExit: (listener) => subscribe("terminal:exit", listener),
  },
};

contextBridge.exposeInMainWorld("amos", amos);
