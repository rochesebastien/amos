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
import { ChatSync } from "@/components/ChatSync";
import { TerminalPanel } from "@/components/TerminalPanel";
import { SettingsLayout } from "@/views/settings/SettingsLayout";
import { WelcomeView } from "@/views/WelcomeView";
import { ConversationsView } from "@/views/ConversationsView";
import { ProjectView } from "@/views/ProjectView";
import { ItemView } from "@/views/ItemView";
import { InstructionView } from "@/views/InstructionView";
import { NewItemView } from "@/views/NewItemView";
import { ChatView } from "@/views/ChatView";
import { GeneralSettings } from "@/views/settings/GeneralSettings";
import { BackendSettings } from "@/views/settings/BackendSettings";

function RootShell() {
  // On /settings the dedicated settings sidebar replaces the main app sidebar.
  const onSettings = useRouterState({
    select: (s) => s.location.pathname.startsWith("/settings"),
  });
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <ScanSync />
      <ChatSync />
      {!onSettings && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
      <TerminalPanel />
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

/** Every conversation of every project, newest first. */
const chatsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chats",
  component: ConversationsView,
});

/** Project overview. */
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId",
  component: ProjectView,
});

/** A new chat in this project. */
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId/chat",
  component: ChatView,
});

/** One saved conversation of this project. */
const chatSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId/chat/$sessionId",
  component: ChatView,
});

/** Editor for one agent / skill / MCP server of a project. */
const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId/item/$itemId",
  component: ItemView,
});

/** Editor for one `CLAUDE.md` / `AGENTS.md` the scan found. */
const instructionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectId/instructions/$fileId",
  component: InstructionView,
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

const backendsSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "backends",
  component: BackendSettings,
});

const routeTree = rootRoute.addChildren([
  welcomeRoute,
  chatsRoute,
  projectRoute,
  chatRoute,
  chatSessionRoute,
  itemRoute,
  instructionRoute,
  newItemRoute,
  settingsRoute.addChildren([settingsIndexRoute, generalSettingsRoute, backendsSettingsRoute]),
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
