import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { capabilityId, type AgentItem } from "@shared/capabilities";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { useProjectScan, useSaveAgent } from "@/lib/queries";
import { ConflictDialog, Fieldset, isConflict, Notice, SaveBar } from "./shell";

/**
 * Editing one agent `.md`.
 *
 * The form covers the four frontmatter keys the two CLIs actually read; every
 * other key the file carries is listed read-only and travels untouched,
 * because the merge happens in the main process against the bytes on disk —
 * this form never regenerates a file from its own idea of an agent.
 */

type Form = {
  name: string;
  description: string;
  model: string;
  /** Comma-separated, the way agent files most often write it. */
  tools: string;
  body: string;
};

/** The frontmatter keys the form owns; the rest is passthrough. */
const KNOWN_KEYS = new Set(["name", "description", "model", "tools"]);

function seedFrom(item: AgentItem): Form {
  const data = item.data;
  return {
    name: typeof data?.frontmatter.name === "string" ? data.frontmatter.name : "",
    description: data?.description ?? "",
    model: data?.model ?? "",
    tools: data?.tools?.join(", ") ?? "",
    body: data?.body ?? "",
  };
}

function same(a: Form, b: Form): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.model === b.model &&
    a.tools === b.tools &&
    a.body === b.body
  );
}

export function AgentEditor({ projectId, item }: { projectId: string; item: AgentItem }) {
  const t = useT();
  const navigate = useNavigate();
  const save = useSaveAgent(projectId);
  const scanQuery = useProjectScan(projectId);

  const [form, setForm] = useState<Form>(() => seedFrom(item));
  const [baseline, setBaseline] = useState<Form>(() => seedFrom(item));
  const [expectedMtimeMs, setExpectedMtimeMs] = useState<number>(item.mtimeMs);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);

  const dirty = !same(form, baseline);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const adopt = useCallback((next: AgentItem) => {
    const seeded = seedFrom(next);
    setForm(seeded);
    setBaseline(seeded);
    setExpectedMtimeMs(next.mtimeMs);
    setError(null);
    setConflict(false);
  }, []);

  // Re-seed when the route moves to another agent — always — and when the file
  // changed on disk while the form had nothing at risk. With unsaved edits an
  // external change is left alone: the save will hit the conflict dialog, which
  // is where the user gets to choose whose version wins.
  const seenId = useRef(item.id);
  useEffect(() => {
    const switched = seenId.current !== item.id;
    seenId.current = item.id;
    if (switched || !dirtyRef.current) adopt(item);
  }, [item, adopt]);

  const passthrough = useMemo(
    () => Object.entries(item.data?.frontmatter ?? {}).filter(([key]) => !KNOWN_KEYS.has(key)),
    [item.data],
  );

  const runSave = async (force: boolean) => {
    setError(null);
    try {
      const result = await save.mutateAsync({
        document: "agent",
        filePath: item.sourceFile,
        fields: {
          name: form.name,
          description: form.description,
          model: form.model,
          tools: form.tools
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
        body: form.body,
        expectedMtimeMs: force ? undefined : expectedMtimeMs,
      });
      setBaseline(form);
      setExpectedMtimeMs(result.mtimeMs);
      setSavedAt(Date.now());
      setConflict(false);

      // The item's id is a hash of its name, so renaming an agent moves the
      // route it lives at.
      const fallback = item.sourceFile.split(/[/\\]/).pop()?.replace(/\.md$/i, "") ?? item.name;
      const nextId = capabilityId("agent", result.path, form.name.trim() || fallback);
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
    if (fresh?.kind === "agent") adopt(fresh);
    else setConflict(false);
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="max-w-4xl">
      {item.parseError && <Notice tone="warning">{t("agent.brokenHint")}</Notice>}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Fieldset label={t("agent.name")} hint={t("agent.nameHint")}>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Fieldset>
        <Fieldset label={t("agent.model")} hint={t("agent.modelHint")}>
          <Input
            value={form.model}
            onChange={(e) => set("model", e.target.value)}
            placeholder={t("agent.modelPlaceholder")}
          />
        </Fieldset>
        <Fieldset label={t("agent.description")} hint={t("agent.descriptionHint")} className="sm:col-span-2">
          <Textarea
            rows={2}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Fieldset>
        <Fieldset label={t("agent.tools")} hint={t("agent.toolsHint")} className="sm:col-span-2">
          <Input
            value={form.tools}
            onChange={(e) => set("tools", e.target.value)}
            placeholder="Read, Grep, Bash"
            className="font-mono text-[13px]"
          />
        </Fieldset>
      </div>

      {passthrough.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-1 text-base font-display">{t("agent.otherKeys")}</h2>
          <p className="mb-2 text-[13px] text-muted-foreground/70">{t("agent.otherKeysHint")}</p>
          <ul className="flex flex-col gap-1">
            {passthrough.map(([key, value]) => (
              <li
                key={key}
                className="flex gap-3 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-[13px]"
              >
                <span className="shrink-0 text-muted-foreground">{key}</span>
                <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-base font-display">{t("agent.instructions")}</h2>
        <Textarea
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
          aria-label={t("agent.instructions")}
          spellCheck={false}
          rows={18}
          className="font-mono text-[13px] leading-relaxed"
          placeholder={t("agent.bodyPlaceholder")}
        />
      </section>

      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        savedAt={savedAt}
        error={error}
        onSave={() => void runSave(false)}
        onRevert={() => setForm(baseline)}
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
