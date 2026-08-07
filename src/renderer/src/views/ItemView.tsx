import { Link, useParams } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, FileCode } from "lucide-react";
import type { CapabilityItem } from "@shared/capabilities";
import { useProjectScan } from "@/lib/queries";
import { useT, type TFunc } from "@/lib/i18n";
import { CapabilityBadges, KIND_ICONS } from "@/components/CapabilityBadges";
import { AgentEditor } from "@/components/editors/AgentEditor";
import { McpEditor } from "@/components/editors/McpEditor";
import { SkillEditor } from "@/components/editors/SkillEditor";

/**
 * One capability, open for editing.
 *
 * This view owns the frame — identity, source file, parse errors — and hands
 * the body to the editor of the item's kind. All three read the item from the
 * project scan, so an external change picked up by the watcher flows into them
 * without a reload.
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
          <h1 className="flex min-w-0 items-center gap-3 text-2xl font-display">
            <Icon className="size-5 shrink-0 text-muted-foreground" />
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

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-4">
        {item.parseError && (
          <div className="mb-6 max-w-4xl rounded-xl border border-destructive/30 bg-destructive/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4" />
              {t("cap.parseError")}
            </p>
            <p className="mt-1 font-mono text-[13px] text-destructive/90">{item.parseError}</p>
          </div>
        )}

        <Editor t={t} projectId={projectId} item={item} />
      </div>
    </div>
  );
}

function Editor({
  t,
  projectId,
  item,
}: {
  t: TFunc;
  projectId: string;
  item: CapabilityItem;
}) {
  // A config file that would not parse at all is listed as one broken MCP item
  // named after the file. There is no entry to edit — only a file to fix.
  if (item.kind === "mcp" && item.data === null) {
    return (
      <p className="max-w-4xl text-sm text-muted-foreground/70">{t("cap.fixByHand")}</p>
    );
  }
  if (item.kind === "agent") return <AgentEditor projectId={projectId} item={item} />;
  if (item.kind === "skill") return <SkillEditor projectId={projectId} item={item} />;
  return <McpEditor projectId={projectId} item={item} />;
}
