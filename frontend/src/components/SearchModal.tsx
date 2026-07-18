import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Bot, Sparkles } from "lucide-react";
import type { Conversation, Project } from "@/lib/api";
import { useAgentDirs, useConversations, useProjects } from "@/lib/queries";
import { useSidebar } from "@/lib/sidebar";
import { useT, useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Command-palette style search popup. The shell (overlay, input, keyboard nav)
// is generic; the result rows are swapped by the current sidebar mode — chats
// search conversations, agents search agent & skill names across all projects.

type ResultRow = {
  key: string;
  title: string;
  right: string; // project name (or "no project" label)
  date?: string; // chats: formatted first-message date
  kind?: "agent" | "skill"; // agents: item kind
  provider?: string; // agents: claude / codex
  // navigation target
  conversationId?: number;
  projectId?: number;
  filePath?: string;
};

function localeFor(lang: Lang): string {
  return lang === "fr" ? "fr-FR" : "en-US";
}

/** Build sorted+filtered conversation rows for the current query. */
function useConversationRows(query: string): ResultRow[] {
  const { data: conversations = [] } = useConversations();
  const { data: projects = [] } = useProjects();
  const lang = useLang((s) => s.lang);
  const t = useT();

  return React.useMemo(() => {
    const projectName = new Map<number, string>();
    for (const p of projects as Project[]) projectName.set(p.id, p.name);
    const noProject = t("threads.noProject");
    const locale = localeFor(lang);
    const q = query.trim().toLowerCase();

    const sorted = [...(conversations as Conversation[])].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

    const rows: ResultRow[] = [];
    for (const c of sorted) {
      const proj = c.project_id != null ? projectName.get(c.project_id) : undefined;
      const rightLabel = proj ?? noProject;
      if (q) {
        const haystack = `${c.title} ${proj ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      const date = new Date(c.created_at);
      rows.push({
        key: `c:${c.id}`,
        title: c.title,
        right: rightLabel,
        date: Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale),
        conversationId: c.id,
      });
    }
    return rows;
  }, [conversations, projects, query, lang, t]);
}

/** Build filtered agent/skill rows across every project with a linked directory. */
function useAgentRows(query: string, enabled: boolean): ResultRow[] {
  const { data: projects = [] } = useProjects();
  const entries = useAgentDirs(projects, enabled);

  return React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: ResultRow[] = [];
    for (const { project, overview } of entries) {
      if (!overview?.exists) continue;
      for (const f of overview.files) {
        if (f.kind !== "agent" && f.kind !== "skill") continue;
        if (q && !`${f.name} ${project.name}`.toLowerCase().includes(q)) continue;
        rows.push({
          key: `${project.id}:${f.path}`,
          title: f.name,
          right: project.name,
          kind: f.kind,
          provider: f.provider,
          projectId: project.id,
          filePath: f.path,
        });
      }
    }
    return rows;
    // entries changes identity each render; recompute is cheap for this list.
  }, [entries, query]);
}

function Results({
  rows,
  total,
  emptyText,
  activeIndex,
  onHover,
  onSelect,
}: {
  rows: ResultRow[];
  total: number;
  emptyText: string;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (row: ResultRow) => void;
}) {
  const t = useT();
  const activeRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (total === 0) {
    return (
      <p className="px-4 py-8 text-center text-[13px] text-muted-foreground/70">{emptyText}</p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[13px] text-muted-foreground/70">
        {t("search.noResults")}
      </p>
    );
  }

  return (
    <div className="flex flex-col p-1.5">
      {rows.map((row, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={row.key}
            ref={active ? activeRef : undefined}
            onClick={() => onSelect(row)}
            onMouseMove={() => onHover(i)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
              active ? "bg-accent" : "hover:bg-accent",
            )}
          >
            {row.kind &&
              (row.kind === "agent" ? (
                <Bot className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Sparkles className="size-4 shrink-0 text-muted-foreground" />
              ))}
            <span className="min-w-0 flex-1 truncate text-foreground">{row.title}</span>
            <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
              {row.kind && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/80">
                  {row.kind}
                </span>
              )}
              {row.provider && (
                <span className="text-[10px] lowercase text-muted-foreground/60">{row.provider}</span>
              )}
              <span className="max-w-[10rem] truncate">{row.right}</span>
              {row.date && <span className="tabular-nums text-muted-foreground/70">{row.date}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const mode = useSidebar((s) => s.mode);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const isAgents = mode === "agents";
  const conversationRows = useConversationRows(query);
  const agentRows = useAgentRows(query, open && isAgents);
  const rows = isAgents ? agentRows : conversationRows;

  const { data: conversations = [] } = useConversations();
  const unfilteredAgents = useAgentRows("", open && isAgents);
  const total = isAgents ? unfilteredAgents.length : conversations.length;

  // reset + focus on open
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // keep the active row within bounds as results change
  React.useEffect(() => {
    setActiveIndex((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const select = (row: ResultRow) => {
    onClose();
    if (row.conversationId != null) {
      navigate({ to: "/c/$conversationId", params: { conversationId: String(row.conversationId) } });
    } else if (row.projectId != null && row.filePath) {
      navigate({
        to: "/agents/$projectId",
        params: { projectId: String(row.projectId) },
        search: { file: row.filePath },
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (rows.length === 0 ? 0 : (i + 1) % rows.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (rows.length === 0 ? 0 : (i - 1 + rows.length) % rows.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) select(row);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4 pt-[12vh] animate-fade-in">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal
        onKeyDown={onKeyDown}
        className="relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-sm animate-fade-in"
      >
        {/* search input */}
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAgents ? t("search.agentsPlaceholder") : t("search.placeholder")}
            className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>

        {/* results */}
        <div className="max-h-[60vh] min-h-0 overflow-y-auto">
          <Results
            rows={rows}
            total={total}
            emptyText={isAgents ? t("search.noResults") : t("threads.none")}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onSelect={select}
          />
        </div>
      </div>
    </div>
  );
}
