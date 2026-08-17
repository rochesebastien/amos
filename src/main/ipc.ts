import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { z } from "zod";
import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  PingResult,
  SaveCapabilityResult,
} from "../shared/ipc.js";
import { MCP_TRANSPORTS } from "../shared/capabilities.js";
import {
  CHAT_BACKENDS,
  CLI_PATH_SETTING,
  CLI_VENDORS,
  ECHO_DRIVER_ENV,
  ECHO_DRIVER_SETTING,
  REASONING_EFFORTS,
  type CliDetection,
  type CliVendor,
} from "../shared/chat.js";
import {
  addProject,
  getProject,
  listProjects,
  removeProject,
  touchProject,
} from "./services/projects.js";
import {
  deleteSession,
  getSessionDetail,
  listSessions,
} from "./services/sessions.js";
import {
  cachedDetection,
  clearAuthFailures,
  detectClis,
  detectionChanged,
  ensurePathFixed,
  markAuthFailure,
  markAuthSuccess,
} from "./chat/detect.js";
import { ChatManager, createDriverFactory, createDriverKey } from "./chat/manager.js";
import { TerminalManager } from "./terminal/manager.js";
import { scanProject } from "./scanner/index.js";
import { writeAgent, writeMcp, writeSkillMd } from "./scanner/writers.js";
import { WatchManager } from "./scanner/watch.js";
import { getSetting, setSetting } from "./services/settings.js";
import { buildAllowedRoots, resolveAllowedPath } from "./services/paths.js";
import { listDirectory, readTextFile } from "./services/files.js";
import { checkoutBranch, listBranches, readGitHead } from "./services/git.js";
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

const DetectRequest = z.object({ refresh: z.boolean().optional() }).optional();
const TerminalId = z.object({ id: z.string().min(1).max(200) });
const TerminalCreateRequest = z.object({
  projectId: z.string().min(1),
  kind: z.enum(["claude", "codex", "shell"]),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
});
const TerminalWriteRequest = z.object({ id: z.string().min(1).max(200), data: z.string().max(100_000) });
const TerminalResizeRequest = z.object({
  id: z.string().min(1).max(200),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
});
const TerminalKillRequest = TerminalId;
const ChatSessionId = z.object({ sessionId: z.string().min(1).max(200) });
const ChatSendRequest = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1).max(200).nullable().optional(),
  backend: z.enum(CHAT_BACKENDS),
  prompt: z.string().min(1).max(500_000),
  model: z.string().max(200).nullable().optional(),
  effort: z.enum(REASONING_EFFORTS).nullable().optional(),
});

// A branch name is passed to git as its own argument, never through a shell,
// but it is still bounded here — the renderer is untrusted like any other.
const GitCheckoutRequest = z.object({
  projectId: z.string().min(1),
  branch: z.string().min(1).max(255),
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
let chatManager: ChatManager | null = null;
let terminalManager: TerminalManager | null = null;

/** Push a payload to every open window. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

// ----- CLI detection ---------------------------------------------------------

/** The manual binary paths and the echo flag, read fresh from the settings. */
function detectOptions() {
  const overrides: Partial<Record<CliVendor, string | null>> = {};
  for (const vendor of CLI_VENDORS) {
    overrides[vendor] = getSetting(CLI_PATH_SETTING[vendor]).value;
  }
  const echoEnabled =
    getSetting(ECHO_DRIVER_SETTING).value === "1" || process.env[ECHO_DRIVER_ENV] === "1";
  return { overrides, echoEnabled };
}

/** Probe the CLIs and push `cli:changed` when anything the UI shows moved. */
async function refreshDetection(): Promise<CliDetection> {
  const previous = cachedDetection();
  const detection = await detectClis(detectOptions());
  if (detectionChanged(previous, detection)) broadcast("cli:changed", detection);
  return detection;
}

/** The detection a chat send uses: cached when we have one, probed when not. */
async function currentDetection(): Promise<CliDetection> {
  return cachedDetection() ?? (await refreshDetection());
}

export function registerIpcHandlers(): void {
  watchManager = new WatchManager({ onChange: (event) => broadcast("scan:changed", event) });
  chatManager = new ChatManager({
    emit: (message) => broadcast("chat:event", message),
    resolveProjectPath: (projectId) => getProject(projectId)?.path ?? null,
    createDriver: createDriverFactory({
      detection: currentDetection,
      log: (message) => console.warn(`[amos:chat] ${message}`),
    }),
    driverKey: createDriverKey({ detection: currentDetection }),
    onAuthFailure: (vendor) => {
      markAuthFailure(vendor);
      void refreshDetection();
    },
    onAuthSuccess: (vendor) => {
      markAuthSuccess(vendor);
      void refreshDetection();
    },
  });

  terminalManager = new TerminalManager({
    emitData: (event) => broadcast("terminal:data", event),
    emitExit: (event) => broadcast("terminal:exit", event),
    resolveProjectPath: (projectId) => getProject(projectId)?.path ?? null,
    resolveBinary: (kind) => cachedDetection()?.clis[kind]?.path ?? null,
  });

  // Repair the PATH of a GUI-launched app before anything asks for a binary.
  void ensurePathFixed().then(() => refreshDetection().catch(() => undefined));

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
    const scan = await scanProject(project.path);
    // Nested instruction files (AGENTS.md below the root) sit outside the
    // fixed watch roots; hand the watcher the exact paths this scan found so
    // external edits to them refresh the UI too.
    const root = path.resolve(project.path);
    watchManager?.setExtraFiles(
      project.id,
      scan.instructions
        .filter((file) => file.scope === "project" && path.dirname(path.resolve(file.path)) !== root)
        .map((file) => file.path),
    );
    return scan;
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

  // Same rule as the scanner: the path comes from the database, never from the
  // renderer, so there is nothing here for a caller to point somewhere else.
  handle("git:head", ScanRequest, async (input) => {
    const project = getProject(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    return { head: await readGitHead(project.path) };
  });

  handle("git:branches", ScanRequest, async (input) => {
    const project = getProject(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    return { branches: await listBranches(project.path) };
  });

  handle("git:checkout", GitCheckoutRequest, async (input) => {
    const project = getProject(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    await checkoutBranch(project.path, input.branch);
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

  // ----- chat ---------------------------------------------------------------

  handle("cli:detect", DetectRequest, async (input) => {
    // "Check again" also forgets the auth failures we concluded from a turn:
    // the user has just been told to log in, and may well have done it.
    if (input?.refresh) clearAuthFailures();
    return await refreshDetection();
  });

  handle("chat:send", ChatSendRequest, async (input) => {
    if (!chatManager) throw new Error("Chat is not available.");
    return await chatManager.send(input);
  });

  handle("chat:abort", ChatSessionId, (input) => {
    return chatManager?.abort(input.sessionId) ?? ({ ok: true } as const);
  });

  handle("chat:listSessions", ScanRequest, (input) => listSessions(input.projectId));
  handle("chat:getSession", ChatSessionId, (input) => getSessionDetail(input.sessionId));
  handle("chat:deleteSession", ChatSessionId, (input) => {
    chatManager?.abort(input.sessionId);
    return deleteSession(input.sessionId);
  });

  handle("terminal:create", TerminalCreateRequest, (input) => {
    if (!terminalManager) throw new Error("Terminals are not available.");
    return terminalManager.create(input);
  });
  handle("terminal:write", TerminalWriteRequest, (input) => {
    terminalManager?.write(input.id, input.data);
    return { ok: true } as const;
  });
  handle("terminal:resize", TerminalResizeRequest, (input) => {
    terminalManager?.resize(input.id, input.cols, input.rows);
    return { ok: true } as const;
  });
  handle("terminal:kill", TerminalKillRequest, (input) => {
    terminalManager?.kill(input.id);
    return { ok: true } as const;
  });

  handle("settings:get", SettingKey, (input) => getSetting(input.key));
  handle("settings:set", SettingEntry, async (input) => {
    const result = setSetting(input.key, input.value);
    // A changed binary path or echo flag has to reach the UI as a new
    // detection, not as a setting nobody re-reads.
    const affectsClis =
      input.key === ECHO_DRIVER_SETTING ||
      CLI_VENDORS.some((vendor) => CLI_PATH_SETTING[vendor] === input.key);
    if (affectsClis) await refreshDetection().catch(() => undefined);
    return result;
  });
}

/** Tear the watchers and the chat drivers down on quit. */
export async function disposeIpcHandlers(): Promise<void> {
  const watchers = watchManager;
  const chat = chatManager;
  const terminals = terminalManager;
  watchManager = null;
  chatManager = null;
  terminalManager = null;
  terminals?.dispose();
  await Promise.all([watchers?.closeAll(), chat?.dispose()]);
}
