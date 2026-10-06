// Tests for the chat turn glue shared by the Chat page and Quick Chat. Runs the
// real reducer against the mock backend, with `window` pointed at globalThis.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as api from "../../lib/api";
import { installMocks, uninstallMocks } from "../../lib/mock";
import type { Chat } from "../../lib/types";
import { chatReducer, initialChatState, type ChatAction, type ChatState } from "./chatState";
import { lastUserInput, runTurn, takeLiveRetry } from "./turn";
import { blankMessage } from "./utils";

/** A reducer outside React: `dispatch` updates `state` right away. */
function store(chat: Chat) {
  const s = {
    state: chatReducer(initialChatState, { type: "setChat", chat }) as ChatState,
    dispatch: (action: ChatAction) => {
      s.state = chatReducer(s.state, action);
    },
  };
  return s;
}

describe("a chat turn through the mock backend", () => {
  beforeAll(() => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    vi.spyOn(console, "info").mockImplementation(() => {});
    installMocks({ scenario: "default", timeScale: 0 });
  });

  afterAll(() => {
    uninstallMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("streams the answer and ends with the saved messages", async () => {
    const chat = await api.chatCreate();
    const s = store(chat);
    let started = false;
    const turn = runTurn(s.dispatch, chat.id, { text: "What is 12 * 7?", images: [] }, () => {
      started = true;
      // The optimistic user message shows before any answer.
      expect(s.state.runs[chat.id].running).toBe(true);
      expect(s.state.chats[chat.id].messages).toHaveLength(1);
    });
    await turn;
    expect(started).toBe(true);
    const run = s.state.runs[chat.id];
    const messages = s.state.chats[chat.id].messages;
    expect(run.running).toBe(false);
    expect(run.error).toBeNull();
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    // Both are the saved messages, not the temporary ones.
    expect(messages.map((m) => m.id)).toEqual((await api.chatGet(chat.id)).messages.map((m) => m.id));
    expect(messages[1].steps.map((st) => [st.toolName, st.status])).toEqual([["calculator", "done"]]);
    expect(messages[1].text).toContain("84");
  });

  it("waits for an approval and records a denied tool call", async () => {
    const chat = await api.chatCreate();
    const s = store(chat);
    const pending: string[] = [];
    const dispatch = (action: ChatAction) => {
      s.dispatch(action);
      if (action.type === "event" && action.event.type === "approvalRequired") {
        pending.push(action.event.approvalId);
        expect(Object.values(s.state.runs[chat.id].approvals)).toEqual([action.event.approvalId]);
        void api.approvalRespond(action.event.approvalId, "deny");
      }
    };
    await runTurn(dispatch, chat.id, { text: "Read https://example.com/tips", images: [] });
    expect(pending).toHaveLength(1);
    const last = s.state.chats[chat.id].messages.slice(-1)[0];
    expect(last.steps.map((st) => st.status)).toEqual(["denied"]);
    expect(s.state.runs[chat.id].approvals).toEqual({});
  });

  it("ends the run with the error when sending fails, and can retry it", async () => {
    // A chat the backend does not know: chat_send rejects.
    const ghost: Chat = { id: "ghost", title: "New chat", createdAt: 1, updatedAt: 1, instructions: "", messages: [] };
    const s = store(ghost);
    await runTurn(s.dispatch, "ghost", { text: "Hello", images: ["data:image/png;base64,AA=="] });
    const run = s.state.runs.ghost;
    expect(run.running).toBe(false);
    expect(run.error).toBe("This chat does not exist anymore.");
    // The unsent user message stays until Retry.
    expect(s.state.chats.ghost.messages.map((m) => m.text)).toEqual(["Hello"]);

    const input = takeLiveRetry(s.dispatch, "ghost", run);
    expect(input).toEqual({ text: "Hello", images: ["data:image/png;base64,AA=="] });
    expect(s.state.chats.ghost.messages).toEqual([]);
    expect(s.state.runs.ghost.error).toBeNull();
  });
});

describe("retry input", () => {
  it("is the last user message", () => {
    const messages = [
      blankMessage("user", { text: "First" }),
      blankMessage("assistant", { text: "One" }),
      blankMessage("user", { text: "Second", images: ["data:x"] }),
      blankMessage("assistant", { error: "Stopped." }),
    ];
    expect(lastUserInput(messages)).toEqual({ text: "Second", images: ["data:x"] });
    expect(lastUserInput([])).toBeNull();
  });
});
