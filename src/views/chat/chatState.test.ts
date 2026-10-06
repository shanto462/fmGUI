import { describe, expect, it } from "vitest";
import type { Chat, ChatMessage } from "../../lib/types";
import { chatReducer, initialChatState, type ChatState } from "./chatState";
import { blankMessage } from "./utils";

const CHAT_ID = "chat-1";

function emptyChat(): Chat {
  return {
    id: CHAT_ID,
    title: "New chat",
    instructions: "",
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  };
}

function started(): ChatState {
  let state = chatReducer(initialChatState, { type: "setChat", chat: emptyChat() });
  state = chatReducer(state, {
    type: "startRun",
    chatId: CHAT_ID,
    text: "Hello",
    images: [],
    tempUser: blankMessage("user", { text: "Hello" }),
  });
  state = chatReducer(state, { type: "event", chatId: CHAT_ID, event: { type: "assistantStart", messageId: "a1" } });
  return chatReducer(state, { type: "event", chatId: CHAT_ID, event: { type: "delta", text: "Partial answer" } });
}

function savedAnswer(patch: Partial<ChatMessage>): ChatMessage {
  return blankMessage("assistant", { id: "a1", durationMs: 1200, ...patch });
}

describe("a failed chat turn", () => {
  it("shows the error once, on the saved message, and keeps the partial text", () => {
    let state = started();
    state = chatReducer(state, { type: "event", chatId: CHAT_ID, event: { type: "error", message: "fm stopped." } });
    // Still running until "done" arrives, so nothing is shown twice in between.
    expect(state.runs[CHAT_ID].running).toBe(true);

    state = chatReducer(state, {
      type: "event",
      chatId: CHAT_ID,
      event: { type: "done", message: savedAnswer({ text: "", error: "fm stopped." }) },
    });
    const run = state.runs[CHAT_ID];
    const last = state.chats[CHAT_ID].messages.slice(-1)[0];
    expect(run.running).toBe(false);
    expect(run.error).toBeNull();
    expect(last.id).toBe("a1");
    expect(last.error).toBe("fm stopped.");
    expect(last.text).toBe("Partial answer");

    // The resolved chat_send result after "done" changes nothing.
    const after = chatReducer(state, { type: "finishRun", chatId: CHAT_ID, message: last });
    expect(after).toBe(state);
  });

  it("uses the saved text when the engine kept it", () => {
    let state = started();
    state = chatReducer(state, { type: "event", chatId: CHAT_ID, event: { type: "error", message: "Stopped." } });
    state = chatReducer(state, {
      type: "event",
      chatId: CHAT_ID,
      event: { type: "done", message: savedAnswer({ text: "Saved partial", error: "Stopped." }) },
    });
    expect(state.chats[CHAT_ID].messages.slice(-1)[0].text).toBe("Saved partial");
  });

  it("shows the error event once when no done event arrives", () => {
    let state = started();
    state = chatReducer(state, { type: "event", chatId: CHAT_ID, event: { type: "error", message: "Not ready." } });
    state = chatReducer(state, { type: "finishRun", chatId: CHAT_ID });
    const run = state.runs[CHAT_ID];
    expect(run.running).toBe(false);
    expect(run.error).toBe("Not ready.");
    // The partial text stays.
    expect(state.chats[CHAT_ID].messages.some((m) => m.text === "Partial answer")).toBe(true);
  });

  it("keeps a save error that is not on the message", () => {
    let state = started();
    state = chatReducer(state, { type: "event", chatId: CHAT_ID, event: { type: "error", message: "Disk full." } });
    state = chatReducer(state, {
      type: "event",
      chatId: CHAT_ID,
      event: { type: "done", message: savedAnswer({ text: "Partial answer" }) },
    });
    expect(state.runs[CHAT_ID].error).toBe("Disk full.");
    expect(state.chats[CHAT_ID].messages.slice(-1)[0].error).toBeNull();
  });
});

describe("a good chat turn", () => {
  it("replaces the live message with the saved one", () => {
    let state = started();
    state = chatReducer(state, {
      type: "event",
      chatId: CHAT_ID,
      event: { type: "done", message: savedAnswer({ text: "Partial answer, done." }) },
    });
    const messages = state.chats[CHAT_ID].messages;
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(messages[messages.length - 1].text).toBe("Partial answer, done.");
    expect(state.runs[CHAT_ID].error).toBeNull();
  });
});
