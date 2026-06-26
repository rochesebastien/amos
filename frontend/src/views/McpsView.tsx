import { useEffect, useState } from "react";
import {
  Plug,
  Plus,
  Pencil,
  Trash2,
  Globe,
  Code2,
  FileJson,
  FlaskConical,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  api,
  type MCP,
  type MCPType,
  type MCPInput,
  type Project,
  type ToolPreview,
} from "@/lib/api";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Field, Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TYPE_META: Record<MCPType, { label: string; icon: React.ElementType; blurb: string }> = {
  openapi: { label: "OpenAPI", icon: FileJson, blurb: "Generate tools on the fly from an openapi.json (e.g. FastAPI)." },
  remote: { label: "Remote", icon: Globe, blurb: "Connect to an existing MCP server over HTTP." },
  code: { label: "Code", icon: Code2, blurb: "Define tools with your own Python." },
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
  // code
  code: string;
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
  code: `TOOLS = [
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
`,
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
  return { code: f.code };
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

function mcpToForm(m: MCP): FormState {
  const c = m.config || {};
  const remote = parseRemoteParts(c);
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
    code: c.code ?? blank.code,
  };
}

export function McpsView() {
  const { dataVersion, refresh } = useApp();
  const [mcps, setMcps] = useState<MCP[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MCP | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ ok: boolean; tools: ToolPreview[]; error?: string | null } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.listMcps().then(setMcps).catch(() => {});
    api.listProjects().then(setProjects).catch(() => {});
  }, [dataVersion]);

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
      if (editing) await api.updateMcp(editing.id, payload());
      else await api.createMcp(payload());
      setOpen(false);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: MCP) => {
    if (!confirm(`Delete MCP “${m.name}”?`)) return;
    await api.deleteMcp(m.id);
    refresh();
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
          ? await api.updateMcp(editing.id, payload())
          : await api.createMcp(payload());
        if (!editing) setEditing(saved);
        const res = await api.testMcp(saved.id);
        setPreview(res);
        refresh();
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
    await api.updateMcp(m.id, {
      name: m.name,
      description: m.description,
      type: m.type,
      enabled: !m.enabled,
      config: m.config,
      project_ids: m.project_ids,
    });
    refresh();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 px-6 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-display">MCPs</h1>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Tools you can attach to projects — from a URL, your own code, or any OpenAPI spec.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="size-4" /> New MCP
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {mcps.length === 0 ? (
          <EmptyState onNew={openNew} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {mcps.map((m) => {
              const meta = TYPE_META[m.type];
              const Icon = meta.icon;
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
                      <Button size="icon" variant="ghost" onClick={() => openEdit(m)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(m)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  {m.description && (
                    <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">
                      {m.description}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{meta.label}</Badge>
                    {m.project_ids.length > 0 && (
                      <Badge variant="primary">
                        {m.project_ids.length} project{m.project_ids.length > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                    <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Switch checked={m.enabled} onCheckedChange={() => toggleEnabled(m)} />
                      {m.enabled ? "Enabled" : "Disabled"}
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
        title={editing ? "Edit MCP" : "New MCP"}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={runPreview} disabled={testing}>
              <FlaskConical className="size-4" /> {testing ? "Testing…" : "Preview tools"}
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
          {/* type picker */}
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TYPE_META) as MCPType[]).map((t) => {
              const meta = TYPE_META[t];
              const Icon = meta.icon;
              const active = form.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setForm({ ...form, type: t });
                    setPreview(null);
                  }}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                    active ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                  )}
                >
                  <Icon className={cn("size-4", active && "text-primary")} />
                  <span className="text-sm font-semibold">{meta.label}</span>
                  <span className="text-[11px] leading-tight text-muted-foreground">{meta.blurb}</span>
                </button>
              );
            })}
          </div>

          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My API tools"
              autoFocus
            />
          </Field>
          <Field label="Description">
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional"
            />
          </Field>

          {form.type === "openapi" && (
            <>
              <Field label="OpenAPI spec URL" hint="e.g. http://localhost:8000/openapi.json — fetched when tools run.">
                <Input
                  value={form.specUrl}
                  onChange={(e) => setForm({ ...form, specUrl: e.target.value })}
                  placeholder="https://api.example.com/openapi.json"
                />
              </Field>
              <Field label="…or paste the spec JSON" hint="Used if no URL is set (or to pin a fixed version).">
                <Textarea
                  value={form.specText}
                  onChange={(e) => setForm({ ...form, specText: e.target.value })}
                  placeholder='{ "openapi": "3.0.0", ... }'
                  rows={5}
                  className="font-mono text-[12px]"
                />
              </Field>
              <Field label="Base URL override" hint="Where requests are sent. Defaults to the spec's servers / the URL origin.">
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
                <Field label="Scheme">
                  <Select
                    value={form.scheme}
                    onChange={(e) => setForm({ ...form, scheme: e.target.value })}
                  >
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </Select>
                </Field>
                <Field label="Host">
                  <Input
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    placeholder="localhost"
                  />
                </Field>
                <Field label="Port">
                  <Input
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    placeholder="8931"
                    inputMode="numeric"
                  />
                </Field>
              </div>
              <Field label="Path" hint="The MCP endpoint path on the server (often /mcp or /sse).">
                <Input
                  value={form.path}
                  onChange={(e) => setForm({ ...form, path: e.target.value })}
                  placeholder="/mcp"
                />
              </Field>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px]">
                <span className="text-muted-foreground">Endpoint résolu : </span>
                <span className="break-all font-mono text-foreground">
                  {composeRemoteUrl(form) || "—"}
                </span>
              </div>
            </>
          )}

          {form.type === "code" && (
            <Field label="Python code" hint="Define TOOLS (list) and call(name, arguments). Runs in-process.">
              <Textarea
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                rows={12}
                className="font-mono text-[12px]"
              />
            </Field>
          )}

          {form.type !== "code" && (
            <Field label="Headers (JSON)" hint="Optional auth headers sent with each request.">
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
            <span className="text-[13px] text-muted-foreground">Attach to projects</span>
            {projects.length === 0 ? (
              <p className="text-[13px] text-muted-foreground/70">No projects yet.</p>
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
                    {preview.tools.length} tool{preview.tools.length === 1 ? "" : "s"} generated
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.tools.map((t) => (
                      <Badge key={t.name} variant="secondary" title={t.description}>
                        {t.name}
                      </Badge>
                    ))}
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
    </div>
  );
}

function TestButton({ mcp }: { mcp: MCP }) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [count, setCount] = useState(0);
  const [msg, setMsg] = useState("");

  const run = async () => {
    setState("loading");
    try {
      const res = await api.testMcp(mcp.id);
      if (res.ok) {
        setCount(res.tools.length);
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

  return (
    <button
      onClick={run}
      title={state === "err" ? msg : "Test connection"}
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
      {state === "ok" ? `${count} tools` : state === "err" ? "error" : "Test"}
    </button>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <Plug className="size-6" />
      </div>
      <h2 className="text-xl font-display">No MCPs yet</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Add a remote MCP server, write your own tools in Python, or generate them
        from an OpenAPI spec.
      </p>
      <Button onClick={onNew} className="mt-1">
        <Plus className="size-4" /> New MCP
      </Button>
    </div>
  );
}
