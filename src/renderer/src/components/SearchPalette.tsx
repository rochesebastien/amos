import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { FileText, Folder, MessageSquare, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { CapabilityItem, InstructionFile, ProjectScan } from "@shared/capabilities";
import type { ChatSession } from "@shared/chat";
import type { Project } from "@shared/ipc";
import { ipc } from "@/lib/ipc";
import { qk, useProjects } from "@/lib/queries";
import { useT, type TFunc } from "@/lib/i18n";
import { EcosystemGlyph } from "@/components/BrandIcons";
import { KIND_ICONS } from "@/components/CapabilityBadges";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * The command-palette search (⌘K / Ctrl+K, or the sidebar's Search entry):
 * one input over everything AMOS knows — projects, agents, skills, MCP
 * servers, instruction files and past conversations, across every project.
 *
 * The index is not a service: on open, the palette pulls each project's scan
 * and chat sessions through the same TanStack Query keys the sidebar and the
 * views use, so anything already scanned is free and anything missing is
 * fetched once and then shared. Matching is a plain substring test — the
 * corpus is a few hundred names, not a search problem.
 */

type Hit =
  | { type: "project"; project: Project }
  | { type: "item"; projectId: string; projectName: string; item: CapabilityItem }
  | { type: "instruction"; projectId: string; projectName: string; file: InstructionFile }
  | { type: "chat"; projectId: string; projectName: string; session: ChatSession };

type ProjectSources = {
  project: Project;
  scan: ProjectScan | null;
  sessions: ChatSession[];
};

const GROUP_LIMIT = 8;

/** Order the groups render in; also the ranking between groups. */
const GROUPS: { type: Hit["type"] | "agent" | "skill" | "mcp"; labelKey: string }[] = [
  { type: "project", labelKey: "sidebar.projects" },
  { type: "agent", labelKey: "project.agents" },
  { type: "skill", labelKey: "project.skills" },
  { type: "mcp", labelKey: "project.mcps" },
  { type: "instruction", labelKey: "project.instructions" },
  { type: "chat", labelKey: "search.chats" },
];

function groupOf(hit: Hit): string {
  return hit.type === "item" ? hit.item.kind : hit.type;
}

function matches(query: string, ...texts: (string | null | undefined)[]): boolean {
  return texts.some((s) => s != null && s.toLowerCase().includes(query));
}

function search(sources: ProjectSources[], rawQuery: string): Hit[] {
  const query = rawQuery.trim().toLowerCase();
  const all: Hit[] = [];
  for (const { project, scan, sessions } of sources) {
    if (query === "" || matches(query, project.name, project.path)) {
      all.push({ type: "project", project });
    }
    if (query === "") continue; // empty query: projects only, as a launcher
    for (const item of scan?.items ?? []) {
      const description = item.data && "description" in item.data ? item.data.description : null;
      if (matches(query, item.name, description)) {
        all.push({ type: "item", projectId: project.id, projectName: project.name, item });
      }
    }
    for (const file of scan?.instructions ?? []) {
      if (matches(query, file.name, file.relativePath)) {
        all.push({ type: "instruction", projectId: project.id, projectName: project.name, file });
      }
    }
    for (const session of sessions) {
      if (matches(query, session.title)) {
        all.push({ type: "chat", projectId: project.id, projectName: project.name, session });
      }
    }
  }
  // Stable-sort into group order, capping each group so one noisy kind
  // cannot push the others off screen.
  const out: Hit[] = [];
  for (const group of GROUPS) {
    out.push(...all.filter((h) => groupOf(h) === group.type).slice(0, GROUP_LIMIT));
  }
  return out;
}

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useProjects();

  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [sources, setSources] = React.useState<ProjectSources[] | null>(null);
  const listId = React.useId();

  // Gather the corpus when the palette opens. Failures degrade to "that
  // project contributes nothing" instead of taking the palette down.
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    let cancelled = false;
    void Promise.all(
      projects.map(async (project): Promise<ProjectSources> => {
        const [scan, sessions] = await Promise.all([
          queryClient
            .fetchQuery({
              queryKey: qk.scan(project.id),
              queryFn: () => ipc.scanProject(project.id),
              staleTime: 30_000,
            })
            .catch(() => null),
          queryClient
            .fetchQuery({
              queryKey: qk.chatSessions(project.id),
              queryFn: () => ipc.listChatSessions(project.id),
              staleTime: 30_000,
            })
            .catch(() => [] as ChatSession[]),
        ]);
        return { project, scan, sessions };
      }),
    ).then((s) => {
      if (!cancelled) setSources(s);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projects, queryClient]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const hits = React.useMemo(() => (sources ? search(sources, query) : []), [sources, query]);
  const clamped = Math.min(active, Math.max(0, hits.length - 1));

  const openHit = (hit: Hit) => {
    onClose();
    switch (hit.type) {
      case "project":
        void navigate({ to: "/p/$projectId", params: { projectId: hit.project.id } });
        break;
      case "item":
        void navigate({
          to: "/p/$projectId/item/$itemId",
          params: { projectId: hit.projectId, itemId: hit.item.id },
        });
        break;
      case "instruction":
        void navigate({
          to: "/p/$projectId/instructions/$fileId",
          params: { projectId: hit.projectId, fileId: hit.file.id },
        });
        break;
      case "chat":
        void navigate({
          to: "/p/$projectId/chat/$sessionId",
          params: { projectId: hit.projectId, sessionId: hit.session.id },
        });
        break;
    }
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = (clamped + delta + hits.length) % hits.length;
      setActive(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && hits[clamped]) {
      e.preventDefault();
      openHit(hits[clamped]);
    }
  };

  if (!open) return null;

  const loading = sources === null;
  let index = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/25 p-4 pt-[12vh] animate-fade-in">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-label={t("search.title")}
        className="relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            placeholder={t("search.placeholder")}
            aria-label={t("search.title")}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits[clamped] ? `${listId}-${clamped}` : undefined}
            aria-autocomplete="list"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/50"
          />
          {loading && <Spinner className="size-4 shrink-0 text-muted-foreground" />}
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label={t("search.title")}
          className="max-h-[46vh] overflow-y-auto p-1.5"
        >
          {!loading && hits.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground/70">
              {query.trim() === "" ? t("search.start") : t("search.empty", { query: query.trim() })}
            </p>
          )}
          {GROUPS.map((group) => {
            const groupHits = hits.filter((h) => groupOf(h) === group.type);
            if (groupHits.length === 0) return null;
            return (
              <div key={group.type} className="py-1">
                <p className="px-2.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {t(group.labelKey)}
                </p>
                {groupHits.map((hit) => {
                  index += 1;
                  const i = index;
                  return (
                    <HitRow
                      key={`${listId}-${i}`}
                      id={`${listId}-${i}`}
                      t={t}
                      hit={hit}
                      active={i === clamped}
                      onHover={() => setActive(i)}
                      onOpen={() => openHit(hit)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground/70">
          <span>
            <Kbd>↑↓</Kbd> {t("search.hintNavigate")}
          </span>
          <span>
            <Kbd>↵</Kbd> {t("search.hintOpen")}
          </span>
          <span>
            <Kbd>esc</Kbd> {t("search.hintClose")}
          </span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-px font-sans text-[10px]">
      {children}
    </kbd>
  );
}

function HitRow({
  id,
  t,
  hit,
  active,
  onHover,
  onOpen,
}: {
  id: string;
  t: TFunc;
  hit: Hit;
  active: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  let Icon: typeof Folder;
  let name: string;
  let detail: string | null = null;
  let ecosystem: "claude" | "codex" | null = null;

  switch (hit.type) {
    case "project":
      Icon = Folder;
      name = hit.project.name;
      detail = hit.project.path;
      break;
    case "item":
      Icon = KIND_ICONS[hit.item.kind];
      name = hit.item.name;
      detail = hit.projectName;
      ecosystem = hit.item.ecosystem;
      break;
    case "instruction":
      Icon = FileText;
      name = hit.file.relativePath;
      detail = hit.projectName;
      ecosystem = hit.file.ecosystem;
      break;
    case "chat":
      Icon = MessageSquare;
      name = hit.session.title || t("chat.untitled");
      detail = hit.projectName;
      break;
  }

  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {detail && (
        <span className="max-w-[40%] shrink-0 truncate text-[12px] text-muted-foreground/60">
          {detail}
        </span>
      )}
      {ecosystem && (
        <EcosystemGlyph
          ecosystem={ecosystem}
          className="size-3.5 shrink-0 text-foreground/70"
          title={t(`cap.eco.${ecosystem}`)}
        />
      )}
    </button>
  );
}
