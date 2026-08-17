import { Link, useNavigate } from "@tanstack/react-router";
import { MessageSquare, MessageSquarePlus, Folder } from "lucide-react";
import { useAllChatSessions, useProjects } from "@/lib/queries";
import { relativeTime, useT } from "@/lib/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { BackendGlyph } from "@/components/BrandIcons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";

/**
 * Every conversation AMOS knows, in one flat list.
 *
 * The sidebar answers "what did I say in *this* project"; this view answers
 * "where was I, whatever the project". So the list is sorted purely by
 * recency, and the project is demoted to a detail on the row rather than a
 * heading that breaks the ordering into buckets.
 *
 * A chat still belongs to a project — the backend needs a working directory —
 * so "New conversation" asks which one, instead of guessing.
 */
export function ConversationsView() {
  const t = useT();
  const { data: projects = [] } = useProjects();
  const { sessions, isPending } = useAllChatSessions(projects);

  const count =
    sessions.length === 1 ? t("chats.countOne") : t("chats.count", { count: sessions.length });

  return (
    <>
      <ViewHeader
        icon={<MessageSquare className="size-4" />}
        title={t("chats.title")}
        meta={sessions.length > 0 ? count : undefined}
        actions={<NewConversationButton projects={projects} />}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
          <p className="text-sm text-muted-foreground/80">{t("chats.subtitle")}</p>

          {isPending && sessions.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground/70">
              <Spinner className="size-4" />
            </div>
          )}

          {!isPending && sessions.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center">
              <p className="text-sm text-muted-foreground/80">{t("chats.empty")}</p>
              <p className="mt-1 text-[13px] text-muted-foreground/60">
                {projects.length === 0 ? t("chats.noProjects") : t("chats.emptyHint")}
              </p>
            </div>
          )}

          {sessions.length > 0 && (
            <ul className="flex flex-col gap-1">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    to="/p/$projectId/chat/$sessionId"
                    params={{ projectId: session.projectId, sessionId: session.id }}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-accent"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      <BackendGlyph backend={session.backend} className="size-3.5 text-foreground/70" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">
                        {session.title || t("chat.untitled")}
                      </span>
                      <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground/70">
                        <Folder className="size-3 shrink-0" />
                        {session.projectName}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground/60">
                      {relativeTime(t, session.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

/** "New conversation", which first has to settle which project it runs in. */
function NewConversationButton({ projects }: { projects: { id: string; name: string }[] }) {
  const t = useT();
  const navigate = useNavigate();

  if (projects.length === 0) return null;

  // One project: no menu worth showing, just go.
  if (projects.length === 1) {
    const only = projects[0]!;
    return (
      <Button
        size="sm"
        onClick={() => navigate({ to: "/p/$projectId/chat", params: { projectId: only.id } })}
      >
        <MessageSquarePlus className="size-4" />
        {t("chats.new")}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <MessageSquarePlus className="size-4" />
          {t("chats.new")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("chats.newIn")}</DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() =>
              navigate({ to: "/p/$projectId/chat", params: { projectId: project.id } })
            }
          >
            <Folder className="size-3.5" />
            <span className="truncate">{project.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
