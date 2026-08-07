import { Link, useParams } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, FileCode } from "lucide-react";
import type { AgentData, CapabilityItem, McpData, SkillData } from "@shared/capabilities";
import { useProjectScan } from "@/lib/queries";
import { useT, type TFunc } from "@/lib/i18n";
import { Markdown } from "@/components/Markdown";
import { CapabilityBadges, KIND_ICONS } from "@/components/CapabilityBadges";
import { formatBytes } from "@/lib/utils";

/**
 * Read-only detail of one capability. Everything shown here comes from the
 * scan — the file on disk is the truth, and editing lands in the next phase.
 */
export function ItemView() {
  const t = useT();
  const { projectId, itemId } = useParams({ from: "/p/$projectId/item/$itemId" });
  const { data: scan, isPending } = useProjectScan(projectId);

  if (isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground/70">
        {t("project.scanning")}
      </div>
    );
  }

  const item = scan?.items.find((i) => i.id === itemId);
  if (!item) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-display">{t("cap.notFound")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground/70">{t("cap.notFoundDesc")}</p>
        <Link
          to="/p/$projectId"
          params={{ projectId }}
          className="text-sm text-primary hover:underline"
        >
          {t("cap.backToProject")}
        </Link>
      </div>
    );
  }

  const Icon = KIND_ICONS[item.kind];

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
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex min-w-0 items-center gap-3 text-3xl font-display">
            <Icon className="size-7 shrink-0 text-primary" />
            <span className="truncate">{item.name}</span>
          </h1>
          <CapabilityBadges item={item} />
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground/70">
          <FileCode className="size-3.5 shrink-0" />
          <span className="truncate font-mono text-[13px]" title={item.sourceFile}>
            {item.sourceFile}
          </span>
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        {item.parseError && (
          <div className="mb-6 max-w-4xl rounded-xl border border-destructive/30 bg-destructive/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4" />
              {t("cap.parseError")}
            </p>
            <p className="mt-1 font-mono text-[13px] text-destructive/90">{item.parseError}</p>
          </div>
        )}

        <Detail t={t} item={item} />

        <p className="mt-8 text-xs text-muted-foreground/50">{t("cap.readOnly")}</p>
      </div>
    </div>
  );
}

function Detail({ t, item }: { t: TFunc; item: CapabilityItem }) {
  if (!item.data) return null;
  if (item.kind === "agent") return <AgentDetail t={t} data={item.data} />;
  if (item.kind === "skill") return <SkillDetail t={t} data={item.data} />;
  return <McpDetail t={t} data={item.data} />;
}

// -------------------------------------------------------------------- agent

function AgentDetail({ t, data }: { t: TFunc; data: AgentData }) {
  const entries = Object.entries(data.frontmatter);
  return (
    <div className="max-w-4xl">
      <Section title={t("agent.frontmatter")}>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">{t("agent.noFrontmatter")}</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground/60">
                <th className="w-48 border-b border-border py-1.5 pr-4 font-semibold">
                  {t("agent.field")}
                </th>
                <th className="border-b border-border py-1.5 font-semibold">{t("agent.value")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([key, value]) => (
                <tr key={key} className="align-top">
                  <td className="border-b border-border/60 py-1.5 pr-4 font-mono text-[13px] text-muted-foreground">
                    {key}
                  </td>
                  <td className="border-b border-border/60 py-1.5 break-words whitespace-pre-wrap font-mono text-[13px]">
                    {renderValue(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={t("agent.instructions")}>
        {data.body.trim() ? (
          <Markdown content={data.body} />
        ) : (
          <p className="text-sm text-muted-foreground/70">{t("agent.noBody")}</p>
        )}
      </Section>
    </div>
  );
}

// -------------------------------------------------------------------- skill

function SkillDetail({ t, data }: { t: TFunc; data: SkillData }) {
  return (
    <div className="max-w-4xl">
      <Section title={t("skill.folder")}>
        <p className="font-mono text-[13px] break-all text-muted-foreground">{data.directory}</p>
      </Section>

      <Section title={t("skill.files")}>
        {data.files.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">{t("skill.noFiles")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.files.map((file) => (
              <li
                key={file.relativePath}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                  {file.relativePath}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground/60">
                  {formatBytes(file.bytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("skill.content")}>
        <Markdown content={data.body} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------- mcp

function McpDetail({ t, data }: { t: TFunc; data: McpData }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t("mcp.transport"), value: data.transport },
    { label: t("mcp.command"), value: data.command ?? t("mcp.empty") },
    { label: t("mcp.args"), value: data.args.length ? data.args.join(" ") : t("mcp.empty") },
    { label: t("mcp.url"), value: data.url ?? t("mcp.empty") },
    { label: t("mcp.env"), value: keyValueList(data.env, t) },
    { label: t("mcp.headers"), value: keyValueList(data.headers, t) },
  ];

  return (
    <div className="max-w-4xl">
      <Section title={t("cap.mcp")}>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="border-b border-border/60 py-1.5 text-sm text-muted-foreground">
                {row.label}
              </dt>
              <dd className="border-b border-border/60 py-1.5 break-words whitespace-pre-wrap font-mono text-[13px]">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title={t("mcp.raw")}>
        <pre className="overflow-x-auto rounded-lg border border-border bg-card p-3 text-[12px] leading-relaxed">
          <code>{JSON.stringify(data.raw, null, 2)}</code>
        </pre>
      </Section>
    </div>
  );
}

function keyValueList(map: Record<string, string>, t: TFunc): React.ReactNode {
  const entries = Object.entries(map);
  if (entries.length === 0) return t("mcp.empty");
  return entries.map(([k, v]) => `${k}=${v}`).join("\n");
}

// ------------------------------------------------------------------ helpers

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-base font-display">{title}</h2>
      {children}
    </section>
  );
}

/** Frontmatter values are arbitrary YAML — strings as-is, the rest as JSON. */
function renderValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}
