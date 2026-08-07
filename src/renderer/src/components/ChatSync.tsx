import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import { qk } from "@/lib/queries";
import { useChatStreams } from "@/lib/chatStream";

/**
 * The window's single subscription to the chat and CLI pushes.
 *
 * It is mounted once, in the app shell, rather than inside the chat view: a
 * turn keeps streaming while the user browses their agents, and the tokens
 * have to keep landing somewhere. When a turn ends, the persisted transcript
 * is refetched — the database, not this store, is what the view reads once the
 * streaming is over.
 *
 * Renders nothing.
 */
export function ChatSync() {
  const qc = useQueryClient();
  const apply = useChatStreams((state) => state.apply);

  useEffect(() => {
    return ipc.onChatEvent((message) => {
      apply(message);
      if (message.event.type === "start") {
        void qc.invalidateQueries({ queryKey: qk.chatSessions(message.projectId) });
      }
      if (message.event.type === "done") {
        void qc.invalidateQueries({ queryKey: qk.chatSession(message.sessionId) });
        void qc.invalidateQueries({ queryKey: qk.chatSessions(message.projectId) });
      }
    });
  }, [apply, qc]);

  useEffect(() => {
    return ipc.onCliChanged((detection) => qc.setQueryData(qk.clis, detection));
  }, [qc]);

  return null;
}
