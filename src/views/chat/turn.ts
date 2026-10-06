// One chat turn, shared by the Chat page and Quick Chat: the optimistic user
// message, the streamed AgentEvents into the chat reducer, the saved answer,
// approvals and retries.

import type { Dispatch } from "react";
import { approvalRespond, chatSend, errorMessage, getConfig } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { AgentEvent, ApprovalDecision, ChatMessage } from "../../lib/types";
import type { ChatAction, RunState } from "./chatState";
import { blankMessage } from "./utils";

/** What the user sends: text and image data URLs. */
export interface TurnInput {
  text: string;
  images: string[];
}

/**
 * Sends one message and streams the answer into the reducer. Never rejects:
 * a failure ends the run with its error. `onStarted` runs right after the
 * user message shows (for example to scroll to it).
 */
export async function runTurn(
  dispatch: Dispatch<ChatAction>,
  chatId: string,
  input: TurnInput,
  onStarted?: () => void,
): Promise<void> {
  const { text, images } = input;
  dispatch({ type: "startRun", chatId, text, images, tempUser: blankMessage("user", { text, images }) });
  onStarted?.();
  const onEvent = (event: AgentEvent) => dispatch({ type: "event", chatId, event });
  try {
    const final = await chatSend(chatId, text, images, onEvent);
    dispatch(final?.id ? { type: "finishRun", chatId, message: final } : { type: "finishRun", chatId });
  } catch (err) {
    dispatch({ type: "finishRun", chatId, error: errorMessage(err) });
  }
}

/** Sends the answer to a tool approval. Returns false (after a toast) when it failed. */
export async function answerApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
  try {
    await approvalRespond(approvalId, decision);
    if (decision === "always") {
      // The engine saved approval=always in the config; keep the store in sync
      // so a later config save does not undo it. (The config-changed event
      // does this too, so a failed read here is harmless.)
      getConfig()
        .then((fresh) => useApp.setState({ config: fresh }))
        .catch(() => undefined);
    }
    return true;
  } catch (err) {
    useApp.getState().toast(`Could not send your answer. ${errorMessage(err)}`, "error");
    return false;
  }
}

/**
 * Retry after a turn that failed without a saved answer: removes the unsaved
 * user message and the error, and returns the input to send again.
 */
export function takeLiveRetry(dispatch: Dispatch<ChatAction>, chatId: string, run: RunState): TurnInput {
  if (run.tempUserId) dispatch({ type: "removeMessage", chatId, messageId: run.tempUserId });
  dispatch({ type: "clearError", chatId });
  return { text: run.lastText, images: run.lastImages };
}

/** Retry for a saved answer with an error: the last user message. */
export function lastUserInput(messages: ChatMessage[]): TurnInput | null {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return lastUser ? { text: lastUser.text, images: lastUser.images } : null;
}
