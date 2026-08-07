import { contextBridge, ipcRenderer } from "electron";
import type { AmosApi, PingResult } from "../shared/ipc.js";

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Nothing from Node is handed over — only these explicit, typed functions.
 */
const amos: AmosApi = {
  ping: () => ipcRenderer.invoke("app:ping") as Promise<PingResult>,
};

contextBridge.exposeInMainWorld("amos", amos);
