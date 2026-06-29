import { useEffect, useState } from "react";
import {
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
  type ToolPreview,
} from "@/lib/api";
import { useMcpMutations, useProjects } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Field, Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";

export const MCP_TYPE_ICON: Record<MCPType, React.ElementType> = {
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
export function composeRemoteUrl(
  f: Pick<FormState, "scheme" | "host" | "port" | "path">,
): string {
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

/**
 * Create/edit modal for an MCP. Pass `mcp` to edit, or null to create.
 * `attachProjectId` pre-attaches a new MCP to that project on first open.
 */
export function McpModal({
  open,
  onClose,
  mcp,
  attachProjectId = null,
}: {
  open: boolean;
  onClose: () => void;
  mcp: MCP | null;
  attachProjectId?: number | null;
}) {
  const t = useT();
  const { data: projects = [] } = useProjects();
  const mutations = useMcpMutations();
  const confirm = useConfirm();
  // `current` tracks the persisted MCP being edited; a fresh create promotes it
  // to the saved record once a preview/save round-trips so re-saving updates.
  const [current, setCurrent] = useState<MCP | null>(mcp);
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{
    ok: boolean;
    tools: ToolPreview[];
    error?: string | null;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  // sync the form whenever the modal opens for a (possibly different) MCP
  useEffect(() => {
    if (!open) return;
    setCurrent(mcp);
    setForm(
      mcp
        ? mcpToForm(mcp)
        : { ...blank, project_ids: attachProjectId != null ? [attachProjectId] : [] },
    );
    setPreview(null);
  }, [open, mcp, attachProjectId]);

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
      if (current) await mutations.update.mutateAsync({ id: current.id, body: payload() });
      else await mutations.create.mutateAsync(payload());
      onClose();
    } finally {
      setSaving(false);
    }
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
        const saved = current
          ? await mutations.update.mutateAsync({ id: current.id, body: payload() })
          : await mutations.create.mutateAsync(payload());
        setCurrent(saved);
        const res = await api.testMcp(saved.id);
        setPreview(res);
      }
    } catch (e: any) {
      setPreview({ ok: false, tools: [], error: String(e.message ?? e) });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!current) return;
    const ok = await confirm({
      title: t("mcps.deleteTitle"),
      description: t("mcps.deleteDescription", { name: current.name }),
      confirmText: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await mutations.remove.mutateAsync(current.id);
    onClose();
  };

  const toggleProject = (id: number) =>
    setForm((f) => ({
      ...f,
      project_ids: f.project_ids.includes(id)
        ? f.project_ids.filter((x) => x !== id)
        : [...f.project_ids, id],
    }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={current ? t("mcps.editMcp") : t("mcps.newMcp")}
      className="max-w-2xl"
      footer={
        <>
          {current && (
            <Button variant="ghost" onClick={remove} className="mr-auto text-destructive">
              <Trash2 className="size-4" /> {t("common.delete")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="outline" onClick={runPreview} disabled={testing}>
            <FlaskConical className="size-4" />{" "}
            {testing ? t("mcps.testing") : t("mcps.previewTools")}
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
          {(Object.keys(MCP_TYPE_ICON) as MCPType[]).map((type) => {
            const Icon = MCP_TYPE_ICON[type];
            const active = form.type === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setForm({ ...form, type });
                  setPreview(null);
                }}
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
          <Field label={t("mcps.pythonCode")} hint={t("mcps.pythonCodeHint")}>
            <Textarea
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              rows={12}
              className="font-mono text-[12px]"
            />
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
              preview.ok
                ? "border-primary/30 bg-primary/5"
                : "border-destructive/40 bg-destructive/10",
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
                  {preview.tools.map((tool) =>
                    tool.description ? (
                      <Tooltip key={tool.name}>
                        <TooltipTrigger asChild>
                          <Badge variant="secondary">{tool.name}</Badge>
                        </TooltipTrigger>
                        <TooltipContent>{tool.description}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Badge key={tool.name} variant="secondary">
                        {tool.name}
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
  );
}
