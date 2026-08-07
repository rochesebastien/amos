import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FolderKanban, Plus, Pencil, Trash2, Plug, MessageCirclePlus } from "lucide-react";
import { type Project } from "@/lib/api";
import { useProjectMutations, useProjects } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { ProjectModal } from "@/components/ProjectModal";
import { useT } from "@/lib/i18n";

export function ProjectsView() {
  const t = useT();
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  const mutations = useProjectMutations();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Project | null>(null);
  const [open, setOpen] = useState(false);

  const startNewChat = (projectId: number) =>
    navigate({ to: "/", search: { project: projectId } });

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (p: Project) => {
    setEditing(p);
    setOpen(true);
  };

  const remove = async (p: Project) => {
    const ok = await confirm({
      title: t("projects.deleteTitle"),
      description: t("projects.deleteDesc", { name: p.name }),
      confirmText: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await mutations.remove.mutateAsync(p.id);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 px-6 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-display">{t("nav.projects")}</h1>
          <p className="mt-1 text-sm text-muted-foreground/70">
            {t("projects.subtitle")}
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="size-4" /> {t("projects.new")}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {projects.length === 0 ? (
          <EmptyState onNew={openNew} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="size-4 text-primary" />
                    <h3 className="font-display text-base">{p.name}</h3>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => startNewChat(p.id)}>
                          <MessageCirclePlus className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("projects.newChat")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(p)}>
                          <Pencil className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("projects.edit")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" onClick={() => remove(p)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("common.delete")}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                {p.description && (
                  <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">
                    {p.description}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {p.mcp_ids.length > 0 ? (
                    <Badge variant="primary">
                      <Plug className="size-3" /> {t("projects.mcpCount", { count: p.mcp_ids.length })}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{t("projects.noMcps")}</Badge>
                  )}
                  {p.model && <Badge variant="secondary">{p.model}</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ProjectModal open={open} onClose={() => setOpen(false)} project={editing} />
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <FolderKanban className="size-6" />
      </div>
      <h2 className="text-xl font-display">{t("projects.emptyTitle")}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("projects.emptyDesc")}
      </p>
      <Button onClick={onNew} className="mt-1">
        <Plus className="size-4" /> {t("projects.new")}
      </Button>
    </div>
  );
}
