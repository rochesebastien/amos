// Shared harness for the renderer suites: a fake preload bridge and a render
// helper that wraps the component under test in the same providers the real
// app shell gives it (query client, router, tooltips, confirm dialogs).
//
// Every renderer test goes through these two helpers so a new provider added
// to the app shell has exactly one place to be added here too.
import * as React from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ProjectScan } from "@shared/capabilities";
import type { ChatSession } from "@shared/chat";
import type { Project } from "@shared/ipc";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/ui/confirm";

/** Two projects, enough for anything that lists or searches across them. */
export const PROJECTS: Project[] = [
  {
    id: "p1",
    path: "/home/dev/amos",
    name: "amos",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "p2",
    path: "/home/dev/other",
    name: "other",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: null,
  },
];

export const EMPTY_SCAN: ProjectScan = {
  projectPath: "/home/dev/amos",
  scannedAt: "2026-01-01T00:00:00.000Z",
  items: [],
  instructions: [],
  errors: [],
  targets: [],
};

export type BridgeOverrides = {
  projects?: Project[];
  scan?: (projectId: string) => ProjectScan;
  sessions?: (projectId: string) => ChatSession[];
  branches?: string[];
  /** Seed settings; the fake bridge keeps writes in this same map. */
  settings?: Record<string, string>;
};

/**
 * Enough of the preload bridge for the components under test. Pass overrides
 * to give a test its own corpus; everything defaults to "empty but valid".
 */
export function installBridge(overrides: BridgeOverrides = {}) {
  const projects = overrides.projects ?? PROJECTS;
  const settings = overrides.settings ?? {};
  window.amos = {
    projects: { list: async () => projects },
    scan: {
      project: async ({ projectId }: { projectId: string }) =>
        overrides.scan ? overrides.scan(projectId) : EMPTY_SCAN,
    },
    chat: {
      listSessions: async ({ projectId }: { projectId: string }) =>
        overrides.sessions ? overrides.sessions(projectId) : [],
    },
    git: {
      head: async () => ({ head: { branch: "main", detachedAt: null } }),
      branches: async () => ({ branches: overrides.branches ?? [] }),
      checkout: async () => ({ ok: true }),
    },
    settings: {
      get: async ({ key }: { key: string }) => ({ key, value: settings[key] ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => {
        settings[key] = value;
        return { key, value };
      },
    },
  } as unknown as typeof window.amos;
}

/**
 * Render `ui` with the providers the app shell gives it. Returns the
 * testing-library handle plus the router, so a test can assert where a
 * navigation landed without reaching into window internals.
 */
export function renderInApp(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfirmProvider>
          <RouterProvider router={router as never} />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...result, router };
}
