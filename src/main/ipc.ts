import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { z } from "zod";
import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  PingResult,
  SaveCapabilityResult,
  ScanChangedEvent,
} from "../shared/ipc.js";
import { MCP_TRANSPORTS } from "../shared/capabilities.js";
import {
  addProject,
  getProject,
  listProjects,
  removeProject,
  touchProject,
} from "./services/projects.js";
import { scanProject } from "./scanner/index.js";
import { writeAgent, writeMcp, writeSkillMd } from "./scanner/writers.js";
import { WatchManager } from "./scanner/watch.js";
import { getSetting, setSetting } from "./services/settings.js";
import { buildAllowedRoots, resolveAllowedPath } from "./services/paths.js";
import { listDirectory, readTextFile } from "./services/files.js";
import { safeWriteFile } from "./services/safeWrite.js";

/**
 * Every renderer → main entry point. Payloads crossing the bridge are
 * untrusted, so each one is parsed with zod before it reaches a service, and
 * every path is resolved against the allowed roots before it reaches the disk.
 */

const NoPayload = z.void().optional();
const ProjectId = z.object({ id: z.string().min(1) });
const ScanRequest = z.object({ projectId: z.string().min(1) });
const ProjectPath = z.object({ path: z.string().min(1) });
const SettingKey = z.object({ key: z.string().min(1).max(200) });
const SettingEntry = z.object({ key: z.string().min(1).max(200), value: z.string().max(100_000) });

const FilePath = z.string().min(1).max(4_096);
/** `undefined` = overwrite, a number = expect this mtime, `null` = expect no file. */
const ExpectedMtime = z.number().nullable().optional();

const ReadFileRequest = z.object({ path: FilePath });
const WriteFileRequest = z.object({
  path: FilePath,
  content: z.string().max(5_000_000),
  expectedMtimeMs: ExpectedMtime,
});
const ListDirRequest = z.object({
  path: FilePath,
  maxDepth: z.number().int().min(1).max(8).optional(),
});

const FrontmatterFields = z.object({
  name: z.string().max(500).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  model: z.string().max(500).nullable().optional(),
  tools: z.array(z.string().max(500)).max(500).nullable().optional(),
});

const SaveAgentRequest = z.object({
  document: z.enum(["agent", "skill"]),
  filePath: FilePath,
  fields: FrontmatterFields,
  body: z.string().max(1_000_000),
  expectedMtimeMs: ExpectedMtime,
});

const StringMap = z.record(z.string().max(500), z.string().max(10_000));
const McpFields = z.object({
  transport: z.enum(MCP_TRANSPORTS),
  command: z.string().max(4_096).nullable(),
  args: z.array(z.string().max(4_096)).max(200),
  env: StringMap,
  url: z.string().max(4_096).nullable(),
  headers: StringMap,
});

const SaveMcpRequest = z.object({
  sourceFile: FilePath,
  name: z.string().min(1).max(200),
  previousName: z.string().min(1).max(200).optional(),
  fields: McpFields.optional(),
  remove: z.boolean().optional(),
  expectedMtimeMs: ExpectedMtime,
});

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

/**
 * Resolve a path the renderer named, refusing anything outside a registered
 * project, `~/.claude` or `~/.codex`. The roots are rebuilt on every call so
 * that a project removed a second ago stops being writable immediately.
 */
async function allowPath(requested: string): Promise<string> {
  const roots = buildAllowedRoots(listProjects().map((p) => p.path));
  return await resolveAllowedPath(requested, roots);
}

let watchManager: WatchManager | null = null;

/** Push a debounced filesystem change to every open window. */
function broadcast(event: ScanChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("scan:changed", event);
  }
}

export function registerIpcHandlers(): void {
  watchManager = new WatchManager({ onChange: broadcast });

  handle("app:ping", NoPayload, (): PingResult => {
    return { pong: true, version: app.getVersion(), platform: process.platform };
  });

  handle("projects:list", NoPayload, () => listProjects());
  handle("projects:add", ProjectPath, (input) => addProject(input));
  handle("projects:remove", ProjectId, async (input) => {
    await watchManager?.unwatch(input.id);
    return removeProject(input.id);
  });
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

  handle("scan:watch", ScanRequest, (input) => {
    const project = getProject(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    watchManager?.watch(project.id, project.path);
    return { ok: true } as const;
  });

  handle("scan:unwatch", ScanRequest, async (input) => {
    await watchManager?.unwatch(input.projectId);
    return { ok: true } as const;
  });

  // ----- filesystem ---------------------------------------------------------

  handle("fs:readFile", ReadFileRequest, async (input) => {
    return await readTextFile(await allowPath(input.path));
  });

  handle("fs:writeFile", WriteFileRequest, async (input) => {
    const target = await allowPath(input.path);
    const result = await safeWriteFile(target, input.content, {
      expectedMtimeMs: input.expectedMtimeMs,
    });
    return {
      path: result.path,
      mtimeMs: result.mtimeMs,
      bytes: result.bytes,
      backupPath: result.backupPath,
    };
  });

  handle("fs:listDir", ListDirRequest, async (input) => {
    return await listDirectory(await allowPath(input.path), input.maxDepth);
  });

  // ----- capabilities -------------------------------------------------------

  handle("cap:saveAgent", SaveAgentRequest, async (input): Promise<SaveCapabilityResult> => {
    const filePath = await allowPath(input.filePath);
    const write = input.document === "skill" ? writeSkillMd : writeAgent;
    const result = await write({
      filePath,
      fields: input.fields,
      body: input.body,
      expectedMtimeMs: input.expectedMtimeMs,
    });
    return {
      path: result.path,
      mtimeMs: result.mtimeMs,
      backupPath: result.backupPath,
      commentsLost: false,
    };
  });

  handle("cap:saveMcp", SaveMcpRequest, async (input): Promise<SaveCapabilityResult> => {
    const sourceFile = await allowPath(input.sourceFile);
    const result = await writeMcp({
      sourceFile,
      name: input.name,
      previousName: input.previousName,
      fields: input.fields,
      remove: input.remove,
      expectedMtimeMs: input.expectedMtimeMs,
    });
    return {
      path: result.path,
      mtimeMs: result.mtimeMs,
      backupPath: result.backupPath,
      commentsLost: result.commentsLost,
    };
  });

  handle("settings:get", SettingKey, (input) => getSetting(input.key));
  handle("settings:set", SettingEntry, (input) => setSetting(input.key, input.value));
}

/** Tear the watchers down on quit so no inotify handle outlives the app. */
export async function disposeIpcHandlers(): Promise<void> {
  const manager = watchManager;
  watchManager = null;
  await manager?.closeAll();
}
