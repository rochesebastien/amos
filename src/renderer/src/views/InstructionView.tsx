import { Link, useParams } from "@tanstack/react-router";
import { ViewHeader } from "@/components/ViewHeader";
import { FileText } from "lucide-react";
import { useProjectScan } from "@/lib/queries";
import { useT } from "@/lib/i18n";
import { EcosystemBadge, ScopeBadge } from "@/components/CapabilityBadges";
import { InstructionEditor } from "@/components/editors/InstructionEditor";
import { formatBytes } from "@/lib/utils";

/**
 * One `CLAUDE.md` / `AGENTS.md`, open for editing.
 *
 * Like `ItemView`, the frame lives here and the file is read from the project
 * scan rather than from the route: the watcher rescans on an external change,
 * and the editor below sees the new mtime without a reload.
 */
export function InstructionView() {
  const t = useT();
  const { projectId, fileId } = useParams({ from: "/p/$projectId/instructions/$fileId" });
  const { data: scan, isPending } = useProjectScan(projectId);

  if (isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground/70">
        {t("project.scanning")}
      </div>
    );
  }

  const file = scan?.instructions.find((f) => f.id === fileId);
  if (!file) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-display">{t("instructions.notFound")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground/70">
          {t("instructions.notFoundDesc")}
        </p>
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

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ViewHeader
        backTo="/p/$projectId"
        backParams={{ projectId }}
        backLabel={t("cap.backToProject")}
        icon={<FileText className="size-4" />}
        title={file.relativePath}
        meta={
          <>
            <EcosystemBadge ecosystem={file.ecosystem} size="sm" />
            <ScopeBadge scope={file.scope} size="sm" />
            <span className="shrink-0 text-xs text-muted-foreground/60">
              {formatBytes(file.bytes)}
            </span>
            <span
              className="hidden truncate font-mono text-[12px] text-muted-foreground/60 lg:block"
              title={file.path}
            >
              {file.path}
            </span>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-4">
        <p className="mb-3 text-[13px] text-muted-foreground/70">
          {t(`instructions.read.${file.ecosystem}`)}
        </p>
        <InstructionEditor projectId={projectId} file={file} />
      </div>
    </div>
  );
}
