import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, FileCode, FileText } from "lucide-react";
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
            <FileText className="size-7 shrink-0 text-primary" />
            <span className="truncate">{file.relativePath}</span>
          </h1>
          <EcosystemBadge ecosystem={file.ecosystem} />
          <ScopeBadge scope={file.scope} />
          <span className="text-xs text-muted-foreground/60">{formatBytes(file.bytes)}</span>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground/70">
          <FileCode className="size-3.5 shrink-0" />
          <span className="truncate font-mono text-[13px]" title={file.path}>
            {file.path}
          </span>
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground/70">
          {t(`instructions.read.${file.ecosystem}`)}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-4">
        <InstructionEditor projectId={projectId} file={file} />
      </div>
    </div>
  );
}
