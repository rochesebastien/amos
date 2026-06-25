import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/views/ChatView";
import { ProjectsView } from "@/views/ProjectsView";
import { McpsView } from "@/views/McpsView";
import { SettingsView } from "@/views/SettingsView";
import { useApp } from "@/lib/store";

export default function App() {
  const view = useApp((s) => s.view);
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {view === "chat" && <ChatView />}
        {view === "projects" && <ProjectsView />}
        {view === "mcps" && <McpsView />}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
