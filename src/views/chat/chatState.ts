// Local state for the Chat view: loaded chats, live runs and context usage.
// Streaming AgentEvents are applied here so a run keeps going even when the
// user switches to another chat. OWNER: agent "ui-chat".

import type { AgentEvent, AgentStep, Chat, ChatMessage } from "../../lib/types";
import { blankMessage, isTempId } from "./utils";

export interface RunState {
  running: boolean;
  /** Id of the assistant message being streamed. */
  liveId: string | null;
  /** Optimistic user message, replaced by the saved one on `userMessage`. */
  tempUserId: string | null;
  status: string | null;
  /** stepId → approvalId for steps waiting on the user. */
  approvals: Record<string, string>;
  error: string | null;
  lastText: string;
  lastImages: string[];
}

export interface ContextUse {
  used: number;
  size: number;
}

export interface ChatState {
  chats: Record<string, Chat>;
  runs: Record<string, RunState>;
  context: Record<string, ContextUse>;
}

export type ChatAction =
  | { type: "setChat"; chat: Chat }
  | { type: "patchChat"; id: string; patch: Partial<Omit<Chat, "messages">> }
  | { type: "removeChat"; id: string }
  | { type: "removeMessage"; chatId: string; messageId: string }
  | { type: "startRun"; chatId: string; text: string; images: string[]; tempUser: ChatMessage }
  | { type: "event"; chatId: string; event: AgentEvent }
  | { type: "finishRun"; chatId: string; message?: ChatMessage; error?: string }
  | { type: "clearError"; chatId: string };

export const initialChatState: ChatState = { chats: {}, runs: {}, context: {} };

function idleRun(): RunState {
  return {
    running: false,
    liveId: null,
    tempUserId: null,
    status: null,
    approvals: {},
    error: null,
    lastText: "",
    lastImages: [],
  };
}

function upsertStep(steps: AgentStep[], step: AgentStep): AgentStep[] {
  const i = steps.findIndex((s) => s.id === step.id);
  if (i === -1) return [...steps, step];
  const next = steps.slice();
  next[i] = step;
  return next;
}

function withChat(state: ChatState, chatId: string, chat: Chat, run?: RunState): ChatState {
  return {
    ...state,
    chats: { ...state.chats, [chatId]: chat },
    runs: run ? { ...state.runs, [chatId]: run } : state.runs,
  };
}

/** Returns the chat with a live assistant message (created when missing) and its id. */
function ensureLive(chat: Chat, run: RunState): { chat: Chat; run: RunState; liveId: string } {
  if (run.liveId && chat.messages.some((m) => m.id === run.liveId)) {
    return { chat, run, liveId: run.liveId };
  }
  const live = blankMessage("assistant");
  return {
    chat: { ...chat, messages: [...chat.messages, live] },
    run: { ...run, liveId: live.id },
    liveId: live.id,
  };
}

function mapMessage(chat: Chat, id: string, fn: (m: ChatMessage) => ChatMessage): Chat {
  return { ...chat, messages: chat.messages.map((m) => (m.id === id ? fn(m) : m)) };
}

/** Puts the final assistant message in place of the live one. */
function finalize(chat: Chat, run: RunState, message: ChatMessage): { chat: Chat; run: RunState } {
  const targetId = run.liveId ?? message.id;
  let replaced = false;
  const messages = chat.messages.map((m) => {
    if (m.id === targetId || m.id === message.id) {
      if (replaced) return null;
      replaced = true;
      return message;
    }
    return m;
  });
  const clean = messages.filter((m): m is ChatMessage => m !== null);
  if (!replaced) clean.push(message);
  return {
    chat: { ...chat, messages: clean, updatedAt: Date.now() },
    run: { ...run, running: false, liveId: null, status: null, approvals: {} },
  };
}

/** Removes a live assistant message that never got any content. */
function dropEmptyLive(chat: Chat, run: RunState): Chat {
  if (!run.liveId) return chat;
  const live = chat.messages.find((m) => m.id === run.liveId);
  if (live && !live.text.trim() && live.steps.length === 0) {
    return { ...chat, messages: chat.messages.filter((m) => m.id !== run.liveId) };
  }
  return chat;
}

function applyEvent(state: ChatState, chatId: string, event: AgentEvent): ChatState {
  if (event.type === "context") {
    return { ...state, context: { ...state.context, [chatId]: { used: event.usedTokens, size: event.contextSize } } };
  }
  const chat = state.chats[chatId];
  const run = state.runs[chatId];
  // Late events after the run finished (or for an unknown chat) are ignored.
  if (!chat || !run?.running) return state;

  switch (event.type) {
    case "userMessage": {
      const saved = event.message;
      let messages = chat.messages;
      if (run.tempUserId && messages.some((m) => m.id === run.tempUserId)) {
        messages = messages.map((m) => (m.id === run.tempUserId ? saved : m));
      } else if (!messages.some((m) => m.id === saved.id)) {
        messages = [...messages, saved];
      }
      return withChat(state, chatId, { ...chat, messages }, { ...run, tempUserId: null });
    }
    case "assistantStart": {
      if (chat.messages.some((m) => m.id === event.messageId)) {
        return withChat(state, chatId, chat, { ...run, liveId: event.messageId });
      }
      // A placeholder made by an earlier step/delta takes the real id.
      if (run.liveId && chat.messages.some((m) => m.id === run.liveId)) {
        const renamed = mapMessage(chat, run.liveId, (m) => ({ ...m, id: event.messageId }));
        return withChat(state, chatId, renamed, { ...run, liveId: event.messageId });
      }
      const live = blankMessage("assistant", { id: event.messageId });
      return withChat(state, chatId, { ...chat, messages: [...chat.messages, live] }, { ...run, liveId: event.messageId });
    }
    case "status":
      return withChat(state, chatId, chat, { ...run, status: event.text });
    case "step":
    case "approvalRequired": {
      const ensured = ensureLive(chat, run);
      const step = event.type === "approvalRequired" ? { ...event.step, status: "pendingApproval" as const } : event.step;
      const nextChat = mapMessage(ensured.chat, ensured.liveId, (m) => ({ ...m, steps: upsertStep(m.steps, step) }));
      const approvals = { ...ensured.run.approvals };
      if (event.type === "approvalRequired") approvals[step.id] = event.approvalId;
      else if (step.status !== "pendingApproval") delete approvals[step.id];
      return withChat(state, chatId, nextChat, { ...ensured.run, approvals });
    }
    case "delta": {
      const ensured = ensureLive(chat, run);
      const nextChat = mapMessage(ensured.chat, ensured.liveId, (m) => ({ ...m, text: m.text + event.text }));
      return withChat(state, chatId, nextChat, ensured.run);
    }
    case "done": {
      const done = finalize(chat, run, event.message);
      return withChat(state, chatId, done.chat, done.run);
    }
    case "error": {
      const nextChat = dropEmptyLive(chat, run);
      return withChat(state, chatId, nextChat, {
        ...run,
        running: false,
        liveId: null,
        status: null,
        approvals: {},
        error: event.message,
      });
    }
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "setChat":
      return { ...state, chats: { ...state.chats, [action.chat.id]: action.chat } };
    case "patchChat": {
      const chat = state.chats[action.id];
      if (!chat) return state;
      return { ...state, chats: { ...state.chats, [action.id]: { ...chat, ...action.patch } } };
    }
    case "removeChat": {
      const chats = { ...state.chats };
      const runs = { ...state.runs };
      const context = { ...state.context };
      delete chats[action.id];
      delete runs[action.id];
      delete context[action.id];
      return { chats, runs, context };
    }
    case "removeMessage": {
      const chat = state.chats[action.chatId];
      if (!chat) return state;
      return withChat(state, action.chatId, { ...chat, messages: chat.messages.filter((m) => m.id !== action.messageId) });
    }
    case "startRun": {
      const chat = state.chats[action.chatId];
      if (!chat) return state;
      const run: RunState = {
        ...idleRun(),
        running: true,
        tempUserId: action.tempUser.id,
        lastText: action.text,
        lastImages: action.images,
      };
      return withChat(state, action.chatId, { ...chat, messages: [...chat.messages, action.tempUser] }, run);
    }
    case "event":
      return applyEvent(state, action.chatId, action.event);
    case "finishRun": {
      const chat = state.chats[action.chatId];
      const run = state.runs[action.chatId];
      if (!chat || !run?.running) return state;
      if (action.message) {
        const done = finalize(chat, run, action.message);
        return withChat(state, action.chatId, done.chat, done.run);
      }
      return withChat(state, action.chatId, dropEmptyLive(chat, run), {
        ...run,
        running: false,
        liveId: null,
        status: null,
        approvals: {},
        error: action.error ?? "The model stopped without an answer.",
      });
    }
    case "clearError": {
      const run = state.runs[action.chatId];
      if (!run) return state;
      return { ...state, runs: { ...state.runs, [action.chatId]: { ...run, error: null } } };
    }
  }
}

/** True when the message is an optimistic user message the backend never saved. */
export const isUnsavedUser = (m: ChatMessage) => m.role === "user" && isTempId(m.id);
