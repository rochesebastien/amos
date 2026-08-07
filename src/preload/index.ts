import { contextBridge, ipcRenderer } from "electron";
import type { AmosApi, IpcChannel, IpcRequest, IpcResponse } from "../shared/ipc.js";

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Nothing from Node is handed over — only these explicit, typed functions,
 * each one a thin wrapper over a channel declared in the shared contract.
 */
function invoke<C extends IpcChannel>(channel: C, payload?: IpcRequest<C>): Promise<IpcResponse<C>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResponse<C>>;
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
  settings: {
    get: (input) => invoke("settings:get", input),
    set: (input) => invoke("settings:set", input),
  },
};

contextBridge.exposeInMainWorld("amos", amos);
