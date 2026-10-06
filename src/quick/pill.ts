// The one line of text in the Quick Chat pill. Pure functions, so they are easy to test.

import type { ChatMessage } from "../lib/types";

/** plain: an answer. muted: nothing yet. busy: a turn runs. warn: waits for the user. error: the turn failed. */
export type PillTone = "plain" | "muted" | "busy" | "warn" | "error";

export interface PillText {
  text: string;
  tone: PillTone;
}

export interface PillState {
  messages: ChatMessage[];
  running: boolean;
  /** True while a tool call waits for Allow or Deny. */
  approvalPending: boolean;
  /** Error of the last turn when it is not on a saved message. */
  error?: string | null;
}

/** The pill cuts the text to one line with CSS; this only keeps it short. */
const MAX_CHARS = 120;

/** Markdown as one line of plain text, cut to `max` characters with "…". */
export function plainLine(markdown: string, max = MAX_CHARS): string {
  const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
  let line = collapse(
    markdown
      .replace(/```[\s\S]*?(```|$)/g, " ") // code blocks, also one that is still open
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images: their alt text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links: their text
      .replace(/^[ \t]*(#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, "") // headings, quotes, list markers
      .replace(/\*\*|__|~~|`|\*/g, "")
      .replace(/\|/g, " "),
  );
  // An answer that is only code: show the code itself.
  if (!line) line = collapse(markdown.replace(/```[\w-]*/g, " "));
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * What the pill says: "Needs your approval" while a tool call waits, "Thinking…"
 * while a turn runs, the error of a failed turn, else the start of the last
 * answer, else "Ask anything".
 */
export function pillText(state: PillState): PillText {
  if (state.approvalPending) return { text: "Needs your approval", tone: "warn" };
  if (state.running) return { text: "Thinking…", tone: "busy" };
  if (state.error) return { text: plainLine(state.error), tone: "error" };
  const last = [...state.messages].reverse().find((m) => m.role === "assistant");
  if (last) {
    const text = plainLine(last.text);
    if (text) return { text, tone: "plain" };
    if (last.error) return { text: plainLine(last.error), tone: "error" };
  }
  return { text: "Ask anything", tone: "muted" };
}
