import { useState } from "react";
import {
  Plug,
  Plus,
  Pencil,
  Trash2,
  Globe,
  Code2,
  FileCode2,
  FileJson,
  FlaskConical,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import {
  api,
  type MCP,
  type MCPType,
  type MCPInput,
  type ToolPreview,
} from "@/lib/api";
import { useMcpMutations, useMcps, useProjects } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Field, Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { CodeEditor, type CodeFiles } from "@/components/CodeEditor";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const DEFAULT_CODE = `TOOLS = [
    {
        "name": "add",
        "description": "Add two numbers",
        "parameters": {
            "type": "object",
            "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
            "required": ["a", "b"],
        },
    },
]


def call(name, arguments):
    if name == "add":
        return arguments["a"] + arguments["b"]
    raise ValueError(f"unknown tool {name}")
`;

const TYPE_ICON: Record<MCPType, React.ElementType> = {
  openapi: FileJson,
  remote: Globe,
  code: Code2,
};

type FormState = {
  name: string;
  description: string;
  type: MCPType;
  enabled: boolean;
  project_ids: number[];
  // openapi
  specUrl: string;
  specText: string;
  baseUrl: string;
  // remote (HTTP streamable) — composed into a URL
  scheme: string;
  host: string;
  port: string;
  path: string;
  // shared
  headersText: string;
  // code — a small Python project (file tree) with one entry file
  files: CodeFiles;
  entry: string;
};

const blank: FormState = {
  name: "",
  description: "",
  type: "openapi",
  enabled: true,
  project_ids: [],
  specUrl: "",
  specText: "",
  baseUrl: "",
  scheme: "http",
  host: "",
  port: "",
  path: "/mcp",
  headersText: "",
  files: { "main.py": DEFAULT_CODE },
  entry: "main.py",
};

function parseHeaders(text: string): Record<string, string> | undefined {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Compose the remote endpoint from its parts, for live preview + display.
function composeRemoteUrl(f: Pick<FormState, "scheme" | "host" | "port" | "path">): string {
  const host = f.host.trim();
  if (!host) return "";
  let path = f.path.trim();
  if (path && !path.startsWith("/")) path = "/" + path;
  if (host.startsWith("http://") || host.startsWith("https://")) {
    const base = host.replace(/\/+$/, "");
    const withPort = f.port.trim() && !/:\d+($|\/)/.test(base.split("//")[1] ?? "")
      ? `${base}:${f.port.trim()}`
      : base;
    return withPort + path;
  }
  const base = `${f.scheme}://${host.replace(/\/+$/, "")}`;
  const withPort = f.port.trim() ? `${base}:${f.port.trim()}` : base;
  return withPort + path;
}

function buildConfig(f: FormState): Record<string, any> {
  const headers = parseHeaders(f.headersText);
  if (f.type === "openapi") {
    const cfg: Record<string, any> = {};
    if (f.specUrl.trim()) cfg.spec_url = f.specUrl.trim();
    if (f.specText.trim()) {
      try {
        cfg.spec = JSON.parse(f.specText);
      } catch {
        /* leave out invalid spec */
      }
    }
    if (f.baseUrl.trim()) cfg.base_url = f.baseUrl.trim();
    if (headers) cfg.headers = headers;
    return cfg;
  }
  if (f.type === "remote") {
    const cfg: Record<string, any> = {
      scheme: f.scheme,
      host: f.host.trim(),
      path: f.path.trim(),
    };
    if (f.port.trim()) cfg.port = Number(f.port.trim());
    // also store the composed url for clarity / back-compat
    const url = composeRemoteUrl(f);
    if (url) cfg.url = url;
    if (headers) cfg.headers = headers;
    return cfg;
  }
  // code: a file tree + the entry file that defines TOOLS / call
  const files = Object.keys(f.files).length ? f.files : { "main.py": "" };
  const entry = f.entry && files[f.entry] ? f.entry : (files["main.py"] ? "main.py" : Object.keys(files)[0]);
  return { files, entry };
}

function parseRemoteParts(c: Record<string, any>): {
  scheme: string;
  host: string;
  port: string;
  path: string;
} {
  // prefer structured parts when present
  if (c.host) {
    return {
      scheme: c.scheme ?? "http",
      host: String(c.host),
      port: c.port != null ? String(c.port) : "",
      path: c.path ?? "",
    };
  }
  // otherwise parse a legacy full url
  if (c.url || c.endpoint) {
    try {
      const u = new URL(c.url ?? c.endpoint);
      return {
        scheme: u.protocol.replace(":", "") || "http",
        host: u.hostname,
        port: u.port || "",
        path: u.pathname === "/" ? "" : u.pathname,
      };
    } catch {
      return { scheme: "http", host: String(c.url ?? c.endpoint ?? ""), port: "", path: "" };
    }
  }
  return { scheme: "http", host: "", port: "", path: "/mcp" };
}

function codeFromConfig(c: Record<string, any>): { files: CodeFiles; entry: string } {
  // new shape: a files map (+ entry); legacy shape: a single `code` string
  if (c.files && typeof c.files === "object" && Object.keys(c.files).length) {
    const files = c.files as CodeFiles;
    const entry = c.entry && files[c.entry] ? c.entry : (files["main.py"] ? "main.py" : Object.keys(files)[0]);
    return { files, entry };
  }
  if (typeof c.code === "string") {
    return { files: { "main.py": c.code }, entry: "main.py" };
  }
  return { files: { "main.py": DEFAULT_CODE }, entry: "main.py" };
}

function mcpToForm(m: MCP): FormState {
  const c = m.config || {};
  const remote = parseRemoteParts(c);
  const code = codeFromConfig(c);
  return {
    ...blank,
    name: m.name,
    description: m.description,
    type: m.type,
    enabled: m.enabled,
    project_ids: m.project_ids,
    specUrl: c.spec_url ?? "",
    specText: c.spec ? JSON.stringify(c.spec, null, 2) : "",
    baseUrl: c.base_url ?? "",
    scheme: remote.scheme,
    host: remote.host,
    port: remote.port,
    path: remote.path,
    headersText: c.headers ? JSON.stringify(c.headers, null, 2) : "",
    files: code.files,
    entry: code.entry,
  };
}

export function McpsView() {
  const t = useT();
  const { data: mcps = [] } = useMcps();
  const { data: projects = [] } = useProjects();
  const mutations = useMcpMutations();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MCP | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ ok: boolean; tools: ToolPreview[]; error?: string | null } | null>(null);
  const [testing, setTesting] = useState(false);
  const [ideOpen, setIdeOpen] = useState(false);

  // Switching to the "code" type drops the user into the full-screen editor,
  // but only after they confirm they're entering code-editing mode.
  const pickType = async (type: MCPType) => {
    setForm((f) => ({ ...f, type }));
    setPreview(null);
    if (type === "code") {
      const ok = await confirm({
        title: t("editor.enterTitle"),
        description: t("editor.enterDesc"),
        confirmText: t("editor.enterCta"),
      });
      if (ok) setIdeOpen(true);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm(blank);
    setPreview(null);
    setOpen(true);
  };
  const openEdit = (m: MCP) => {
    setEditing(m);
    setForm(mcpToForm(m));
    setPreview(null);
    setOpen(true);
  };

  const payload = (): MCPInput => ({
    name: form.name,
    description: form.description,
    type: form.type,
    enabled: form.enabled,
    config: buildConfig(form),
    project_ids: form.project_ids,
  });

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await mutations.update.mutateAsync({ id: editing.id, body: payload() });
      else await mutations.create.mutateAsync(payload());
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: MCP) => {
    const ok = await confirm({
      title: t("mcps.deleteTitle"),
      description: t("mcps.deleteDescription", { name: m.name }),
      confirmText: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await mutations.remove.mutateAsync(m.id);
  };

  // Live preview: OpenAPI parses without saving; remote/code save-then-test.
  const runPreview = async () => {
    setTesting(true);
    setPreview(null);
    try {
      if (form.type === "openapi") {
        const cfg = buildConfig(form);
        const res = await api.previewOpenapi({
          spec_url: cfg.spec_url,
          spec: cfg.spec,
          base_url: cfg.base_url,
        });
        setPreview(res);
      } else {
        // create-or-update first, then hit the live /test endpoint
        const saved = editing
          ? await mutations.update.mutateAsync({ id: editing.id, body: payload() })
          : await mutations.create.mutateAsync(payload());
        if (!editing) setEditing(saved);
        const res = await api.testMcp(saved.id);
        setPreview(res);
      }
    } catch (e: any) {
      setPreview({ ok: false, tools: [], error: String(e.message ?? e) });
    } finally {
      setTesting(false);
    }
  };

  const toggleProject = (id: number) =>
    setForm((f) => ({
      ...f,
      project_ids: f.project_ids.includes(id)
        ? f.project_ids.filter((x) => x !== id)
        : [...f.project_ids, id],
    }));

  const toggleEnabled = async (m: MCP) => {
    await mutations.update.mutateAsync({
      id: m.id,
      body: {
        name: m.name,
        description: m.description,
        type: m.type,
        enabled: !m.enabled,
        config: m.config,
        project_ids: m.project_ids,
      },
    });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 px-6 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-display">{t("nav.mcps")}</h1>
          <p className="mt-1 text-sm text-muted-foreground/70">
            {t("mcps.subtitle")}
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="size-4" /> {t("mcps.newMcp")}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {mcps.length === 0 ? (
          <EmptyState onNew={openNew} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {mcps.map((m) => {
              const Icon = TYPE_ICON[m.type];
              return (
                <div
                  key={m.id}
                  className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-primary" />
                      <h3 className="font-display text-base">{m.name}</h3>
                    </div>
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="icon" variant="ghost" onClick={() => openEdit(m)}>
                            <Pencil className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("mcps.edit")}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="icon" variant="ghost" onClick={() => remove(m)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("common.delete")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  {m.description && (
                    <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">
                      {m.description}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{t(`mcps.type.${m.type}.label`)}</Badge>
                    {m.project_ids.length > 0 && (
                      <Badge variant="primary">
                        {m.project_ids.length}{" "}
                        {t(m.project_ids.length > 1 ? "mcps.projects" : "mcps.project")}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                    <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Switch checked={m.enabled} onCheckedChange={() => toggleEnabled(m)} />
                      {m.enabled ? t("mcps.enabled") : t("mcps.disabled")}
                    </label>
                    <TestButton mcp={m} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t("mcps.editMcp") : t("mcps.newMcp")}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="outline" onClick={runPreview} disabled={testing}>
              <FlaskConical className="size-4" /> {testing ? t("mcps.testing") : t("mcps.previewTools")}
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </>
        }
      >
        <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
          {/* type picker */}
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TYPE_ICON) as MCPType[]).map((type) => {
              const Icon = TYPE_ICON[type];
              const active = form.type === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => pickType(type)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                    active ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                  )}
                >
                  <Icon className={cn("size-4", active && "text-primary")} />
                  <span className="text-sm font-semibold">{t(`mcps.type.${type}.label`)}</span>
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {t(`mcps.type.${type}.blurb`)}
                  </span>
                </button>
              );
            })}
          </div>

          <Field label={t("mcps.name")}>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("mcps.namePlaceholder")}
              autoFocus
            />
          </Field>
          <Field label={t("mcps.description")}>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t("mcps.optional")}
            />
          </Field>

          {form.type === "openapi" && (
            <>
              <Field label={t("mcps.specUrl")} hint={t("mcps.specUrlHint")}>
                <Input
                  value={form.specUrl}
                  onChange={(e) => setForm({ ...form, specUrl: e.target.value })}
                  placeholder="https://api.example.com/openapi.json"
                />
              </Field>
              <Field label={t("mcps.specText")} hint={t("mcps.specTextHint")}>
                <Textarea
                  value={form.specText}
                  onChange={(e) => setForm({ ...form, specText: e.target.value })}
                  placeholder='{ "openapi": "3.0.0", ... }'
                  rows={5}
                  className="font-mono text-[12px]"
                />
              </Field>
              <Field label={t("mcps.baseUrl")} hint={t("mcps.baseUrlHint")}>
                <Input
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="https://api.example.com"
                />
              </Field>
            </>
          )}

          {form.type === "remote" && (
            <>
              <div className="grid grid-cols-[110px_1fr_110px] gap-2">
                <Field label={t("mcps.scheme")}>
                  <Select
                    value={form.scheme}
                    onChange={(e) => setForm({ ...form, scheme: e.target.value })}
                  >
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </Select>
                </Field>
                <Field label={t("mcps.host")}>
                  <Input
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    placeholder="localhost"
                  />
                </Field>
                <Field label={t("mcps.port")}>
                  <Input
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    placeholder="8931"
                    inputMode="numeric"
                  />
                </Field>
              </div>
              <Field label={t("mcps.path")} hint={t("mcps.pathHint")}>
                <Input
                  value={form.path}
                  onChange={(e) => setForm({ ...form, path: e.target.value })}
                  placeholder="/mcp"
                />
              </Field>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px]">
                <span className="text-muted-foreground">{t("mcps.resolvedEndpoint")} </span>
                <span className="break-all font-mono text-foreground">
                  {composeRemoteUrl(form) || "—"}
                </span>
              </div>
            </>
          )}

          {form.type === "code" && (
            <Field label={t("mcps.pythonProject")} hint={t("mcps.pythonProjectHint")}>
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[13px]">
                    <Code2 className="size-4 text-primary" />
                    <span className="font-medium">
                      {Object.keys(form.files).length}{" "}
                      {t(Object.keys(form.files).length === 1 ? "editor.fileOne" : "editor.fileOther")}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{t("editor.entry")}:</span>
                    <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[12px]">{form.entry}</code>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setIdeOpen(true)}>
                    <Code2 className="size-4" /> {t("mcps.openEditor")}
                  </Button>
                </div>
                <ul className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
                  {Object.keys(form.files)
                    .sort()
                    .map((p) => (
                      <li key={p} className="flex items-center gap-1.5 font-mono text-[12px] text-muted-foreground">
                        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground/60" />
                        <span className="truncate">{p}</span>
                        {p === form.entry && (
                          <span className="rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                            {t("editor.entry")}
                          </span>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            </Field>
          )}

          {form.type !== "code" && (
            <Field label={t("mcps.headers")} hint={t("mcps.headersHint")}>
              <Textarea
                value={form.headersText}
                onChange={(e) => setForm({ ...form, headersText: e.target.value })}
                placeholder='{ "Authorization": "Bearer …" }'
                rows={2}
                className="font-mono text-[12px]"
              />
            </Field>
          )}

          {/* attach to projects */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted-foreground">{t("mcps.attachProjects")}</span>
            {projects.length === 0 ? (
              <p className="text-[13px] text-muted-foreground/70">{t("mcps.noProjects")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {projects.map((p) => {
                  const on = form.project_ids.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleProject(p.id)}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-[13px] transition-colors",
                        on ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                      )}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* preview result */}
          {preview && (
            <div
              className={cn(
                "rounded-lg border p-3 text-[13px]",
                preview.ok ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/10",
              )}
            >
              {preview.ok ? (
                <>
                  <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
                    <CheckCircle2 className="size-4 text-primary" />
                    {preview.tools.length}{" "}
                    {t(preview.tools.length === 1 ? "mcps.toolGenerated" : "mcps.toolsGenerated")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.tools.map((t) =>
                      t.description ? (
                        <Tooltip key={t.name}>
                          <TooltipTrigger asChild>
                            <Badge variant="secondary">{t.name}</Badge>
                          </TooltipTrigger>
                          <TooltipContent>{t.description}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Badge key={t.name} variant="secondary">
                          {t.name}
                        </Badge>
                      ),
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2 text-destructive">
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                  <span className="break-words">{preview.error}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <CodeEditor
        open={ideOpen}
        files={form.files}
        entry={form.entry}
        title={form.name || t("mcps.newMcp")}
        onSave={(files, entry) => {
          setForm((f) => ({ ...f, type: "code", files, entry }));
          setIdeOpen(false);
        }}
        onClose={() => setIdeOpen(false)}
      />
    </div>
  );
}

function TestButton({ mcp }: { mcp: MCP }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [tools, setTools] = useState<ToolPreview[]>([]);
  const [msg, setMsg] = useState("");

  const run = async () => {
    setState("loading");
    try {
      const res = await api.testMcp(mcp.id);
      if (res.ok) {
        setTools(res.tools);
        setState("ok");
      } else {
        setMsg(res.error ?? "failed");
        setState("err");
      }
    } catch (e: any) {
      setMsg(String(e.message ?? e));
      setState("err");
    }
  };

  const button = (
    <button
      onClick={run}
      title={state === "err" ? msg : state === "ok" ? undefined : t("mcps.testConnection")}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors hover:bg-accent",
        state === "ok" && "text-primary",
        state === "err" && "text-destructive",
        state === "idle" && "text-muted-foreground",
      )}
    >
      {state === "loading" ? (
        <FlaskConical className="size-3.5 animate-pulse" />
      ) : state === "ok" ? (
        <CheckCircle2 className="size-3.5" />
      ) : state === "err" ? (
        <XCircle className="size-3.5" />
      ) : (
        <FlaskConical className="size-3.5" />
      )}
      {state === "ok"
        ? `${tools.length} ${t(tools.length === 1 ? "mcps.tool" : "mcps.tools")}`
        : state === "err"
          ? t("mcps.error")
          : t("mcps.checkTools")}
    </button>
  );

  if (state !== "ok") return button;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>{button}</HoverCardTrigger>
      <HoverCardContent align="end" className="w-80 max-w-[20rem]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-muted-foreground">
              {tools.length} {t(tools.length === 1 ? "mcps.tool" : "mcps.tools")}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={run}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RefreshCw className="size-3" /> {t("mcps.refresh")}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("mcps.refreshTools")}</TooltipContent>
            </Tooltip>
          </div>
          {tools.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{t("mcps.noToolsExposed")}</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
              {tools.map((t) => (
                <li key={t.name} className="flex flex-col gap-0.5">
                  <code className="font-mono text-[12px] font-medium text-foreground">{t.name}</code>
                  {t.description && (
                    <span className="line-clamp-2 text-[12px] text-muted-foreground">
                      {t.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <Plug className="size-6" />
      </div>
      <h2 className="text-xl font-display">{t("mcps.emptyTitle")}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("mcps.emptyBody")}
      </p>
      <Button onClick={onNew} className="mt-1">
        <Plus className="size-4" /> {t("mcps.newMcp")}
      </Button>
    </div>
  );
}
