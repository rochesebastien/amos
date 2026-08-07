// TanStack Query client, query keys, and typed hooks over the IPC bridge.
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  setting: (key: string) => ["setting", key] as const,
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

export function useSettingMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => ipc.setSetting(key, value),
    onSuccess: (data) => qc.setQueryData(qk.setting(data.key), data),
  });
}
