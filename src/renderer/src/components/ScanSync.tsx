import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { qk } from "@/lib/queries";
import { useSidebar } from "@/lib/sidebar";

/**
 * Keeps what the window shows in step with what is on disk.
 *
 * Two halves: it asks the main process to watch the projects this window is
 * actually looking at — the one open plus any unfolded in the sidebar — and it
 * turns each debounced `scan:changed` push into a cache invalidation, which is
 * all TanStack Query needs to refetch the scan of that project.
 *
 * Renders nothing; mounted once, in the app shell.
 */
export function ScanSync() {
  const qc = useQueryClient();
  const expanded = useSidebar((s) => s.expanded);
  const activeProjectId = useRouterState({
    select: (s) => {
      const parts = s.location.pathname.split("/");
      return parts[1] === "p" ? (parts[2] ?? null) : null;
    },
  });

  // One subscription for the window's whole lifetime.
  useEffect(() => {
    return ipc.onScanChanged((event) => {
      void qc.invalidateQueries({ queryKey: qk.scan(event.projectId) });
      void qc.invalidateQueries({ queryKey: ["dir"] });
    });
  }, [qc]);

  // `join` keeps the effect from re-running on every render for an unchanged
  // set of ids — the array identity changes, its contents rarely do.
  const watchedIds = [...new Set([activeProjectId, ...expanded].filter((id): id is string => !!id))];
  const key = watchedIds.slice().sort().join("|");

  useEffect(() => {
    const ids = key ? key.split("|") : [];
    for (const id of ids) void ipc.watchProject(id).catch(() => undefined);
    return () => {
      for (const id of ids) void ipc.unwatchProject(id).catch(() => undefined);
    };
  }, [key]);

  return null;
}
