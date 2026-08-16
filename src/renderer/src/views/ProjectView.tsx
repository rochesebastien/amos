import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, FileText, FolderOpen, Plus, RefreshCw, SquareTerminal } from "lucide-react";
import {
  findRootInstruction,
  hasRootInstruction,
  itemsOfKind,
  joinPath,
  ROOT_INSTRUCTION_FILES,
  type CapabilityKind,
  type Ecosystem,
  type ProjectScan,
} from "@shared/capabilities";
import type { TerminalKind } from "@shared/terminal";
import { useProjects, useProjectScan, useWriteFile } from "@/lib/queries";
import { relativeTime, useT, type TFunc } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorText } from "@/components/editors/shell";
import { ViewHeader } from "@/components/ViewHeader";
import { EcosystemBadge, KIND_ICONS, ScopeIcon } from "@/components/CapabilityBadges";
import { EcosystemGlyph } from "@/components/BrandIcons";
import { useTerminals } from "@/lib/terminals";
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
  const openTab = useTerminals((s) => s.openTab);

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
  const openTerminal = (kind: TerminalKind) =>
    openTab({ projectId: project.id, projectName: project.name, kind });

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ViewHeader
        icon={<FolderOpen className="size-4" />}
        title={project.name}
        meta={
          <span
            className="hidden truncate font-mono text-[12px] text-muted-foreground/60 md:block"
            title={project.path}
          >
            {project.path}
          </span>
        }
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={scanQuery.isFetching ? t("project.scanning") : t("project.rescan")}
                  onClick={() => void scanQuery.refetch()}
                  disabled={scanQuery.isFetching}
                >
                  <RefreshCw className={cn("size-4", scanQuery.isFetching && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("project.rescan")}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={t("terminal.open")} title={t("terminal.open")}>
                  <SquareTerminal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openTerminal("claude")}>
                  <EcosystemGlyph ecosystem="claude" className="size-3.5" />
                  Claude
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openTerminal("codex")}>
                  <EcosystemGlyph ecosystem="codex" className="size-3.5" />
                  Codex
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openTerminal("shell")}>
                  <SquareTerminal className="size-3.5" />
                  {t("terminal.shell")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <p className="mb-5 text-xs text-muted-foreground/60">
          {project.lastOpenedAt
            ? t("projects.lastOpened", { when: relativeTime(t, project.lastOpenedAt) })
            : t("projects.never")}
          {scan && ` · ${t("project.scannedAt", { when: relativeTime(t, scan.scannedAt) })}`}
        </p>
        {scanQuery.isError && (
          <p className="mb-4 max-w-5xl rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {t("project.scanFailed", { error: (scanQuery.error as Error).message })}
          </p>
        )}

        <div className="flex max-w-5xl flex-col gap-6">
          {SECTIONS.map(({ kind, labelKey }) => (
            <CapabilityTable
              key={kind}
              t={t}
              projectId={projectId}
              kind={kind}
              label={t(labelKey)}
              items={itemsOfKind(scan?.items ?? [], kind)}
              loading={!scan}
            />
          ))}

          <InstructionsTable
            t={t}
            projectId={projectId}
            projectName={project.name}
            scan={scan}
          />

          {(scan?.errors.length ?? 0) > 0 && (
            <Table
              title={t("project.brokenTitle")}
              icon={<AlertTriangle className="size-4 text-destructive" />}
              count={scan?.errors.length ?? 0}
              destructive
            >
              {scan?.errors.map((err) => (
                <tr key={err.path} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-[13px] text-destructive">{err.path}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground/70" colSpan={3}>
                    {err.message}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}

/** The shared table frame: a titled header row, then the caller's `<tr>`s. */
function Table({
  title,
  icon,
  count,
  action,
  destructive,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  action?: ReactNode;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center gap-2 bg-muted/40 px-3 py-2">
        {icon}
        <h2 className={cn("text-[13px] font-display", destructive && "text-destructive")}>{title}</h2>
        <span className="text-xs tabular-nums text-muted-foreground/50">{count}</span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <table className="w-full border-collapse text-sm">
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

const EMPTY_ROW = (
  <tr>
    <td className="px-3 py-3 text-[13px] text-muted-foreground/50" colSpan={4} />
  </tr>
);

/** One category as a table: every agent / MCP / skill, with a way to add one. */
function CapabilityTable({
  t,
  projectId,
  kind,
  label,
  items,
  loading,
}: {
  t: TFunc;
  projectId: string;
  kind: CapabilityKind;
  label: string;
  items: ReturnType<typeof itemsOfKind>;
  loading: boolean;
}) {
  const Icon = KIND_ICONS[kind];
  return (
    <Table
      title={label}
      icon={<Icon className="size-4 text-muted-foreground" />}
      count={items.length}
      action={
        <Link
          to="/p/$projectId/new/$kind"
          params={{ projectId, kind }}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="size-3.5" />
          {t(`new.title.${kind}`)}
        </Link>
      }
    >
      {loading ? (
        EMPTY_ROW
      ) : items.length === 0 ? (
        <tr>
          <td className="px-3 py-2.5 text-[13px] text-muted-foreground/50" colSpan={4}>
            {t("cap.none")}
          </td>
        </tr>
      ) : (
        items.map((item) => {
          const broken = item.parseError != null;
          const detail = broken
            ? item.parseError
            : "description" in (item.data ?? {})
              ? ((item.data as { description?: string | null }).description ?? "")
              : "";
          return (
            <tr key={item.id} className="border-t border-border">
              <td className="w-px whitespace-nowrap py-2 pl-3 pr-2">
                <Link
                  to="/p/$projectId/item/$itemId"
                  params={{ projectId, itemId: item.id }}
                  className={cn(
                    "inline-flex items-center gap-2 font-medium transition-colors hover:underline",
                    broken ? "text-destructive" : "text-foreground",
                  )}
                  title={item.sourceFile}
                >
                  <ScopeIcon scope={item.scope} className={cn(broken && "text-destructive")} />
                  {item.name}
                </Link>
              </td>
              <td
                className={cn(
                  "max-w-0 truncate px-2 py-2 text-[13px]",
                  broken ? "text-destructive/90" : "text-muted-foreground/70",
                )}
              >
                {detail}
              </td>
              <td className="w-px whitespace-nowrap px-3 py-2 text-right">
                <EcosystemBadge ecosystem={item.ecosystem} size="sm" />
              </td>
            </tr>
          );
        })
      )}
    </Table>
  );
}

/** Instruction files as a table, with the "create CLAUDE.md / AGENTS.md" row. */
function InstructionsTable({
  t,
  projectId,
  projectName,
  scan,
}: {
  t: TFunc;
  projectId: string;
  projectName: string;
  scan: ProjectScan | undefined;
}) {
  const files = scan?.instructions ?? [];
  return (
    <Table
      title={t("project.instructions")}
      icon={<FileText className="size-4 text-muted-foreground" />}
      count={files.length}
    >
      {files.length === 0 ? (
        <tr>
          <td className="px-3 py-2.5 text-[13px] text-muted-foreground/50" colSpan={4}>
            {t("project.noInstructions")}
          </td>
        </tr>
      ) : (
        files.map((file) => (
          <tr key={file.id} className="border-t border-border">
            <td className="w-px whitespace-nowrap py-2 pl-3 pr-2">
              <Link
                to="/p/$projectId/instructions/$fileId"
                params={{ projectId, fileId: file.id }}
                className="inline-flex items-center gap-2 font-mono text-[13px] transition-colors hover:underline"
                title={file.path}
              >
                <ScopeIcon scope={file.scope} />
                {file.relativePath}
              </Link>
            </td>
            <td className="px-2 py-2 text-xs text-muted-foreground/60">{formatBytes(file.bytes)}</td>
            <td className="w-px whitespace-nowrap px-3 py-2 text-right">
              <EcosystemBadge ecosystem={file.ecosystem} size="sm" />
            </td>
          </tr>
        ))
      )}
      {scan && (
        <tr className="border-t border-border">
          <td colSpan={4} className="px-3 py-2">
            <CreateInstructions t={t} projectId={projectId} projectName={projectName} scan={scan} />
          </td>
        </tr>
      )}
    </Table>
  );
}

/**
 * "Create CLAUDE.md" / "Create AGENTS.md", offered only for the ones the
 * project root does not have yet.
 *
 * The file is written with the "must not exist" guard the new-capability forms
 * use, so racing another tool to the same path fails loudly instead of
 * overwriting it. Where it lands is a convention of each CLI — the root of the
 * project — so there is nothing to ask the user about, and the editor opens on
 * the scaffold right away.
 */
function CreateInstructions({
  t,
  projectId,
  projectName,
  scan,
}: {
  t: TFunc;
  projectId: string;
  projectName: string;
  scan: ProjectScan;
}) {
  const navigate = useNavigate();
  const scanQuery = useProjectScan(projectId);
  const write = useWriteFile(projectId);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<string | null>(null);

  const missing = ROOT_INSTRUCTION_FILES.filter(
    (candidate) => !hasRootInstruction(scan.instructions, candidate.name),
  );
  if (missing.length === 0) return null;

  const create = async (name: string, ecosystem: Ecosystem) => {
    setError(null);
    setPending(name);
    try {
      await write.mutateAsync({
        path: joinPath(scan.projectPath, name),
        content: t(`instructions.scaffold.${ecosystem}`, { name: projectName }),
        // Creating over somebody's file is a conflict, not a merge.
        expectedMtimeMs: null,
      });
      const { data } = await scanQuery.refetch();
      const created = data ? findRootInstruction(data.instructions, name) : undefined;
      if (created) {
        void navigate({
          to: "/p/$projectId/instructions/$fileId",
          params: { projectId, fileId: created.id },
        });
      }
    } catch (err) {
      setError(err);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {missing.map(({ name, ecosystem }) => (
          <Button
            key={name}
            variant="outline"
            disabled={pending !== null}
            onClick={() => void create(name, ecosystem)}
          >
            <Plus className="size-4" />
            {pending === name ? t("common.saving") : t("instructions.create", { name })}
          </Button>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground/70">{t("instructions.createHint")}</p>
      {error != null && (
        <p className="mt-2 text-[13px] text-destructive">{errorText(error)}</p>
      )}
    </div>
  );
}

