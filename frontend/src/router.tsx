import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/views/ChatView";
import { ProjectsView } from "@/views/ProjectsView";
import { McpsView } from "@/views/McpsView";
import { SettingsView } from "@/views/SettingsView";

const rootRoute = createRootRoute({
  component: () => (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  ),
});

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

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsView,
});

const routeTree = rootRoute.addChildren([
  chatIndexRoute,
  conversationRoute,
  projectsRoute,
  mcpsRoute,
  settingsRoute,
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
