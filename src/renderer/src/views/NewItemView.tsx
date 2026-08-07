import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Plus } from "lucide-react";
import {
  capabilityId,
  ECOSYSTEMS,
  findTarget,
  isSafeName,
  joinPath,
  MCP_TRANSPORTS,
  type CapabilityKind,
  type Ecosystem,
  type McpTransport,
  type Scope,
} from "@shared/capabilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { KIND_ICONS } from "@/components/CapabilityBadges";
import { errorText, Fieldset, Notice } from "@/components/editors/shell";
import { useT } from "@/lib/i18n";
import { useProjectScan, useSaveAgent, useSaveMcp } from "@/lib/queries";

/**
 * Creating an agent, a skill or an MCP server.
 *
 * Where a new capability goes is a convention of each ecosystem, not a choice
 * — so the form asks for the ecosystem, the scope and a name, shows the exact
 * path it is about to create, and writes it with a "this file must not exist
 * yet" guard. The scaffold is deliberately thin: the editor opens on it right
 * after, and that is where the real content gets written.
 */

const KINDS: CapabilityKind[] = ["agent", "skill", "mcp"];

function isKind(value: string): value is CapabilityKind {
  return (KINDS as string[]).includes(value);
}

export function NewItemView() {
  const t = useT();
  const navigate = useNavigate();
  const { projectId, kind: rawKind } = useParams({ from: "/p/$projectId/new/$kind" });
  const kind: CapabilityKind = isKind(rawKind) ? rawKind : "agent";

  const { data: scan, isPending } = useProjectScan(projectId);
  const saveAgent = useSaveAgent(projectId);
  const saveMcp = useSaveMcp(projectId);

  const [ecosystem, setEcosystem] = useState<Ecosystem>("claude");
  const [scope, setScope] = useState<Scope>("project");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<unknown>(null);

  const target = scan ? findTarget(scan.targets, ecosystem, scope) : undefined;

  // Codex declares no per-agent files: its agent instructions are AGENTS.md.
  const agentsUnsupported = kind === "agent" && target != null && target.agentsDir === null;

  const destination = useMemo(() => {
    if (!target || !isSafeName(name)) return null;
    if (kind === "agent") return target.agentsDir ? joinPath(target.agentsDir, `${name}.md`) : null;
    if (kind === "skill") return joinPath(target.skillsDir, name, "SKILL.md");
    return target.mcpFile;
  }, [target, kind, name]);

  // An MCP entry is a key in a file that already exists, so the "must not
  // exist yet" guard the other two kinds get does not apply — the name clash
  // has to be caught here instead, against the scan.
  const nameTaken = Boolean(
    destination &&
      kind === "mcp" &&
      scan?.items.some((i) => i.kind === "mcp" && i.sourceFile === destination && i.name === name),
  );

  const valid =
    isSafeName(name) &&
    destination !== null &&
    !agentsUnsupported &&
    !nameTaken &&
    (kind !== "mcp" || (transport === "stdio" ? command.trim() !== "" : url.trim() !== ""));

  const busy = saveAgent.isPending || saveMcp.isPending;

  const create = async () => {
    if (!valid || !destination) return;
    setError(null);
    try {
      if (kind === "mcp") {
        const result = await saveMcp.mutateAsync({
          sourceFile: destination,
          name,
          fields: {
            transport,
            command: transport === "stdio" ? command.trim() : null,
            args: [],
            env: {},
            url: transport === "stdio" ? null : url.trim(),
            headers: {},
          },
        });
        goToItem(capabilityId("mcp", result.path, name));
        return;
      }

      const result = await saveAgent.mutateAsync({
        document: kind === "skill" ? "skill" : "agent",
        filePath: destination,
        fields: { name, description },
        body:
          kind === "skill"
            ? t("new.skillScaffold", { name })
            : t("new.agentScaffold", { name }),
        // The file must not exist: creating over somebody's work is a conflict,
        // not a merge.
        expectedMtimeMs: null,
      });
      goToItem(capabilityId(kind, result.path, name));
    } catch (err) {
      setError(err);
    }
  };

  const goToItem = (itemId: string) => {
    void navigate({ to: "/p/$projectId/item/$itemId", params: { projectId, itemId } });
  };

  const Icon = KIND_ICONS[kind];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="px-8 pt-8 pb-4">
        <Link
          to="/p/$projectId"
          params={{ projectId }}
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t("cap.backToProject")}
        </Link>
        <h1 className="flex items-center gap-3 text-3xl font-display">
          <Icon className="size-7 shrink-0 text-primary" />
          {t(`new.title.${kind}`)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground/70">{t(`new.subtitle.${kind}`)}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        {isPending ? (
          <p className="text-sm text-muted-foreground/70">{t("project.scanning")}</p>
        ) : (
          <div className="max-w-2xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <Fieldset label={t("new.ecosystem")} hint={t("new.ecosystemHint")}>
                <Select
                  value={ecosystem}
                  onChange={(e) => setEcosystem(e.target.value as Ecosystem)}
                >
                  {ECOSYSTEMS.map((eco) => (
                    <option key={eco} value={eco}>
                      {t(`cap.eco.${eco}`)}
                    </option>
                  ))}
                </Select>
              </Fieldset>
              <Fieldset label={t("new.scope")} hint={t("new.scopeHint")}>
                <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                  <option value="project">{t("cap.scope.project")}</option>
                  <option value="global">{t("cap.scope.global")}</option>
                </Select>
              </Fieldset>

              <Fieldset label={t("new.name")} hint={t("new.nameHint")} className="sm:col-span-2">
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t(`new.namePlaceholder.${kind}`)}
                  className="font-mono text-[13px]"
                />
              </Fieldset>

              {kind !== "mcp" && (
                <Fieldset
                  label={t("agent.description")}
                  hint={t("new.descriptionHint")}
                  className="sm:col-span-2"
                >
                  <Textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Fieldset>
              )}

              {kind === "mcp" && (
                <>
                  <Fieldset label={t("mcp.transport")} hint={t("mcp.transportHint")}>
                    <Select
                      value={transport}
                      onChange={(e) => setTransport(e.target.value as McpTransport)}
                    >
                      {MCP_TRANSPORTS.map((tr) => (
                        <option key={tr} value={tr}>
                          {t(`mcp.transport.${tr}`)}
                        </option>
                      ))}
                    </Select>
                  </Fieldset>
                  {transport === "stdio" ? (
                    <Fieldset label={t("mcp.command")} hint={t("mcp.commandHint")}>
                      <Input
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        placeholder="npx"
                        className="font-mono text-[13px]"
                      />
                    </Fieldset>
                  ) : (
                    <Fieldset label={t("mcp.url")} hint={t("mcp.urlHint")}>
                      <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://example.com/mcp"
                        className="font-mono text-[13px]"
                      />
                    </Fieldset>
                  )}
                </>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {agentsUnsupported && <Notice tone="warning">{t("new.codexNoAgents")}</Notice>}
              {name !== "" && !isSafeName(name) && (
                <Notice tone="warning">{t("new.nameInvalid")}</Notice>
              )}
              {nameTaken && <Notice tone="warning">{t("new.nameTaken", { name })}</Notice>}
              {destination && (
                <p className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-[12px] break-all">
                  {destination}
                </p>
              )}
              {error != null && <Notice tone="error">{errorText(error)}</Notice>}
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button onClick={() => void create()} disabled={!valid || busy}>
                <Plus className="size-4" />
                {busy ? t("common.saving") : t("common.create")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void navigate({ to: "/p/$projectId", params: { projectId } })}
              >
                {t("common.cancel")}
              </Button>
            </div>

            {scope === "global" && (
              <p className="mt-4 text-[13px] text-muted-foreground/70">{t("new.globalHint")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
