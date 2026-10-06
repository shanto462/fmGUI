// The messages of one chat with its live run: user bubbles, assistant answers
// with tool steps and approvals, the "Thinking…" line, and the error of a
// failed turn. Shared by the Chat page and Quick Chat.

import type { ApprovalDecision, ChatMessage } from "../../lib/types";
import type { RunState } from "./chatState";
import { AssistantMessage, MessageError, StatusLine, UserMessage } from "./Messages";
import { isTempId } from "./utils";

export function MessageList(props: {
  messages: ChatMessage[];
  run: RunState | undefined;
  dangerousTools: Set<string>;
  onRespond: (approvalId: string, decision: ApprovalDecision) => Promise<boolean>;
  /** Retry for a saved answer with an error (shown on the last message). */
  onRetrySaved: () => void;
  /** Retry for a failed turn without a saved answer. No button when missing. */
  onRetryLive?: () => void;
  /** Changing it replays the entry animation (a different chat). */
  listKey?: string;
}) {
  const { messages, run } = props;
  const running = !!run?.running;
  const lastMessage = messages[messages.length - 1];

  return (
    <>
      {(messages.length > 0 || running) && (
        <div className="cv-thread__messages" key={props.listKey}>
          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserMessage key={i} text={m.text} images={m.images} pending={running && isTempId(m.id)} />
            ) : (
              <AssistantMessage
                key={i}
                message={m}
                streaming={running && m.id === run?.liveId}
                status={m.id === run?.liveId ? (run?.status ?? null) : null}
                approvals={m.id === run?.liveId ? run?.approvals : undefined}
                dangerousTools={props.dangerousTools}
                onRespond={props.onRespond}
                onRetry={!running && m === lastMessage && m.error ? props.onRetrySaved : undefined}
              />
            ),
          )}
          {running && !run?.liveId && (
            <div className="cv-msg cv-msg--assistant">
              <StatusLine text={run?.status || "Thinking…"} />
            </div>
          )}
        </div>
      )}
      {!running && run?.error && <MessageError text={run.error} onRetry={props.onRetryLive} />}
    </>
  );
}
