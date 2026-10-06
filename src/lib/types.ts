// CONTRACT FILE (owned by the lead). Mirrors the Rust serde types exactly.
// Rust: src-tauri/src/config.rs, fm/*, engine/mod.rs, mcp/mod.rs, skills/mod.rs.

// ---------- config.rs ----------
export type Approval = "ask" | "always";
export type ParamType = "string" | "integer" | "number" | "boolean";
export type SkillMode = "off" | "onDemand" | "always";

export interface KeyValue {
  key: string;
  value: string;
}

export interface ToolPrefs {
  enabled: boolean;
  approval: Approval;
}

export interface ToolParam {
  name: string;
  type: ParamType;
  description: string;
  required: boolean;
}

export type CustomToolKind =
  | { type: "shell"; command: string; cwd?: string | null; timeoutSecs: number }
  | {
      type: "http";
      method: string;
      url: string;
      headers: KeyValue[];
      body?: string | null;
      timeoutSecs: number;
    }
  | { type: "shortcut"; shortcutName: string; timeoutSecs: number };

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  params: ToolParam[];
  kind: CustomToolKind;
  enabled: boolean;
  approval: Approval;
}

export type McpTransport =
  | { type: "stdio"; command: string; args: string[]; env: KeyValue[]; cwd?: string | null }
  | { type: "http"; url: string; headers: KeyValue[] };

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  disabledTools: string[];
  approval: Approval;
}

export interface SkillPrefs {
  mode: SkillMode;
}

export interface ChatDefaults {
  instructions: string;
  maxToolSteps: number;
  toolsEnabled: boolean;
  temperature?: number | null;
}

export interface PublicServerConfig {
  mode: "tcp" | "socket";
  host: string;
  port: number;
  socketPath: string;
  autostart: boolean;
}

export interface AppConfig {
  fmPath: string;
  setupCompleted: boolean;
  contextSize: number;
  chatDefaults: ChatDefaults;
  builtinTools: Record<string, ToolPrefs>;
  customTools: CustomTool[];
  mcpServers: McpServerConfig[];
  skills: Record<string, SkillPrefs>;
  allowedFolders: string[];
  publicServer: PublicServerConfig;
}

export interface PathsInfo {
  dataDir: string;
  configFile: string;
  chatsDir: string;
  skillsDir: string;
  tmpDir: string;
  engineSocket: string;
  cliSessionsDir: string;
  homeDir: string;
}

// ---------- fm/* ----------
export type RunEvent =
  | { kind: "started"; command: string }
  | { kind: "stdout"; text: string }
  | { kind: "stderr"; text: string };

export interface RunResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  error: string | null;
  durationMs: number;
  firstOutputMs: number | null;
  cancelled: boolean;
}

export interface FmStatus {
  binaryPath: string;
  binaryFound: boolean;
  macosVersion: string;
  macosBuild: string;
  modelAvailable: boolean;
  availabilityMessage: string;
  licenseAgreed: boolean;
  licenseMessage: string;
  contextSize: number;
}

export interface TranscriptMessage {
  id: string;
  role: string; // "user" | "response" | other
  text: string;
  images: string[]; // data URLs
}

export interface ParsedTranscript {
  modelName: string | null;
  instructions: string | null;
  messages: TranscriptMessage[];
  systemVersion: string | null;
}

export interface CliSession {
  name: string;
  path: string;
  modifiedMs: number;
  sizeBytes: number;
  preview: string;
  turns: number;
}

export interface LogLine {
  ts: number;
  line: string;
}

export interface PublicServerStatus {
  running: boolean;
  pid: number | null;
  url: string | null;
  socketPath: string | null;
  startedAt: number | null;
  command: string | null;
  lastError: string | null;
  logs: LogLine[];
}

export interface HttpResult {
  status: number;
  body: string;
  durationMs: number;
}

// ---------- engine/mod.rs ----------
export type StepStatus = "pendingApproval" | "running" | "done" | "error" | "denied";
export type ToolSource = "builtin" | "custom" | "mcp" | "skill";

export interface AgentStep {
  id: string;
  toolId: string;
  toolName: string;
  title: string;
  source: ToolSource;
  arguments: unknown;
  status: StepStatus;
  result: string | null;
  error: string | null;
  durationMs: number | null;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  images: string[];
  steps: AgentStep[];
  skillsUsed: string[];
  createdAt: number;
  usage: Usage | null;
  durationMs: number | null;
  error: string | null;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  instructions: string;
  messages: ChatMessage[];
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  preview: string;
}

export type AgentEvent =
  | { type: "userMessage"; message: ChatMessage }
  | { type: "assistantStart"; messageId: string }
  | { type: "status"; text: string }
  | { type: "step"; step: AgentStep }
  | { type: "approvalRequired"; approvalId: string; step: AgentStep }
  | { type: "delta"; text: string }
  | { type: "context"; usedTokens: number; contextSize: number }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; message: string };

export interface ToolInfo {
  id: string;
  name: string;
  title: string;
  description: string;
  source: ToolSource;
  sourceLabel: string;
  enabled: boolean;
  approval: Approval;
  inputSchema: unknown;
  tokenEstimate: number;
  dangerous: boolean;
}

export interface ToolTestResult {
  ok: boolean;
  output: string;
  durationMs: number;
}

export interface EngineStatus {
  running: boolean;
  socketPath: string;
  pid: number | null;
  lastError: string | null;
}

export type ApprovalDecision = "allow" | "always" | "deny";

// ---------- mcp/mod.rs ----------
export interface McpToolSummary {
  name: string;
  description: string;
  inputSchema: unknown;
  enabled: boolean;
}

export type McpState = "disconnected" | "connecting" | "connected" | "error";

export interface McpServerStatus {
  id: string;
  name: string;
  state: McpState;
  error: string | null;
  serverName: string | null;
  serverVersion: string | null;
  tools: McpToolSummary[];
  stderrTail: string[];
}

export interface McpTestResult {
  ok: boolean;
  error: string | null;
  serverName: string | null;
  serverVersion: string | null;
  tools: McpToolSummary[];
  stderrTail: string[];
  durationMs: number;
}

// ---------- skills/mod.rs ----------
export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
  files: string[];
  tokenEstimate: number;
}

export interface SkillInput {
  originalName?: string | null;
  name: string;
  description: string;
  body: string;
}

export interface SkillCandidate {
  name: string;
  description: string;
  path: string;
  source: string;
  tokenEstimate: number;
  alreadyImported: boolean;
}
