import * as React from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Plus, TerminalSquare, X } from "lucide-react";
import type { TerminalKind } from "@shared/terminal";
import { ipc } from "@/lib/ipc";
import { useApp } from "@/lib/store";
import { useTerminals, type TerminalTab } from "@/lib/terminals";
import { useT } from "@/lib/i18n";
import { EcosystemGlyph } from "@/components/BrandIcons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The terminals side panel: a right-docked column of tabbed terminals, opened
 * from a project's header. Mounted once in the root shell so its terminals
 * keep running while the user moves between views.
 *
 * Each tab owns one xterm.js instance and one backend terminal; all tabs stay
 * mounted (hidden when inactive) so their scrollback and their child process
 * survive a tab switch. The panel subscribes to the two terminal push channels
 * once and routes each event to the matching tab by its backend id.
 */

/** xterm's theme wants explicit colours; read them from the live CSS tokens. */
function readTheme() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  const fg = v("--foreground", "#171717");
  return {
    background: v("--card", "#ffffff"),
    foreground: fg,
    cursor: fg,
    cursorAccent: v("--card", "#ffffff"),
    selectionBackground: v("--accent", "#2a2a2a"),
  };
}

export function TerminalPanel() {
  const t = useT();
  const theme = useApp((s) => s.theme);
  const { open, tabs, activeKey, setActive, closeTab, setOpen, bindTerminalId, markExited } =
    useTerminals();

  // One subscription for the whole panel; route to the active writers by id.
  const sinks = React.useRef(new Map<string, (data: string) => void>());
  const buffers = React.useRef(new Map<string, string[]>());

  React.useEffect(() => {
    const offData = ipc.onTerminalData(({ id, data }) => {
      const sink = sinks.current.get(id);
      if (sink) sink(data);
      else buffers.current.set(id, [...(buffers.current.get(id) ?? []), data]);
    });
    const offExit = ipc.onTerminalExit(({ id }) => {
      sinks.current.get(id)?.("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      markExited(id);
    });
    return () => {
      offData();
      offExit();
    };
  }, [markExited]);

  const registerSink = React.useCallback((id: string, sink: (data: string) => void) => {
    const pending = buffers.current.get(id);
    if (pending) {
      for (const chunk of pending) sink(chunk);
      buffers.current.delete(id);
    }
    sinks.current.set(id, sink);
    return () => sinks.current.delete(id);
  }, []);

  if (!open || tabs.length === 0) return null;

  return (
    <aside className="flex h-full w-[440px] max-w-[46vw] min-w-[320px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border bg-background/40 pl-2 pr-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={cn(
                "group/tab flex shrink-0 items-center gap-1.5 rounded-md py-1 pl-2 pr-1 text-[12px] transition-colors",
                tab.key === activeKey
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              <TabIcon kind={tab.kind} />
              <span className="max-w-[9rem] truncate">{tab.title}</span>
              <span
                role="button"
                tabIndex={-1}
                aria-label={t("terminal.closeTab")}
                onClick={(e) => {
                  e.stopPropagation();
                  const tid = tabs.find((x) => x.key === tab.key)?.terminalId;
                  if (tid) void ipc.killTerminal(tid);
                  closeTab(tab.key);
                }}
                className="flex size-4 items-center justify-center rounded opacity-50 transition-opacity hover:bg-border hover:opacity-100"
              >
                <X className="size-3" />
              </span>
            </button>
          ))}
        </div>
        <NewTerminalMenu />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("terminal.hide")}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("terminal.hide")}</TooltipContent>
        </Tooltip>
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.key}
            tab={tab}
            active={tab.key === activeKey}
            theme={theme}
            registerSink={registerSink}
            onSpawned={(id) => bindTerminalId(tab.key, id)}
          />
        ))}
      </div>
    </aside>
  );
}

function TabIcon({ kind }: { kind: TerminalKind }) {
  if (kind === "shell") return <TerminalSquare className="size-3.5 shrink-0" />;
  return <EcosystemGlyph ecosystem={kind} className="size-3.5 shrink-0" />;
}

/** The "+" that adds a Claude / Codex / Shell tab for the active project. */
function NewTerminalMenu() {
  const t = useT();
  const { tabs, activeKey, openTab } = useTerminals();
  const active = tabs.find((x) => x.key === activeKey) ?? tabs[tabs.length - 1];
  if (!active) return null;

  const add = (kind: TerminalKind) =>
    openTab({ projectId: active.projectId, projectName: active.projectName, kind });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("terminal.new")}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => add("claude")}>
          <EcosystemGlyph ecosystem="claude" className="size-3.5" />
          Claude
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => add("codex")}>
          <EcosystemGlyph ecosystem="codex" className="size-3.5" />
          Codex
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => add("shell")}>
          <TerminalSquare className="size-3.5" />
          {t("terminal.shell")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TerminalView({
  tab,
  active,
  theme,
  registerSink,
  onSpawned,
}: {
  tab: TerminalTab;
  active: boolean;
  theme: string;
  registerSink: (id: string, sink: (data: string) => void) => () => void;
  onSpawned: (id: string) => void;
}) {
  const t = useT();
  const hostRef = React.useRef<HTMLDivElement>(null);
  const xtermRef = React.useRef<Xterm | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);
  const idRef = React.useRef<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Spawn once, on mount.
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Xterm({
      fontSize: 12,
      fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace',
      cursorBlink: true,
      theme: readTheme(),
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;

    let unregister = () => {};
    let disposed = false;

    void ipc
      .createTerminal({ projectId: tab.projectId, kind: tab.kind, cols: term.cols, rows: term.rows })
      .then((res) => {
        if (disposed) {
          void ipc.killTerminal(res.id);
          return;
        }
        idRef.current = res.id;
        onSpawned(res.id);
        if (!res.pty) {
          term.writeln("\x1b[90m[amos] no PTY backend — piped process, no TTY\x1b[0m");
        }
        unregister = registerSink(res.id, (data) => term.write(data));
        term.onData((data) => {
          if (idRef.current) void ipc.writeTerminal(idRef.current, data);
        });
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        term.writeln(`\x1b[31m${message}\x1b[0m`);
      });

    return () => {
      disposed = true;
      unregister();
      if (idRef.current) void ipc.killTerminal(idRef.current);
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-theme on light/dark toggle.
  React.useEffect(() => {
    if (xtermRef.current) xtermRef.current.options.theme = readTheme();
  }, [theme]);

  // Fit to the container: on activation and on resize.
  React.useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    const fit = fitRef.current;
    if (!host || !fit) return;
    const refit = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      const term = xtermRef.current;
      if (term && idRef.current) void ipc.resizeTerminal(idRef.current, term.cols, term.rows);
    };
    refit();
    xtermRef.current?.focus();
    const observer = new ResizeObserver(refit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [active]);

  return (
    <div className={cn("absolute inset-0 flex flex-col", !active && "hidden")}>
      {error && (
        <p className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive">
          {t("terminal.failed")}
        </p>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1.5" />
    </div>
  );
}
