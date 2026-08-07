import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { z } from "zod";
import type { IpcChannel, IpcRequest, IpcResponse, PingResult } from "../shared/ipc.js";
import {
  addProject,
  getProject,
  listProjects,
  removeProject,
  touchProject,
} from "./services/projects.js";
import { scanProject } from "./scanner/index.js";
import { getSetting, setSetting } from "./services/settings.js";

/**
 * Every renderer → main entry point. Payloads crossing the bridge are
 * untrusted, so each one is parsed with zod before it reaches a service.
 */

const NoPayload = z.void().optional();
const ProjectId = z.object({ id: z.string().min(1) });
const ScanRequest = z.object({ projectId: z.string().min(1) });
const ProjectPath = z.object({ path: z.string().min(1) });
const SettingKey = z.object({ key: z.string().min(1).max(200) });
const SettingEntry = z.object({ key: z.string().min(1).max(200), value: z.string().max(100_000) });

/**
 * Register one handler with the payload schema applied and the response type
 * pinned to the shared contract.
 */
function handle<C extends IpcChannel, S extends z.ZodType>(
  channel: C,
  schema: S,
  fn: (payload: z.output<S>) => IpcResponse<C> | Promise<IpcResponse<C>>,
): void {
  ipcMain.handle(channel, async (_event, raw: IpcRequest<C>) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid payload for ${channel}: ${parsed.error.issues[0]?.message ?? ""}`);
    }
    return await fn(parsed.data);
  });
}

export function registerIpcHandlers(): void {
  handle("app:ping", NoPayload, (): PingResult => {
    return { pong: true, version: app.getVersion(), platform: process.platform };
  });

  handle("projects:list", NoPayload, () => listProjects());
  handle("projects:add", ProjectPath, (input) => addProject(input));
  handle("projects:remove", ProjectId, (input) => removeProject(input.id));
  handle("projects:touch", ProjectId, (input) => touchProject(input.id));

  handle("dialog:pickFolder", NoPayload, async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
    };
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0]! };
  });

  // The renderer only ever names a project it already knows: the scanner is
  // handed a path from the database, never one crossing the bridge.
  handle("scan:project", ScanRequest, async (input) => {
    const project = getProject(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    return await scanProject(project.path);
  });

  handle("settings:get", SettingKey, (input) => getSetting(input.key));
  handle("settings:set", SettingEntry, (input) => setSetting(input.key, input.value));
}
