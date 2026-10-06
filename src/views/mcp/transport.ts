import { shellQuote } from "../../lib/fmArgs";
import type { McpToolSummary, McpTransport } from "../../lib/types";
import { toolTokenEstimate } from "../tools/helpers";

/** Tokens one MCP tool adds to every request. */
export const mcpToolTokens = (t: McpToolSummary) => toolTokenEstimate(t.inputSchema, t.description);

/** The URL of a remote server, or the command line of a local one. */
export function transportLine(t: McpTransport): string {
  return t.type === "http" ? t.url : [t.command, ...t.args].map(shellQuote).join(" ");
}
