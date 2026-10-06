import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../lib/types";
import { blankMessage } from "../views/chat/utils";
import { pillText, plainLine, type PillState } from "./pill";

const user = (text: string): ChatMessage => blankMessage("user", { text });
const answer = (text: string, patch: Partial<ChatMessage> = {}): ChatMessage =>
  blankMessage("assistant", { text, ...patch });

function state(patch: Partial<PillState> = {}): PillState {
  return { messages: [], running: false, approvalPending: false, error: null, ...patch };
}

describe("pill text", () => {
  it("invites a question when the chat is empty", () => {
    expect(pillText(state())).toEqual({ text: "Ask anything", tone: "muted" });
  });

  it("says Thinking while a turn runs, even when text streams in", () => {
    const messages = [user("Hi"), answer("Hello th")];
    expect(pillText(state({ messages, running: true }))).toEqual({ text: "Thinking…", tone: "busy" });
  });

  it("asks for approval before anything else", () => {
    expect(pillText(state({ running: true, approvalPending: true }))).toEqual({
      text: "Needs your approval",
      tone: "warn",
    });
  });

  it("shows the start of the last answer as plain text", () => {
    const messages = [
      user("First"),
      answer("An older answer."),
      user("Second"),
      answer("## Plan\n\n1. **Pack** the [bag](https://example.com)\n2. Leave at `9:00`"),
    ];
    expect(pillText(state({ messages }))).toEqual({ text: "Plan Pack the bag Leave at 9:00", tone: "plain" });
  });

  it("shows the error of a failed turn", () => {
    const messages = [user("Hi"), answer("Old answer."), user("Again")];
    expect(pillText(state({ messages, error: "The model is not ready." }))).toEqual({
      text: "The model is not ready.",
      tone: "error",
    });
    const failed = [user("Hi"), answer("", { error: "Stopped." })];
    expect(pillText(state({ messages: failed }))).toEqual({ text: "Stopped.", tone: "error" });
  });

  it("keeps the text of an answer that was stopped part way", () => {
    const messages = [user("Hi"), answer("Half an answer", { error: "Stopped." })];
    expect(pillText(state({ messages }))).toEqual({ text: "Half an answer", tone: "plain" });
  });
});

describe("plain line", () => {
  it("cuts long text with an ellipsis", () => {
    const line = plainLine("word ".repeat(100), 40);
    expect(line).toHaveLength(40);
    expect(line.endsWith("…")).toBe(true);
  });

  it("drops code blocks but falls back to the code when there is nothing else", () => {
    expect(plainLine("Run this:\n```sh\nls -la\n```\nDone.")).toBe("Run this: Done.");
    expect(plainLine("```js\nconsole.log(1)\n```")).toBe("console.log(1)");
    // A block that is still open while it streams.
    expect(plainLine("Try:\n```py\nprint(")).toBe("Try:");
  });

  it("removes quote, list and table marks", () => {
    expect(plainLine("> Quoted\n- one\n* two\n| a | b |")).toBe("Quoted one two a b");
  });
});
