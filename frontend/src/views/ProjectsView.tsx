import { useEffect, useState } from "react";
import { FolderKanban, Plus, Pencil, Trash2, MessageSquarePlus, Plug } from "lucide-react";
import { api, type Project, type MCP, type ProjectInput } from "@/lib/api";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const blank: ProjectInput = {
  name: "",
  description: "",
  system_prompt: "",
  model: "",
  mcp_ids: [],
};

export function ProjectsView() {
  const { dataVersion, refresh, startNewChat } = useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [mcps, setMcps] = useState<MCP[]>([]);
  const [editing, setEditing] = useState<Project | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProjectInput>(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
    api.listMcps().then(setMcps).catch(() => {});
  }, [dataVersion]);

  const openNew = () => {
    setEditing(null);
    setForm(blank);
    setOpen(true);
  };
  const openEdit = (p: Project) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description,
      system_prompt: p.system_prompt,
      model: p.model,
      mcp_ids: p.mcp_ids,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) await api.updateProject(editing.id, form);
      else await api.createProject(form);
      setOpen(false);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Project) => {
    if (!confirm(`Delete project “${p.name}”?`)) return;
    await api.deleteProject(p.id);
    refresh();
  };

  const toggleMcp = (id: number) =>
    setForm((f) => ({
      ...f,
      mcp_ids: f.mcp_ids?.includes(id)
        ? f.mcp_ids.filter((x) => x !== id)
        : [...(f.mcp_ids ?? []), id],
    }));

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 px-6 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-display">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Group conversations, set a pre-prompt, and attach MCP tools.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="size-4" /> New project
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {projects.length === 0 ? (
          <EmptyState onNew={openNew} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="group flex flex-col rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="size-4 text-primary" />
                    <h3 className="font-display text-base">{p.name}</h3>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(p)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(p)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                {p.description && (
                  <p className="mt-1.5 line-clamp-2 text-[13px] text-muted-foreground">
                    {p.description}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {p.mcp_ids.length > 0 ? (
                    <Badge variant="primary">
                      <Plug className="size-3" /> {p.mcp_ids.length} MCP
                      {p.mcp_ids.length > 1 ? "s" : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline">No MCPs</Badge>
                  )}
                  {p.model && <Badge variant="secondary">{p.model}</Badge>}
                </div>
                <div className="mt-3 flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => startNewChat(p.id)}
                >
                  <MessageSquarePlus className="size-3.5" /> New chat
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit project" : "New project"}
        className="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My project"
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
          <Field label="Pre-prompt (system prompt)" hint="Sent as the system message for every chat in this project.">
            <Textarea
              value={form.system_prompt}
              onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              placeholder="You are a helpful assistant specialised in…"
              rows={4}
            />
          </Field>
          <Field label="Model override" hint="Leave empty to use the default model from Settings.">
            <Input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="(default)"
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted-foreground">Attached MCPs</span>
            {mcps.length === 0 ? (
              <p className="text-[13px] text-muted-foreground/70">
                No MCPs yet — create some in the MCPs tab.
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
                          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
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
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <FolderKanban className="size-6" />
      </div>
      <h2 className="text-xl font-display">No projects yet</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Create a project to give your chats a custom pre-prompt and a set of MCP tools.
      </p>
      <Button onClick={onNew} className="mt-1">
        <Plus className="size-4" /> New project
      </Button>
    </div>
  );
}
