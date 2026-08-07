import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import { type Project, type ProjectInput } from "@/lib/api";
import { useMcps, useProjectMutations, useSettings } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const blank: ProjectInput = {
  name: "",
  description: "",
  system_prompt: "",
  model: "",
  mcp_ids: [],
};

function toForm(p: Project): ProjectInput {
  return {
    name: p.name,
    description: p.description,
    system_prompt: p.system_prompt,
    model: p.model,
    mcp_ids: p.mcp_ids,
  };
}

/** Create/edit modal for a project. Pass `project` to edit, or null to create. */
export function ProjectModal({
  open,
  onClose,
  project,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  /** Called with the freshly created project (create mode only). */
  onCreated?: (project: Project) => void;
}) {
  const t = useT();
  const { data: mcps = [] } = useMcps();
  const { data: settings } = useSettings();
  const enabledModels = settings?.enabled_models ?? [];
  const mutations = useProjectMutations();
  const [form, setForm] = useState<ProjectInput>(blank);
  const [saving, setSaving] = useState(false);

  // sync the form whenever the modal opens for a (possibly different) project
  useEffect(() => {
    if (open) setForm(project ? toForm(project) : blank);
  }, [open, project]);

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (project) {
        await mutations.update.mutateAsync({ id: project.id, body: form });
      } else {
        const created = await mutations.create.mutateAsync(form);
        onCreated?.(created);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const toggleMcp = (id: number) =>
    setForm((f) => ({
      ...f,
      mcp_ids: f.mcp_ids?.includes(id)
        ? f.mcp_ids.filter((x) => x !== id)
        : [...(f.mcp_ids ?? []), id],
    }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? t("projects.editTitle") : t("projects.newTitle")}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("projects.fieldName")}>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("projects.namePlaceholder")}
            autoFocus
          />
        </Field>
        <Field label={t("projects.fieldDescription")}>
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t("projects.descriptionPlaceholder")}
          />
        </Field>
        <Field
          label={t("projects.fieldPrePrompt")}
          hint={t("projects.prePromptHint")}
        >
          <Textarea
            value={form.system_prompt}
            onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
            placeholder={t("projects.prePromptPlaceholder")}
            rows={4}
          />
        </Field>
        <Field label={t("projects.fieldModel")} hint={t("projects.modelHint")}>
          <Input
            list="project-model-options"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder={t("projects.modelPlaceholder")}
          />
          {enabledModels.length > 0 && (
            <datalist id="project-model-options">
              {enabledModels.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-muted-foreground">{t("projects.attachedMcps")}</span>
          {mcps.length === 0 ? (
            <p className="text-[13px] text-muted-foreground/70">
              {t("projects.noMcpsYet")}
            </p>
          ) : (
            <div className="flex flex-col gap-1 rounded-md border border-border p-1">
              {mcps.map((m) => {
                const checked = form.mcp_ids?.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMcp(m.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                      checked ? "bg-primary/10" : "hover:bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {checked && "✓"}
                    </span>
                    <Plug className="size-3.5 text-primary" />
                    <span className="flex-1">{m.name}</span>
                    <Badge variant="outline">{m.type}</Badge>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
