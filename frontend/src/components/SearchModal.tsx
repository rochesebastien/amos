import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import type { Conversation, Project } from "@/lib/api";
import { useConversations, useProjects } from "@/lib/queries";
import { useT, useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Command-palette style search popup. Structured so a later "Agents" mode can
// reuse the same shell: the shell (overlay, input, keyboard nav) is generic and
// the results list is an isolated inner component fed a flat list of rows.

type ResultRow = {
  id: number;
  title: string;
  right: string; // project name (or "no project" label)
  date: string; // formatted first-message date
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
        id: c.id,
        title: c.title,
        right: rightLabel,
        date: Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale),
      });
    }
    return rows;
  }, [conversations, projects, query, lang, t]);
}

function ConversationResults({
  rows,
  total,
  activeIndex,
  onHover,
  onSelect,
}: {
  rows: ResultRow[];
  total: number;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (id: number) => void;
}) {
  const t = useT();
  const activeRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (total === 0) {
    return (
      <p className="px-4 py-8 text-center text-[13px] text-muted-foreground/70">
        {t("threads.none")}
      </p>
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
            key={row.id}
            ref={active ? activeRef : undefined}
            onClick={() => onSelect(row.id)}
            onMouseMove={() => onHover(i)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
              active ? "bg-accent" : "hover:bg-accent",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-foreground">{row.title}</span>
            <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
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
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const rows = useConversationRows(query);
  const { data: conversations = [] } = useConversations();
  const total = conversations.length;

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

  const select = (id: number) => {
    onClose();
    navigate({ to: "/c/$conversationId", params: { conversationId: String(id) } });
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
      if (row) select(row.id);
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
            placeholder={t("search.placeholder")}
            className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>

        {/* results */}
        <div className="max-h-[60vh] min-h-0 overflow-y-auto">
          <ConversationResults
            rows={rows}
            total={total}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onSelect={select}
          />
        </div>
      </div>
    </div>
  );
}
