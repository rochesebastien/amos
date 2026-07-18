// TanStack Query client, query keys, and typed hooks for the CheveluAI backend.
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type MCPInput,
  type ProjectInput,
  type SettingsUpdate,
} from "./api";

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
  settings: ["settings"] as const,
  models: ["models"] as const,
  projects: ["projects"] as const,
  mcps: ["mcps"] as const,
  conversations: ["conversations"] as const,
  conversation: (id: number) => ["conversation", id] as const,
  agentDir: (projectId: number) => ["agentDir", projectId] as const,
  agentFile: (projectId: number, path: string) => ["agentFile", projectId, path] as const,
};

// ----- Queries --------------------------------------------------------------

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.getSettings });
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: api.listProjects });
}

export function useMcps() {
  return useQuery({ queryKey: qk.mcps, queryFn: api.listMcps });
}

export function useConversations() {
  return useQuery({ queryKey: qk.conversations, queryFn: api.listConversations });
}

export function useConversation(id: number | null) {
  return useQuery({
    queryKey: id != null ? qk.conversation(id) : ["conversation", "none"],
    queryFn: () => api.getConversation(id as number),
    enabled: id != null,
  });
}

export function useAgentDir(projectId: number | null) {
  return useQuery({
    queryKey: projectId != null ? qk.agentDir(projectId) : ["agentDir", "none"],
    queryFn: () => api.getAgentDir(projectId as number),
    enabled: projectId != null,
  });
}

export function useAgentFile(projectId: number, path: string | null) {
  return useQuery({
    queryKey: path != null ? qk.agentFile(projectId, path) : ["agentFile", projectId, "none"],
    queryFn: () => api.getAgentFile(projectId, path as string),
    enabled: path != null,
  });
}

// ----- Mutations ------------------------------------------------------------

export function useProjectMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.projects });
    qc.invalidateQueries({ queryKey: qk.conversations });
  };
  return {
    create: useMutation({
      mutationFn: (body: ProjectInput) => api.createProject(body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: number; body: ProjectInput }) =>
        api.updateProject(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api.deleteProject(id),
      onSuccess: invalidate,
    }),
  };
}

export function useAgentFileMutations(projectId: number) {
  const qc = useQueryClient();
  const invalidateDir = () => qc.invalidateQueries({ queryKey: qk.agentDir(projectId) });
  const invalidateFile = (path: string) =>
    qc.invalidateQueries({ queryKey: qk.agentFile(projectId, path) });
  return {
    save: useMutation({
      mutationFn: ({ path, content }: { path: string; content: string }) =>
        api.saveAgentFile(projectId, path, content),
      onSuccess: (_data, { path }) => {
        invalidateDir();
        invalidateFile(path);
      },
    }),
    remove: useMutation({
      mutationFn: (path: string) => api.deleteAgentFile(projectId, path),
      onSuccess: (_data, path) => {
        invalidateDir();
        invalidateFile(path);
      },
    }),
    symlink: useMutation({
      mutationFn: ({ linkPath, targetPath }: { linkPath: string; targetPath: string }) =>
        api.createAgentSymlink(projectId, linkPath, targetPath),
      onSuccess: (_data, { linkPath }) => {
        invalidateDir();
        invalidateFile(linkPath);
      },
    }),
  };
}

export function useMcpMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.mcps });
  return {
    create: useMutation({
      mutationFn: (body: MCPInput) => api.createMcp(body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: number; body: MCPInput }) =>
        api.updateMcp(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api.deleteMcp(id),
      onSuccess: invalidate,
    }),
  };
}

export function useSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsUpdate) => api.updateSettings(body),
    onSuccess: (data) => qc.setQueryData(qk.settings, data),
  });
}
