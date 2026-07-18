import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { SettingsLayout } from "@/views/settings/SettingsLayout";
import { ChatView } from "@/views/ChatView";
import { ProjectsView } from "@/views/ProjectsView";
import { McpsView } from "@/views/McpsView";
import { AgentsIndexView, AgentsProjectView } from "@/views/AgentsView";
import { GeneralSettings } from "@/views/settings/GeneralSettings";
import { ModelsSettings } from "@/views/settings/ModelsSettings";
import { StorageSettings } from "@/views/settings/StorageSettings";

function RootShell() {
  // On /settings the dedicated settings sidebar replaces the main app sidebar.
  const onSettings = useRouterState({
    select: (s) => s.location.pathname.startsWith("/settings"),
  });
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {!onSettings && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootShell });

type ChatSearch = { project?: number };

const chatIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (search: Record<string, unknown>): ChatSearch => {
    const p = Number(search.project);
    return Number.isFinite(p) && p > 0 ? { project: p } : {};
  },
  component: ChatView,
});

const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/c/$conversationId",
  component: ChatView,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectsView,
});

const mcpsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcps",
  component: McpsView,
});

const agentsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: AgentsIndexView,
});

type AgentsProjectSearch = { file?: string };

const agentsProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents/$projectId",
  validateSearch: (search: Record<string, unknown>): AgentsProjectSearch => {
    const f = search.file;
    return typeof f === "string" && f ? { file: f } : {};
  },
  component: AgentsProjectView,
});

// --- Settings: layout route with its own sub-sidebar + nested sections -------

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsLayout,
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/general" });
  },
});

const generalSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "general",
  component: GeneralSettings,
});

const modelsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "models",
  component: ModelsSettings,
});

const storageSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "storage",
  component: StorageSettings,
});

const routeTree = rootRoute.addChildren([
  chatIndexRoute,
  conversationRoute,
  projectsRoute,
  mcpsRoute,
  agentsIndexRoute,
  agentsProjectRoute,
  settingsRoute.addChildren([
    settingsIndexRoute,
    generalSettingsRoute,
    modelsSettingsRoute,
    storageSettingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
