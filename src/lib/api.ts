// Typed wrappers for every Tauri command.
// Command names and argument keys must match src-tauri/src/lib.rs.
// Tauri converts camelCase argument keys to the Rust snake_case parameters.

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentEvent,
  AppConfig,
  ApprovalDecision,
  Chat,
  ChatMessage,
  ChatSummary,
  CliSession,
  CustomTool,
  EngineStatus,
  FmStatus,
  HttpResult,
  LogLine,
  McpServerConfig,
  McpServerStatus,
  McpTestResult,
  ParsedTranscript,
  PathsInfo,
  PublicServerConfig,
  PublicServerStatus,
  RunEvent,
  RunResult,
  Skill,
  SkillCandidate,
  SkillInput,
  ToolInfo,
  ToolTestResult,
} from "./types";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Turns any thrown value (Rust returns plain strings) into a message. */
export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export const newId = () => crypto.randomUUID();

// ---------- app ----------
export const getConfig = () => invoke<AppConfig>("get_config");
export const saveConfig = (config: AppConfig) => invoke<AppConfig>("save_config", { config });
export const getPaths = () => invoke<PathsInfo>("get_paths");
export const readTextFile = (path: string) => invoke<string>("read_text_file", { path });
export const writeTextFile = (path: string, content: string) => invoke<void>("write_text_file", { path, content });
/** data: base64 or a data URL. Returns the absolute path. */
export const saveTempFile = (fileName: string, data: string) => invoke<string>("save_temp_file", { fileName, data });
export const saveTempText = (fileName: string, content: string) =>
  invoke<string>("save_temp_text", { fileName, content });
export const readImageDataUrl = (path: string) => invoke<string>("read_image_data_url", { path });

// ---------- fm CLI ----------
/** Runs `fm <args>`. Call `fmCancel(runId)` to stop it. */
export function fmRun(args: string[], onEvent: (e: RunEvent) => void, runId: string = newId()) {
  const channel = new Channel<RunEvent>();
  channel.onmessage = onEvent;
  return invoke<RunResult>("fm_run", { args, runId, onEvent: channel });
}
export const fmCancel = (runId: string) => invoke<boolean>("fm_cancel", { runId });
export const fmStatus = () => invoke<FmStatus>("fm_status");
export const fmLicenseText = () => invoke<string>("fm_license_text");
export const openInTerminal = (command: string) => invoke<void>("open_in_terminal", { command });

export const cliSessionsList = () => invoke<CliSession[]>("cli_sessions_list");
export const cliSessionRead = (name: string) => invoke<ParsedTranscript>("cli_session_read", { name });
export const cliSessionDelete = (name: string) => invoke<void>("cli_session_delete", { name });
export const cliSessionRename = (from: string, to: string) => invoke<void>("cli_session_rename", { from, to });
export const cliSessionNewPath = (base: string) => invoke<string>("cli_session_new_path", { base });
export const transcriptRead = (path: string) => invoke<ParsedTranscript>("transcript_read", { path });

export const publicServerStart = (config: PublicServerConfig) =>
  invoke<PublicServerStatus>("public_server_start", { config });
export const publicServerStop = () => invoke<PublicServerStatus>("public_server_stop");
export const publicServerStatus = () => invoke<PublicServerStatus>("public_server_status");
export const publicServerRequest = (method: string, path: string, body?: string) =>
  invoke<HttpResult>("public_server_request", { method, path, body: body ?? null });
export const onPublicServerLog = (cb: (line: LogLine) => void): Promise<UnlistenFn> =>
  listen<LogLine>("public-server-log", (e) => cb(e.payload));
export const onPublicServerState = (cb: (s: PublicServerStatus) => void): Promise<UnlistenFn> =>
  listen<PublicServerStatus>("public-server-state", (e) => cb(e.payload));

// ---------- agent engine ----------
export const engineStatus = () => invoke<EngineStatus>("engine_status");
export const engineRestart = () => invoke<EngineStatus>("engine_restart");
export const chatsList = () => invoke<ChatSummary[]>("chats_list");
export const chatGet = (id: string) => invoke<Chat>("chat_get", { id });
export const chatCreate = (instructions?: string) =>
  invoke<Chat>("chat_create", { instructions: instructions ?? null });
export const chatDelete = (id: string) => invoke<void>("chat_delete", { id });
export const chatRename = (id: string, title: string) => invoke<Chat>("chat_rename", { id, title });
export const chatSetInstructions = (id: string, instructions: string) =>
  invoke<Chat>("chat_set_instructions", { id, instructions });
export function chatSend(chatId: string, text: string, images: string[], onEvent: (e: AgentEvent) => void) {
  const channel = new Channel<AgentEvent>();
  channel.onmessage = onEvent;
  return invoke<ChatMessage>("chat_send", { chatId, text, images, onEvent: channel });
}
export const chatCancel = (chatId: string) => invoke<void>("chat_cancel", { chatId });
export const approvalRespond = (approvalId: string, decision: ApprovalDecision) =>
  invoke<void>("approval_respond", { approvalId, decision });
export const toolsCatalog = () => invoke<ToolInfo[]>("tools_catalog");
export const toolTest = (toolId: string, args: unknown) =>
  invoke<ToolTestResult>("tool_test", { toolId, arguments: args });
export const customToolTest = (tool: CustomTool, args: unknown) =>
  invoke<ToolTestResult>("custom_tool_test", { tool, arguments: args });
export const shortcutsList = () => invoke<string[]>("shortcuts_list");

// ---------- MCP ----------
export const mcpStatuses = () => invoke<McpServerStatus[]>("mcp_statuses");
export const mcpConnect = (id: string) => invoke<McpServerStatus[]>("mcp_connect", { id });
export const mcpDisconnect = (id: string) => invoke<McpServerStatus[]>("mcp_disconnect", { id });
export const mcpTest = (config: McpServerConfig) => invoke<McpTestResult>("mcp_test", { config });
export const onMcpStatus = (cb: (s: McpServerStatus[]) => void): Promise<UnlistenFn> =>
  listen<McpServerStatus[]>("mcp-status", (e) => cb(e.payload));

// ---------- skills ----------
export const skillsList = () => invoke<Skill[]>("skills_list");
export const skillSave = (input: SkillInput) => invoke<Skill>("skill_save", { input });
export const skillDelete = (name: string) => invoke<void>("skill_delete", { name });
export const skillsImportCandidates = () => invoke<SkillCandidate[]>("skills_import_candidates");
export const skillImport = (path: string) => invoke<Skill>("skill_import", { path });
export const skillTokenCount = (name: string) => invoke<number>("skill_token_count", { name });

/** Absolute path of a program on the login-shell PATH, or null. */
export const whichCommand = (name: string) => invoke<string | null>("which_command", { name });
