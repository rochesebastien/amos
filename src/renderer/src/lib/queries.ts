// TanStack Query client, query keys, and typed hooks over the IPC bridge.
import {
  QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { SaveAgentRequest, SaveMcpRequest } from "@shared/ipc";
import type { ChatSession } from "@shared/chat";
import type { Project } from "@shared/ipc";
import { ipc } from "./ipc";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const qk = {
  projects: ["projects"] as const,
  scan: (projectId: string) => ["scan", projectId] as const,
  gitHead: (projectId: string) => ["git", "head", projectId] as const,
  setting: (key: string) => ["setting", key] as const,
  file: (path: string) => ["file", path] as const,
  dir: (path: string) => ["dir", path] as const,
  clis: ["clis"] as const,
  chatSessions: (projectId: string) => ["chat", "sessions", projectId] as const,
  chatSession: (sessionId: string) => ["chat", "session", sessionId] as const,
};

// ----- Queries --------------------------------------------------------------

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: ipc.listProjects });
}

/**
 * Capabilities of one project. Never persisted: the scan runs in the main
 * process on demand, and the cache here is only what React renders from.
 * `enabled` keeps the sidebar from scanning projects nobody expanded.
 */
export function useProjectScan(projectId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.scan(projectId ?? ""),
    queryFn: () => ipc.scanProject(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 5_000,
  });
}

export function useSetting(key: string) {
  return useQuery({
    queryKey: qk.setting(key),
    queryFn: () => ipc.getSetting(key),
  });
}

/**
 * One file's text plus the `mtimeMs` a later save has to match. Never cached
 * across a mount: an editor that reopens a file must see what is on disk now,
 * or its conflict token is already stale.
 */
export function useFileContent(path: string | null | undefined) {
  return useQuery({
    queryKey: qk.file(path ?? ""),
    queryFn: () => ipc.readFile(path!),
    enabled: Boolean(path),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Recursive listing of a folder — the skill editor's file tree. */
export function useDirListing(path: string | null | undefined, maxDepth?: number) {
  return useQuery({
    queryKey: qk.dir(path ?? ""),
    queryFn: () => ipc.listDir(path!, maxDepth),
    enabled: Boolean(path),
    staleTime: 2_000,
    retry: false,
  });
}

// ----- Mutations ------------------------------------------------------------

export function useProjectMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.projects });
  return {
    /** Register a folder (or re-open a known one) and return the project. */
    add: useMutation({
      mutationFn: (path: string) => ipc.addProject(path),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => ipc.removeProject(id),
      onSuccess: invalidate,
    }),
    touch: useMutation({
      mutationFn: (id: string) => ipc.touchProject(id),
      onSuccess: invalidate,
    }),
  };
}

/**
 * Saving a capability always ends with the same two moves: rescan the project
 * (the filesystem, not this cache, is the truth) and drop the cached bytes of
 * the file that was just rewritten.
 */
function useCapabilityInvalidation(projectId: string) {
  const qc = useQueryClient();
  return (filePath?: string) => {
    void qc.invalidateQueries({ queryKey: qk.scan(projectId) });
    void qc.invalidateQueries({ queryKey: ["dir"] });
    if (filePath) void qc.invalidateQueries({ queryKey: qk.file(filePath) });
  };
}

/** Write an agent `.md` or a `SKILL.md` through the safe-write pipeline. */
export function useSaveAgent(projectId: string) {
  const invalidate = useCapabilityInvalidation(projectId);
  return useMutation({
    mutationFn: (input: SaveAgentRequest) => ipc.saveAgent(input),
    onSuccess: (result) => invalidate(result.path),
  });
}

/** Write (or remove) one MCP server entry in its config file. */
export function useSaveMcp(projectId: string) {
  const invalidate = useCapabilityInvalidation(projectId);
  return useMutation({
    mutationFn: (input: SaveMcpRequest) => ipc.saveMcp(input),
    onSuccess: (result) => invalidate(result.path),
  });
}

/** Write an arbitrary file of a skill folder. */
export function useWriteFile(projectId: string) {
  const invalidate = useCapabilityInvalidation(projectId);
  return useMutation({
    mutationFn: (input: { path: string; content: string; expectedMtimeMs?: number | null }) =>
      ipc.writeFile(input),
    onSuccess: (result) => invalidate(result.path),
  });
}

// ----- Chat -----------------------------------------------------------------

/**
 * Which vendor CLIs are installed and usable. Kept fresh by the `cli:changed`
 * push rather than by polling — the main process is the one that knows when a
 * turn failed to authenticate.
 */
export function useCliDetection() {
  return useQuery({
    queryKey: qk.clis,
    queryFn: () => ipc.detectClis(false),
    staleTime: 60_000,
  });
}

/** Re-probe the CLIs, forgetting what a failed turn concluded about auth. */
export function useRecheckClis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.detectClis(true),
    onSuccess: (detection) => qc.setQueryData(qk.clis, detection),
  });
}

export function useChatSessions(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.chatSessions(projectId ?? ""),
    queryFn: () => ipc.listChatSessions(projectId!),
    enabled: Boolean(projectId),
    staleTime: 2_000,
  });
}

/**
 * The project's git branch. Cheap (two syscalls, no child process) but not
 * free, and a branch changes under the app's feet — hence a short staleness
 * window rather than a watch.
 */
export function useGitHead(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.gitHead(projectId ?? ""),
    queryFn: () => ipc.gitHead(projectId!),
    enabled: Boolean(projectId),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

/** A conversation carrying the project it belongs to, for cross-project lists. */
export type ChatSessionWithProject = ChatSession & { projectName: string; projectPath: string };

/**
 * Every conversation of every project, newest first.
 *
 * One query per project rather than a new IPC call: these are the same query
 * keys the sidebar and the palette already use, so a project the user just
 * looked at costs nothing here, and a chat renamed anywhere invalidates one
 * key and updates every list at once.
 */
export function useAllChatSessions(projects: Project[]) {
  return useQueries({
    queries: projects.map((project) => ({
      queryKey: qk.chatSessions(project.id),
      queryFn: () => ipc.listChatSessions(project.id),
      staleTime: 2_000,
    })),
    combine: (results) => ({
      isPending: results.some((r) => r.isPending),
      sessions: results
        .flatMap((result, i) => {
          const project = projects[i];
          if (!project || !result.data) return [];
          return result.data.map(
            (session): ChatSessionWithProject => ({
              ...session,
              projectName: project.name,
              projectPath: project.path,
            }),
          );
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }),
  });
}

/** One session with its transcript. Live tokens come from the stream store. */
export function useChatSession(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: qk.chatSession(sessionId ?? ""),
    queryFn: () => ipc.getChatSession(sessionId!),
    enabled: Boolean(sessionId),
    staleTime: 0,
  });
}

export function useDeleteChatSession(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => ipc.deleteChatSession(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.chatSessions(projectId) }),
  });
}

export function useSettingMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => ipc.setSetting(key, value),
    onSuccess: (data) => qc.setQueryData(qk.setting(data.key), data),
  });
}
