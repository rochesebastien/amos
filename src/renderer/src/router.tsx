import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { ScanSync } from "@/components/ScanSync";
import { SettingsLayout } from "@/views/settings/SettingsLayout";
import { WelcomeView } from "@/views/WelcomeView";
import { ProjectView } from "@/views/ProjectView";
import { ItemView } from "@/views/ItemView";
import { NewItemView } from "@/views/NewItemView";
import { GeneralSettings } from "@/views/settings/GeneralSettings";

function RootShell() {
  // On /settings the dedicated settings sidebar replaces the main app sidebar.
  const onSettings = useRouterState({
    select: (s) => s.location.pathname.startsWith("/settings"),
  });
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <ScanSync />
      {!onSettings && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootShell });

/** Home: welcome screen + recent projects. */
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: WelcomeView,
});

/** Project overview. The chat route joins these in a later phase. */
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId",
  component: ProjectView,
});

/** Editor for one agent / skill / MCP server of a project. */
const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId/item/$itemId",
  component: ItemView,
});

/** Create a new agent / skill / MCP server. `$kind` is one of those three. */
const newItemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId/new/$kind",
  component: NewItemView,
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

const routeTree = rootRoute.addChildren([
  welcomeRoute,
  projectRoute,
  itemRoute,
  newItemRoute,
  settingsRoute.addChildren([settingsIndexRoute, generalSettingsRoute]),
]);

// Hash history: the packaged app is served from `file://`, where path-based
// history has no server to fall back on.
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
