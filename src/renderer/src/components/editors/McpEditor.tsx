import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import {
  capabilityId,
  MCP_TRANSPORTS,
  type McpItem,
  type McpTransport,
} from "@shared/capabilities";
import type { McpFields } from "@shared/ipc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm";
import { useT } from "@/lib/i18n";
import { useProjectScan, useSaveMcp } from "@/lib/queries";
import { ConflictDialog, Fieldset, isConflict, Notice, SaveBar } from "./shell";

/**
 * Editing one MCP server entry.
 *
 * The entry is a fragment of a larger document — a `.mcp.json` with other
 * servers in it, a `config.toml` with a whole CLI's settings around it. The
 * form therefore only ever describes *this* entry's known keys; the main
 * process re-reads the document and swaps that one entry in place.
 */

type Form = {
  name: string;
  transport: McpTransport;
  command: string;
  /** One argument per line — arguments routinely contain spaces. */
  args: string;
  url: string;
  /** `KEY=value` per line. */
  env: string;
  headers: string;
};

function seedFrom(item: McpItem): Form {
  const data = item.data;
  return {
    name: item.name,
    transport: data?.transport ?? "stdio",
    command: data?.command ?? "",
    args: data?.args.join("\n") ?? "",
    url: data?.url ?? "",
    env: mapToText(data?.env ?? {}),
    headers: mapToText(data?.headers ?? {}),
  };
}

function mapToText(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** Parse `KEY=value` lines; a line without `=` is a key with an empty value. */
function textToMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) out[trimmed] = "";
    else out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function same(a: Form, b: Form): boolean {
  return (Object.keys(a) as (keyof Form)[]).every((k) => a[k] === b[k]);
}

function toFields(form: Form): McpFields {
  return {
    transport: form.transport,
    command: form.command.trim() || null,
    args: form.args
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    env: textToMap(form.env),
    url: form.url.trim() || null,
    headers: textToMap(form.headers),
  };
}

export function McpEditor({ projectId, item }: { projectId: string; item: McpItem }) {
  const t = useT();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const save = useSaveMcp(projectId);
  const scanQuery = useProjectScan(projectId);

  const [form, setForm] = useState<Form>(() => seedFrom(item));
  const [baseline, setBaseline] = useState<Form>(() => seedFrom(item));
  const [expectedMtimeMs, setExpectedMtimeMs] = useState<number>(item.mtimeMs);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [commentsLost, setCommentsLost] = useState(false);

  const dirty = !same(form, baseline);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const isToml = useMemo(() => item.sourceFile.toLowerCase().endsWith(".toml"), [item.sourceFile]);
  const isStdio = form.transport === "stdio";

  const adopt = (next: McpItem) => {
    const seeded = seedFrom(next);
    setForm(seeded);
    setBaseline(seeded);
    setExpectedMtimeMs(next.mtimeMs);
    setError(null);
    setConflict(false);
  };

  const seenId = useRef(item.id);
  useEffect(() => {
    const switched = seenId.current !== item.id;
    seenId.current = item.id;
    if (switched || !dirtyRef.current) adopt(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const runSave = async (force: boolean) => {
    setError(null);
    const name = form.name.trim();
    if (!name) {
      setError(new Error(t("mcp.nameRequired")));
      return;
    }
    try {
      const result = await save.mutateAsync({
        sourceFile: item.sourceFile,
        name,
        previousName: item.name,
        fields: toFields(form),
        expectedMtimeMs: force ? undefined : expectedMtimeMs,
      });
      setBaseline({ ...form, name });
      setForm((f) => ({ ...f, name }));
      setExpectedMtimeMs(result.mtimeMs);
      setSavedAt(Date.now());
      setCommentsLost(result.commentsLost);
      setConflict(false);

      const nextId = capabilityId("mcp", result.path, name);
      if (nextId !== item.id) {
        void navigate({
          to: "/p/$projectId/item/$itemId",
          params: { projectId, itemId: nextId },
          replace: true,
        });
      }
    } catch (err) {
      if (isConflict(err)) setConflict(true);
      else setError(err);
    }
  };

  const reload = async () => {
    const { data } = await scanQuery.refetch();
    const fresh = data?.items.find((i) => i.id === item.id);
    if (fresh?.kind === "mcp") adopt(fresh);
    else setConflict(false);
  };

  const remove = async () => {
    const ok = await confirm({
      title: t("mcp.removeTitle"),
      description: t("mcp.removeDesc", { name: item.name }),
      confirmText: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await save.mutateAsync({ sourceFile: item.sourceFile, name: item.name, remove: true });
      void navigate({ to: "/p/$projectId", params: { projectId } });
    } catch (err) {
      setError(err);
    }
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="max-w-4xl">
      {item.parseError && <Notice tone="warning">{t("mcp.brokenHint")}</Notice>}
      {isToml && (
        <div className="mb-4">
          <Notice tone="warning">{t("mcp.tomlCommentWarning")}</Notice>
        </div>
      )}
      {commentsLost && (
        <div className="mb-4">
          <Notice tone="info">{t("mcp.tomlCommentsDropped")}</Notice>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Fieldset label={t("mcp.name")} hint={t("mcp.nameHint")}>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Fieldset>
        <Fieldset label={t("mcp.transport")} hint={t("mcp.transportHint")}>
          <Select
            value={form.transport}
            onChange={(e) => set("transport", e.target.value as McpTransport)}
          >
            {MCP_TRANSPORTS.map((tr) => (
              <option key={tr} value={tr}>
                {t(`mcp.transport.${tr}`)}
              </option>
            ))}
          </Select>
        </Fieldset>

        {isStdio ? (
          <>
            <Fieldset label={t("mcp.command")} hint={t("mcp.commandHint")} className="sm:col-span-2">
              <Input
                value={form.command}
                onChange={(e) => set("command", e.target.value)}
                placeholder="npx"
                className="font-mono text-[13px]"
              />
            </Fieldset>
            <Fieldset label={t("mcp.args")} hint={t("mcp.argsHint")} className="sm:col-span-2">
              <Textarea
                rows={4}
                value={form.args}
                onChange={(e) => set("args", e.target.value)}
                spellCheck={false}
                className="font-mono text-[13px]"
              />
            </Fieldset>
            <Fieldset label={t("mcp.env")} hint={t("mcp.envHint")} className="sm:col-span-2">
              <Textarea
                rows={3}
                value={form.env}
                onChange={(e) => set("env", e.target.value)}
                spellCheck={false}
                className="font-mono text-[13px]"
                placeholder="API_KEY=…"
              />
            </Fieldset>
          </>
        ) : (
          <>
            <Fieldset label={t("mcp.url")} hint={t("mcp.urlHint")} className="sm:col-span-2">
              <Input
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://example.com/mcp"
                className="font-mono text-[13px]"
              />
            </Fieldset>
            <Fieldset label={t("mcp.headers")} hint={t("mcp.headersHint")} className="sm:col-span-2">
              <Textarea
                rows={3}
                value={form.headers}
                onChange={(e) => set("headers", e.target.value)}
                spellCheck={false}
                className="font-mono text-[13px]"
                placeholder="Authorization=Bearer …"
              />
            </Fieldset>
          </>
        )}
      </div>

      <p className="mt-4 text-[13px] text-muted-foreground/70">{t("mcp.passthroughHint")}</p>

      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        savedAt={savedAt}
        error={error}
        onSave={() => void runSave(false)}
        onRevert={() => setForm(baseline)}
        extra={
          <Button variant="ghost" onClick={() => void remove()} disabled={save.isPending}>
            <Trash2 className="size-4" />
            {t("mcp.remove")}
          </Button>
        }
      />

      <ConflictDialog
        open={conflict}
        path={item.sourceFile}
        busy={save.isPending}
        onReload={() => void reload()}
        onOverwrite={() => void runSave(true)}
        onCancel={() => setConflict(false)}
      />
    </div>
  );
}
