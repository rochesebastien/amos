import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen, FolderPlus, Trash2, AlertCircle } from "lucide-react";
import { ipc, type Project } from "@/lib/ipc";
import { useProjectMutations, useProjects } from "@/lib/queries";
import { relativeTime, useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { LogoMark } from "@/components/Logo";

/**
 * The landing view: pick a folder to manage, or jump back into a recent one.
 */
export function WelcomeView() {
  const t = useT();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: projects = [] } = useProjects();
  const { add, remove, touch } = useProjectMutations();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goTo = (projectId: string) =>
    navigate({ to: "/p/$projectId", params: { projectId } });

  const openFolder = async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await ipc.pickFolder();
      if (!picked.path) return;
      const project = await add.mutateAsync(picked.path);
      goTo(project.id);
    } catch (e) {
      setError(t("welcome.openFailed", { error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const openRecent = async (p: Project) => {
    setError(null);
    try {
      await touch.mutateAsync(p.id);
      goTo(p.id);
    } catch (e) {
      setError(t("welcome.openFailed", { error: (e as Error).message }));
    }
  };

  const removeRecent = async (e: React.MouseEvent, p: Project) => {
    e.stopPropagation();
    const ok = await confirm({
      title: t("projects.removeTitle"),
      description: t("projects.removeDesc", { name: p.name }),
      confirmText: t("common.remove"),
      destructive: true,
    });
    if (!ok) return;
    await remove.mutateAsync(p.id);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-8 py-16">
        <header className="flex flex-col items-center gap-4 text-center">
          <LogoMark className="size-20" />
          <h1 className="text-3xl font-display">{t("welcome.title")}</h1>
          <p className="max-w-lg text-sm text-muted-foreground/80">{t("welcome.subtitle")}</p>
          <Button size="lg" onClick={() => void openFolder()} disabled={busy}>
            <FolderPlus className="size-4" />
            {busy ? t("welcome.opening") : t("welcome.openFolder")}
          </Button>
          {error && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </p>
          )}
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {t("welcome.recents")}
          </h2>
          {projects.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground/70">
              {t("welcome.noRecents")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {projects.map((p) => (
                <li key={p.id}>
                  <div
                    onClick={() => void openRecent(p)}
                    className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-accent"
                  >
                    <FolderOpen className="size-4 shrink-0 text-primary" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{p.name}</span>
                      <span className="truncate text-xs text-muted-foreground/70">{p.path}</span>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground/60">
                      {p.lastOpenedAt
                        ? t("projects.lastOpened", { when: relativeTime(t, p.lastOpenedAt) })
                        : t("projects.never")}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => void removeRecent(e, p)}
                          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-70"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("projects.remove")}</TooltipContent>
                    </Tooltip>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
