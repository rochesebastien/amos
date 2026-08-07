import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, FileText, FolderOpen, RefreshCw } from "lucide-react";
import {
  countItems,
  ECOSYSTEMS,
  type CapabilityKind,
  type ProjectScan,
} from "@shared/capabilities";
import { useProjects, useProjectScan } from "@/lib/queries";
import { relativeTime, useT, type TFunc } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { EcosystemBadge, KIND_ICONS, ScopeBadge } from "@/components/CapabilityBadges";
import { cn, formatBytes } from "@/lib/utils";

/**
 * Project overview: what the scanner found in this folder — counts per kind
 * and ecosystem, the instruction files that drive the two CLIs, and every file
 * that failed to parse.
 */

const SECTIONS: { kind: CapabilityKind; labelKey: string }[] = [
  { kind: "agent", labelKey: "project.agents" },
  { kind: "mcp", labelKey: "project.mcps" },
  { kind: "skill", labelKey: "project.skills" },
];

export function ProjectView() {
  const t = useT();
  const navigate = useNavigate();
  const { projectId } = useParams({ from: "/p/$projectId" });
  const { data: projects, isLoading } = useProjects();
  const scanQuery = useProjectScan(projectId);

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

  const scan = scanQuery.data;
  const broken = scan?.items.filter((i) => i.parseError) ?? [];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-start gap-4 px-8 pt-8 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-3 text-3xl font-display">
            <FolderOpen className="size-7 shrink-0 text-primary" />
            <span className="truncate">{project.name}</span>
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground/70" title={project.path}>
            {t("project.folder")}: {project.path}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/60">
            {project.lastOpenedAt
              ? t("projects.lastOpened", { when: relativeTime(t, project.lastOpenedAt) })
              : t("projects.never")}
            {scan && ` · ${t("project.scannedAt", { when: relativeTime(t, scan.scannedAt) })}`}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void scanQuery.refetch()}
          disabled={scanQuery.isFetching}
        >
          <RefreshCw className={cn("size-4", scanQuery.isFetching && "animate-spin")} />
          {scanQuery.isFetching ? t("project.scanning") : t("project.rescan")}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        {scanQuery.isError && (
          <p className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {t("project.scanFailed", { error: (scanQuery.error as Error).message })}
          </p>
        )}

        <div className="grid max-w-4xl gap-4 sm:grid-cols-3">
          {SECTIONS.map(({ kind, labelKey }) => (
            <KindCard key={kind} t={t} kind={kind} label={t(labelKey)} scan={scan} />
          ))}
        </div>

        {/* instruction files */}
        <section className="mt-8 max-w-4xl">
          <h2 className="mb-2 flex items-center gap-2 text-base font-display">
            <FileText className="size-4 text-primary" />
            {t("project.instructions")}
          </h2>
          {scan && scan.instructions.length === 0 && (
            <p className="text-sm text-muted-foreground/70">{t("project.noInstructions")}</p>
          )}
          <ul className="flex flex-col gap-1">
            {scan?.instructions.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                title={file.path}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                  {file.relativePath}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground/60">
                  {formatBytes(file.bytes)}
                </span>
                <EcosystemBadge ecosystem={file.ecosystem} />
                <ScopeBadge scope={file.scope} />
              </li>
            ))}
          </ul>
        </section>

        {/* broken files */}
        {(broken.length > 0 || (scan?.errors.length ?? 0) > 0) && (
          <section className="mt-8 max-w-4xl">
            <h2 className="mb-1 flex items-center gap-2 text-base font-display text-destructive">
              <AlertTriangle className="size-4" />
              {t("project.brokenTitle")}
            </h2>
            <p className="mb-2 text-sm text-muted-foreground/70">{t("project.brokenDesc")}</p>
            <ul className="flex flex-col gap-1">
              {broken.map((item) => (
                <li key={item.id}>
                  <Link
                    to="/p/$projectId/item/$itemId"
                    params={{ projectId, itemId: item.id }}
                    className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm transition-colors hover:bg-destructive/10"
                    title={item.sourceFile}
                  >
                    <span className="shrink-0 font-semibold">{item.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
                      {item.parseError}
                    </span>
                    <EcosystemBadge ecosystem={item.ecosystem} />
                  </Link>
                </li>
              ))}
              {scan?.errors.map((err) => (
                <li
                  key={err.path}
                  className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
                >
                  <span className="font-mono text-[13px]">{err.path}</span>
                  <span className="ml-2 text-xs text-muted-foreground/70">{err.message}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** Counts for one kind: total, per ecosystem, and project vs global. */
function KindCard({
  t,
  kind,
  label,
  scan,
}: {
  t: TFunc;
  kind: CapabilityKind;
  label: string;
  scan: ProjectScan | undefined;
}) {
  const Icon = KIND_ICONS[kind];
  const items = scan?.items ?? [];
  const total = scan ? countItems(items, { kind }) : null;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-2 flex items-center gap-2 text-base font-display">
        <Icon className="size-4 text-primary" />
        {label}
        <span className="ml-auto text-2xl font-display tabular-nums">
          {total === null ? "…" : total}
        </span>
      </h2>
      {total === 0 && <p className="text-sm text-muted-foreground/70">{t("cap.none")}</p>}
      {total !== null && total > 0 && (
        <div className="flex flex-col gap-1 text-sm text-muted-foreground/80">
          <div className="flex flex-wrap items-center gap-2">
            {ECOSYSTEMS.filter((eco) => countItems(items, { kind, ecosystem: eco }) > 0).map(
              (eco) => (
                <span key={eco} className="flex items-center gap-1">
                  <EcosystemBadge ecosystem={eco} />
                  <span className="tabular-nums">{countItems(items, { kind, ecosystem: eco })}</span>
                </span>
              ),
            )}
          </div>
          <p className="text-xs text-muted-foreground/60">
            {t("project.countProject", { n: countItems(items, { kind, scope: "project" }) })} ·{" "}
            {t("project.countGlobal", { n: countItems(items, { kind, scope: "global" }) })}
          </p>
        </div>
      )}
    </section>
  );
}
