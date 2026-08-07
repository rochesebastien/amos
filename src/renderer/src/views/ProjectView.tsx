import { useNavigate, useParams } from "@tanstack/react-router";
import { Bot, FolderOpen, Plug, Sparkles } from "lucide-react";
import { useProjects } from "@/lib/queries";
import { relativeTime, useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/**
 * Project overview. The Agents / Skills / MCP sections are placeholders until
 * the scanner lands — the shell, routing and project lookup are what this
 * phase needs to prove.
 */
export function ProjectView() {
  const t = useT();
  const navigate = useNavigate();
  const { projectId } = useParams({ from: "/p/$projectId" });
  const { data: projects, isLoading } = useProjects();

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground/70">
        {t("common.loading")}
      </div>
    );
  }

  const project = projects?.find((p) => p.id === projectId);
  if (!project) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-display">{t("project.notFound")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground/70">{t("project.notFoundDesc")}</p>
        <Button variant="outline" onClick={() => navigate({ to: "/" })}>
          {t("project.backHome")}
        </Button>
      </div>
    );
  }

  const sections = [
    { key: "project.agents", icon: Bot },
    { key: "project.skills", icon: Sparkles },
    { key: "project.mcps", icon: Plug },
  ] as const;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="px-8 pt-8 pb-4">
        <h1 className="flex items-center gap-3 text-3xl font-display">
          <FolderOpen className="size-7 text-primary" />
          {project.name}
        </h1>
        <p className="mt-1 truncate text-sm text-muted-foreground/70" title={project.path}>
          {t("project.folder")}: {project.path}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/60">
          {project.lastOpenedAt
            ? t("projects.lastOpened", { when: relativeTime(t, project.lastOpenedAt) })
            : t("projects.never")}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        <div className="grid max-w-4xl gap-4 sm:grid-cols-3">
          {sections.map(({ key, icon: Icon }) => (
            <section key={key} className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-2 flex items-center gap-2 text-base font-display">
                <Icon className="size-4 text-primary" />
                {t(key)}
              </h2>
              <p className="text-sm text-muted-foreground/70">{t("project.scanSoon")}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
