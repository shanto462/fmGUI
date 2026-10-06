// Small text and number formatters shared by the pages.

/** "14:05" for today, "Mar 3" for other days. */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** "850 ms" or "1.2 s". Empty for null. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** "8,192". */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** "1 tool", "3 tools". */
export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** "1m 05s" style uptime. */
export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Rough token estimate: about 4 characters per token. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** "≈ 1,200 tokens". */
export const tokensLabel = (n: number) => `≈ ${formatNumber(n)} tokens`;

/** Any value as indented JSON. JSON text is parsed first; other text comes back as it is. */
export function prettyJson(value: unknown): string {
  if (value === undefined || value === null) return "{}";
  if (typeof value === "string") return tryPrettyJson(value) ?? value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Indented JSON for JSON object or array text, or null when `text` is not one. */
export function tryPrettyJson(text: string): string | null {
  const t = text.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

/** The parse error for JSON text, or null when it parses. */
export function jsonError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** One line of text, cut to `max` characters with "…". */
export function truncateText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// eslint-disable-next-line no-control-regex -- ANSI escape codes start with the ESC control character.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Removes terminal color codes. The backend strips them already; this is a cheap second guard. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Short stable hash (FNV-1a, 32 bit), for temp file names. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
