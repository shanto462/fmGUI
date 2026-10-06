// Browser "mock mode": a fake Tauri backend so the UI runs in a normal browser
// with realistic data. Open http://localhost:1420/?mock=1 after `npm run dev`.
// Scenarios: ?mock=1 (ready), ?mock=nolicense (opens on the License step),
// ?mock=nofm, ?mock=setup (fresh install: every check passes, so setup completes on its own).
// Add &window=quick to run the Quick Chat window instead of the main window.
// Nothing here runs in the real app.
// How it works: `mockIPC` from @tauri-apps/api/mocks installs a fake
// `window.__TAURI_INTERNALS__` (so `isTauri()` is true) and sends every
// `invoke()` to `MockBackend.handle`. Channels (`fm_run`, `chat_send`) arrive as
// the real `Channel` object; we deliver messages through its callback id with
// `__TAURI_INTERNALS__.runCallback(id, { index, message })`, exactly like Rust,
// so ordering and cleanup behave the same. Events (`listen`) are handled here too.

import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { displayCommand, serveArgs } from "./fmArgs";
import * as D from "./mockData";
import type {
  AgentEvent,
  AgentStep,
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
  McpToolSummary,
  ParsedTranscript,
  PublicServerConfig,
  PublicServerStatus,
  QuickMode,
  RunEvent,
  RunResult,
  Skill,
  SkillInput,
  ToolInfo,
  ToolTestResult,
} from "./types";

export type MockScenario = "default" | "nolicense" | "nofm" | "setup";
/** Label of the window this page pretends to be. */
export type MockWindow = "main" | "quick";

export interface MockOptions {
  /** Defaults to the `?mock=` URL value. */
  scenario?: MockScenario;
  /** Defaults to the `?window=` URL value ("quick" or "main"). */
  window?: MockWindow;
  /** Multiplies every fake delay. 0 makes everything instant (tests). */
  timeScale?: number;
}

interface TauriInternals {
  invoke?: unknown;
  callbacks?: Map<number, (data: unknown) => void>;
  runCallback?: (id: number, data: unknown) => void;
  convertFileSrc?: (path: string, protocol?: string) => string;
  fmguiMock?: boolean;
}

function internals(): TauriInternals | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
}

/** Rust returns errors as plain strings; invoke() rejects with them. */
function fail(message: string): never {
  throw message;
}

/** Mimics IPC serialization so the UI never shares objects with the backend. */
function wire<T>(value: T): T {
  return value === undefined ? (null as T) : (JSON.parse(JSON.stringify(value)) as T);
}

// ---------- channels ----------

/**
 * Sends messages to a `Channel` passed as an invoke argument. Uses the
 * channel's callback id (like Rust does) and falls back to `onmessage`.
 */
function channelSender<T>(channel: unknown) {
  const ch = channel as { id?: number; onmessage?: (m: T) => void } | undefined;
  let index = 0;
  const target = () => {
    const i = internals();
    return typeof ch?.id === "number" && i?.runCallback && i.callbacks?.has(ch.id) ? i : null;
  };
  return {
    send(message: T) {
      const copy = wire(message);
      const i = target();
      if (i) i.runCallback!(ch!.id!, { index: index++, message: copy });
      else ch?.onmessage?.(copy);
    },
    end() {
      const i = target();
      if (i) i.runCallback!(ch!.id!, { index, end: true });
    },
  };
}

// ---------- generated image ----------

let pngCache: string | null = null;

/** A small generated PNG data URL (canvas in the browser, 1x1 PNG elsewhere). */
function samplePng(): string {
  if (pngCache) return pngCache;
  try {
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = 240;
      c.height = 160;
      const ctx = c.getContext("2d");
      if (ctx) {
        const g = ctx.createLinearGradient(0, 0, 240, 160);
        g.addColorStop(0, "#5ac8fa");
        g.addColorStop(1, "#af52de");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 240, 160);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        for (const [x, y, r] of [
          [60, 50, 30],
          [170, 70, 44],
          [110, 120, 22],
        ]) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 16px -apple-system, system-ui, sans-serif";
        ctx.fillText("Sample image", 16, 148);
        pngCache = c.toDataURL("image/png");
        return pngCache;
      }
    }
  } catch {
    /* fall back below */
  }
  pngCache = D.TINY_PNG;
  return pngCache;
}

// ---------- helpers ----------

const humanize = (name: string) => {
  const s = name.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const toolSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function titleFrom(text: string): string {
  const words = text
    .replace(/https?:\/\/\S+/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
  const t = words.replace(/[?.!,:;]+$/, "");
  return t ? (t.length > 40 ? `${t.slice(0, 39)}…` : t) : "New chat";
}

const nowText = () => new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "long" }).replace(",", "");

interface DialogFilter {
  name: string;
  extensions: string[];
}

interface DialogOptions {
  directory?: boolean;
  multiple?: boolean;
  filters?: DialogFilter[];
  defaultPath?: string;
}

/** Every argument key used by api.ts (and the plugins). */
interface Args {
  config?: unknown;
  path?: string;
  content?: string;
  fileName?: string;
  data?: string;
  name?: string;
  args?: string[];
  runId?: string;
  onEvent?: unknown;
  from?: string;
  to?: string;
  base?: string;
  method?: string;
  body?: string | null;
  id?: string;
  title?: string;
  instructions?: string | null;
  chatId?: string;
  text?: string;
  images?: string[];
  approvalId?: string;
  decision?: ApprovalDecision;
  toolId?: string;
  arguments?: unknown;
  tool?: CustomTool;
  input?: SkillInput;
  command?: string;
  options?: DialogOptions;
  url?: string;
  event?: string;
  handler?: number;
  eventId?: number;
  payload?: unknown;
  message?: string;
  buttons?: unknown;
  mode?: string;
  hold?: boolean;
}

interface McpRuntime {
  state: McpServerStatus["state"];
  error: string | null;
  serverName: string | null;
  serverVersion: string | null;
  tools: McpToolSummary[];
  stderrTail: string[];
}

interface PendingApproval {
  chatId: string;
  resolve: (d: ApprovalDecision) => void;
}

// ---------- the fake backend ----------

export class MockBackend {
  readonly scenario: MockScenario;
  private timeScale: number;
  config: AppConfig;
  private binaryFound: boolean;
  private licenseAgreed: boolean;
  private sessions: D.MockSession[];
  private transcripts = new Map<string, ParsedTranscript>();
  private chats = new Map<string, Chat>();
  private skills = new Map<string, Skill>();
  private candidates = D.seedCandidates();
  private files = new Map<string, string>(Object.entries(D.seedFiles()));
  private images = new Map<string, string>();
  private mcp = new Map<string, McpRuntime>();
  private runs = new Map<string, { cancelled: boolean }>();
  private chatRuns = new Map<string, { cancelled: boolean }>();
  private approvals = new Map<string, PendingApproval>();
  private listeners = new Map<string, Set<number>>();
  private server: PublicServerStatus = {
    running: false,
    pid: null,
    url: null,
    socketPath: null,
    startedAt: null,
    command: null,
    lastError: null,
    logs: [],
  };
  private serverTimer: ReturnType<typeof setInterval> | null = null;
  private serverTick = 0;
  private enginePid = 48107;
  /** Quick Chat window state, like QuickState in quick.rs. */
  private quick: { mode: QuickMode; hold: boolean };

  constructor(scenario: MockScenario = "default", timeScale = 1, windowLabel: MockWindow = "main") {
    this.scenario = scenario;
    this.timeScale = timeScale;
    // The real window starts hidden; a Quick Chat preview starts as if the menu bar icon was clicked.
    this.quick = { mode: windowLabel === "quick" ? "overlay" : "hidden", hold: false };
    const now = Date.now();
    this.config = D.seedConfig(scenario === "default");
    this.binaryFound = scenario !== "nofm";
    this.licenseAgreed = scenario === "default" || scenario === "setup";
    this.sessions = D.seedSessions(now);
    for (const chat of D.seedChats(now)) this.chats.set(chat.id, chat);
    for (const skill of D.seedSkills(D.PATHS.skillsDir)) this.skills.set(skill.name, skill);
    this.mcp.set("filesystem", this.connectedRuntime("filesystem"));
    this.mcp.set("remote", {
      state: "error",
      error: "Could not connect: the server answered 401 Unauthorized. Check the Authorization header.",
      serverName: null,
      serverVersion: null,
      tools: [],
      stderrTail: [
        "POST https://mcp.example.com/mcp (initialize)",
        "HTTP 401 Unauthorized",
        '{"error":"invalid_token","error_description":"The access token is missing or expired."}',
      ],
    });
  }

  /** Stops timers (public server log). */
  dispose() {
    if (this.serverTimer) clearInterval(this.serverTimer);
    this.serverTimer = null;
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, Math.round(ms * this.timeScale)));
  }

  // ---------- events ----------

  emit(event: string, payload: unknown) {
    const i = internals();
    if (!i?.runCallback) return;
    for (const id of this.listeners.get(event) ?? []) {
      if (i.callbacks?.has(id)) i.runCallback(id, { event, id, payload: wire(payload) });
    }
  }

  private eventCommand(cmd: string, a: Args): unknown {
    switch (cmd) {
      case "plugin:event|listen": {
        const set = this.listeners.get(a.event ?? "") ?? new Set<number>();
        set.add(a.handler ?? -1);
        this.listeners.set(a.event ?? "", set);
        return a.handler;
      }
      case "plugin:event|unlisten":
        this.listeners.get(a.event ?? "")?.delete(a.eventId ?? -1);
        return null;
      case "plugin:event|emit":
      case "plugin:event|emit_to":
        this.emit(a.event ?? "", a.payload);
        return null;
      default:
        return null;
    }
  }

  // ---------- Quick Chat (quick.rs) ----------

  /** The current Quick Chat mode. */
  get quickMode(): QuickMode {
    return this.quick.mode;
  }

  private setQuickMode(mode: QuickMode) {
    this.quick.mode = mode;
    this.emit("quick-mode", mode);
  }

  /** A click outside the window: the overlay shrinks to the pill unless a file panel holds it. */
  quickBlur() {
    if (this.quick.mode === "overlay" && !this.quick.hold) this.setQuickMode("pip");
  }

  /** A click on the menu bar icon: open the overlay, or put it away when it is open. */
  quickToggle() {
    this.setQuickMode(this.quick.mode === "overlay" ? "pip" : "overlay");
  }

  private quickCommand(cmd: string, a: Args): unknown {
    switch (cmd) {
      case "quick_set_mode": {
        const mode = D.parseQuickMode(a.mode ?? "");
        if (typeof mode !== "string") fail(mode.error);
        this.setQuickMode(mode);
        return null;
      }
      case "quick_mode":
        return this.quick.mode;
      case "quick_close":
        this.setQuickMode("hidden");
        this.emit("quick-reset", null);
        return null;
      case "quick_hold":
        this.quick.hold = !!a.hold;
        return null;
      case "open_main_window":
        console.info(`[mock] The main window would open${a.chatId ? ` on chat ${a.chatId}` : ""}.`);
        if (a.chatId) this.emit("open-chat", a.chatId);
        return null;
      default:
        return null;
    }
  }

  // ---------- entry point ----------

  async handle(cmd: string, payload?: InvokeArgs): Promise<unknown> {
    const a = (payload ?? {}) as Args;
    if (cmd.startsWith("plugin:event|")) return this.eventCommand(cmd, a);
    if (cmd.startsWith("plugin:")) return this.pluginCommand(cmd, a);
    return wire(await this.command(cmd, a));
  }

  private async command(cmd: string, a: Args): Promise<unknown> {
    switch (cmd) {
      // ----- Quick Chat -----
      case "quick_set_mode":
      case "quick_mode":
      case "quick_close":
      case "quick_hold":
      case "open_main_window":
        return this.quickCommand(cmd, a);

      // ----- app -----
      case "get_config":
        await this.sleep(20);
        return this.config;
      case "save_config":
        await this.sleep(40);
        this.config = wire(a.config as AppConfig);
        return this.config;
      case "get_paths":
        return D.PATHS;
      case "read_text_file":
        await this.sleep(30);
        return this.readText(a.path ?? "");
      case "write_text_file":
        await this.sleep(30);
        this.files.set(a.path ?? "", a.content ?? "");
        return null;
      case "save_temp_file":
        return this.saveTempFile(a.fileName ?? "file", a.data ?? "");
      case "save_temp_text": {
        const path = `${D.PATHS.tmpDir}/${a.fileName ?? "text.txt"}`;
        this.files.set(path, a.content ?? "");
        return path;
      }
      case "read_image_data_url":
        await this.sleep(60);
        return this.images.get(a.path ?? "") || samplePng();
      case "which_command":
        return this.which(a.name ?? "");

      // ----- fm CLI -----
      case "fm_run":
        return this.fmRun(a.args ?? [], a.runId ?? D.uid(), a.onEvent);
      case "fm_cancel": {
        const run = this.runs.get(a.runId ?? "");
        if (run) run.cancelled = true;
        return !!run;
      }
      case "fm_status":
        await this.sleep(300);
        return this.fmStatus();
      case "fm_license_text":
        await this.sleep(150);
        if (!this.binaryFound) fail(`Could not start ${this.config.fmPath}: no such file.`);
        return D.LICENSE_TEXT;
      case "open_in_terminal":
        await this.sleep(200);
        if (/license/.test(a.command ?? "") && !this.licenseAgreed) {
          // Pretend the user agreed in Terminal a moment later.
          setTimeout(() => (this.licenseAgreed = true), 2500 * this.timeScale);
        }
        console.info(`[mock] Terminal would run: ${a.command}`);
        return null;
      case "cli_sessions_list":
        await this.sleep(80);
        return this.sessionList();
      case "cli_session_read":
        await this.sleep(60);
        return this.session(a.name ?? "").transcript;
      case "cli_session_delete":
        this.session(a.name ?? "");
        this.sessions = this.sessions.filter((s) => s.name !== a.name);
        return null;
      case "cli_session_rename":
        return this.renameSession(a.from ?? "", a.to ?? "");
      case "cli_session_new_path":
        return this.newSessionPath(a.base ?? "");
      case "transcript_read":
        await this.sleep(40);
        // Unknown files get a sample transcript so any picked file works.
        return (
          this.transcriptAt(a.path ?? "") ?? this.sessions[0]?.transcript ?? fail("This file is not an fm transcript.")
        );
      case "public_server_start":
        return this.serverStart(a.config as PublicServerConfig);
      case "public_server_stop":
        return this.serverStop();
      case "public_server_status":
        return this.server;
      case "public_server_request":
        return this.serverRequest(a.method ?? "GET", a.path ?? "/", a.body ?? null);

      // ----- agent engine -----
      case "engine_status":
        return this.engineStatus();
      case "engine_restart":
        await this.sleep(800);
        this.enginePid += 3;
        return this.engineStatus();
      case "chats_list":
        await this.sleep(50);
        return this.chatList();
      case "chat_get":
        await this.sleep(40);
        return this.chat(a.id ?? "");
      case "chat_create":
        return this.chatCreate(a.instructions ?? null);
      case "chat_delete":
        this.chat(a.id ?? "");
        this.chats.delete(a.id ?? "");
        return null;
      case "chat_rename": {
        const chat = this.chat(a.id ?? "");
        const title = (a.title ?? "").trim();
        if (!title) fail("The title cannot be empty.");
        chat.title = title;
        chat.updatedAt = Date.now();
        return chat;
      }
      case "chat_set_instructions": {
        const chat = this.chat(a.id ?? "");
        chat.instructions = a.instructions ?? "";
        chat.updatedAt = Date.now();
        return chat;
      }
      case "chat_send":
        return this.chatSend(a.chatId ?? "", a.text ?? "", a.images ?? [], a.onEvent);
      case "chat_cancel":
        this.cancelChat(a.chatId ?? "");
        return null;
      case "approval_respond":
        return this.approvalRespond(a.approvalId ?? "", a.decision ?? "deny");
      case "tools_catalog":
        await this.sleep(120);
        return this.catalog();
      case "tool_test":
        return this.toolTest(a.toolId ?? "", a.arguments);
      case "custom_tool_test":
        return this.customToolTest(a.tool as CustomTool, a.arguments);
      case "shortcuts_list":
        await this.sleep(250);
        return D.SHORTCUTS;

      // ----- MCP -----
      case "mcp_statuses":
        await this.sleep(60);
        return this.mcpStatuses();
      case "mcp_connect":
        return this.mcpConnect(a.id ?? "");
      case "mcp_disconnect":
        return this.mcpDisconnect(a.id ?? "");
      case "mcp_test":
        return this.mcpTest(a.config as McpServerConfig);

      // ----- skills -----
      case "skills_list":
        await this.sleep(60);
        return this.skillList();
      case "skill_save":
        return this.skillSave(a.input as SkillInput);
      case "skill_delete":
        if (!this.skills.delete(a.name ?? "")) fail(`No skill named ${a.name}.`);
        return null;
      case "skills_import_candidates":
        await this.sleep(150);
        return this.candidates.map(({ body: _body, ...c }) => ({ ...c, alreadyImported: this.skills.has(c.name) }));
      case "skill_import":
        return this.skillImport(a.path ?? "");
      case "skill_token_count": {
        await this.sleep(300);
        const skill = this.skills.get(a.name ?? "") ?? fail(`No skill named ${a.name}.`);
        return Math.ceil(skill.body.length / 3.7) + 2;
      }

      default:
        console.warn(`[mock] Unknown command "${cmd}"`, a);
        return null;
    }
  }

  // ---------- plugins (dialog, opener, window, app) ----------

  private pluginCommand(cmd: string, a: Args): unknown {
    switch (cmd) {
      case "plugin:dialog|open":
        return this.dialogOpen(a.options);
      case "plugin:dialog|save": {
        const base = (a.options?.defaultPath ?? "").split("/").pop() || "export.json";
        return `${D.HOME}/Downloads/${base}`;
      }
      case "plugin:dialog|message":
        return this.dialogMessage(a.message ?? "", a.buttons);
      case "plugin:dialog|ask":
      case "plugin:dialog|confirm":
        return true;
      case "plugin:opener|open_url":
        if (typeof window !== "undefined" && typeof window.open === "function" && a.url) {
          window.open(a.url, "_blank", "noopener");
        }
        return null;
      case "plugin:opener|open_path":
      case "plugin:opener|reveal_item_in_dir":
        console.info(`[mock] ${cmd}`, a);
        return null;
      case "plugin:app|version":
        return "0.1.0";
      case "plugin:app|name":
        return "fmGUI";
      case "plugin:app|tauri_version":
        return "2.9.0";
      default:
        if (/^plugin:(window|webview|app)\|/.test(cmd)) return null;
        console.warn(`[mock] Unknown plugin command "${cmd}"`, a);
        return null;
    }
  }

  private dialogOpen(o: DialogOptions | undefined): string | string[] | null {
    const exts = (o?.filters ?? []).flatMap((f) => f.extensions.map((e) => e.toLowerCase()));
    const names = (o?.filters ?? []).map((f) => f.name.toLowerCase()).join(" ");
    let path: string;
    if (o?.directory) path = `${D.HOME}/Documents/Projects`;
    else if (exts.some((e) => ["png", "jpg", "jpeg", "heic", "gif", "webp", "tiff"].includes(e)))
      path = `${D.HOME}/Pictures/sample-photo.png`;
    else if (/transcript|session/.test(names)) path = D.sessionPath("hello-friend");
    else if (exts.includes("json")) path = `${D.HOME}/Documents/person-schema.json`;
    else if (exts.includes("md")) path = `${D.HOME}/Downloads/standup-notes/SKILL.md`;
    else path = `${D.HOME}/Documents/notes.txt`;
    return o?.multiple ? [path] : path;
  }

  private dialogMessage(message: string, buttons: unknown): string {
    let ok = "Ok";
    let cancel: string | null = null;
    if (buttons === "YesNo") [ok, cancel] = ["Yes", "No"];
    else if (buttons === "OkCancel") [ok, cancel] = ["Ok", "Cancel"];
    else if (buttons && typeof buttons === "object") {
      const b = buttons as Record<string, unknown>;
      if (Array.isArray(b.OkCancelCustom)) [ok, cancel] = b.OkCancelCustom as [string, string];
      else if (Array.isArray(b.YesNoCancelCustom)) {
        const [y, , c] = b.YesNoCancelCustom as [string, string, string];
        [ok, cancel] = [y, c];
      } else if (typeof b.OkCustom === "string") ok = b.OkCustom;
    }
    if (typeof window === "undefined") return ok;
    if (cancel === null) {
      if (typeof window.alert === "function") window.alert(message);
      return ok;
    }
    return typeof window.confirm === "function" && !window.confirm(message) ? cancel : ok;
  }

  // ---------- app ----------

  private readTextMaybe(path: string): string | undefined {
    if (this.files.has(path)) return this.files.get(path);
    const session = this.sessions.find((s) => D.sessionPath(s.name) === path);
    if (session) return toFmTranscriptJson(session.transcript);
    const t = this.transcripts.get(path);
    return t ? toFmTranscriptJson(t) : undefined;
  }

  private readText(path: string): string {
    return this.readTextMaybe(path) ?? fail(`Could not read ${path}: no such file.`);
  }

  private saveTempFile(fileName: string, data: string): string {
    const path = `${D.PATHS.tmpDir}/${fileName}`;
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
    if (data.startsWith("data:")) this.images.set(path, data);
    else if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext))
      this.images.set(path, `data:${mime};base64,${data}`);
    else this.files.set(path, data);
    return path;
  }

  private which(name: string): string | null {
    const known: Record<string, string> = {
      npx: "/opt/homebrew/bin/npx",
      node: "/opt/homebrew/bin/node",
      npm: "/opt/homebrew/bin/npm",
      python3: "/usr/bin/python3",
      fm: "/usr/bin/fm",
      git: "/usr/bin/git",
      shortcuts: "/usr/bin/shortcuts",
    };
    return known[name] ?? null;
  }

  // ---------- fm ----------

  private fmStatus(): FmStatus {
    const found = this.binaryFound;
    return {
      binaryPath: this.config.fmPath,
      binaryFound: found,
      macosVersion: D.MACOS_VERSION,
      macosBuild: D.MACOS_BUILD,
      modelAvailable: found,
      availabilityMessage: found ? "System model available" : `fm was not found at ${this.config.fmPath}.`,
      licenseAgreed: found && this.licenseAgreed,
      licenseMessage: !found ? "" : this.licenseAgreed ? D.LICENSE_AGREED_MESSAGE : D.LICENSE_MISSING_MESSAGE,
      contextSize: this.config.contextSize,
    };
  }

  private async fmRun(args: string[], runId: string, channel: unknown): Promise<RunResult> {
    if (!this.binaryFound) fail(`Could not start ${this.config.fmPath}: no such file.`);
    const out = channelSender<RunEvent>(channel);
    const command = displayCommand(args, this.config.fmPath);
    const started = Date.now();
    const run = { cancelled: false };
    this.runs.set(runId, run);
    let stdout = "";
    let stderr = "";
    let firstOutputMs: number | null = null;

    const write = (text: string) => {
      if (firstOutputMs === null) firstOutputMs = Date.now() - started;
      stdout += text;
      out.send({ kind: "stdout", text });
    };
    const finish = (exitCode: number, error: string | null): RunResult => {
      this.runs.delete(runId);
      out.end();
      return {
        command,
        exitCode,
        stdout,
        stderr,
        error,
        durationMs: Date.now() - started,
        firstOutputMs,
        cancelled: run.cancelled,
      };
    };
    const failRun = (code: number, message: string) => {
      stderr += `Error: ${message}\n`;
      out.send({ kind: "stderr", text: `Error: ${message}\n` });
      return finish(code, message);
    };
    const stream = async (chunks: string[], ms = 25) => {
      for (const chunk of chunks) {
        if (run.cancelled) return false;
        write(chunk);
        await this.sleep(ms);
      }
      return !run.cancelled;
    };

    out.send({ kind: "started", command });
    const sub = args[0] ?? "";

    if (sub === "respond") {
      if (!this.licenseAgreed) {
        return failRun(
          69,
          "You need to agree to the Foundation Models license first. Run sudo fm license in Terminal.",
        );
      }
      const p = D.parseRespondArgs(args);
      if (!p.prompt.trim() && !p.texts.length && !p.images.length) {
        return failRun(64, "Missing prompt. Provide a positional prompt, --text, or --image option.");
      }
      await this.sleep(p.noStream ? 1400 : 380);
      let answer: string;
      if (p.schema) {
        answer = JSON.stringify(D.sampleFromSchema(this.loadSchema(p.schema)), null, 2);
      } else {
        const ask = [p.prompt, ...p.texts].join("\n");
        answer = D.pickAnswer(ask);
        if (p.images.length) {
          answer = `The image shows a soft blue and purple gradient with three light circles. The text "Sample image" is in the lower left corner.\n\n${answer}`;
        }
      }
      const chunks = p.noStream ? [answer] : p.schema ? D.splitFixed(answer) : D.splitForStream(answer);
      if (!(await stream(chunks))) return finish(-1, "Stopped.");
      write("\n");
      if (p.saveTranscript) this.saveTurn(p, answer);
      return finish(0, null);
    }

    if (sub === "count-tokens") {
      await this.sleep(250);
      const r = D.countTokensFromArgs(args, (path) => this.readTextMaybe(path));
      if ("error" in r) return failRun(1, r.error);
      write(`${r.tokens}\n`);
      return finish(0, null);
    }

    if (sub === "schema") {
      await this.sleep(120);
      if (args[1] !== "object")
        return failRun(64, "Missing subcommand. Use: fm schema object --name Person --string name");
      const r = D.schemaFromObjectArgs(args);
      if ("error" in r) return failRun(64, r.error);
      write(`${D.formatLikeFm(r.schema)}\n`);
      return finish(0, null);
    }

    if (sub === "available") {
      await this.sleep(200);
      write("System model available\n");
      return finish(0, null);
    }

    if (sub === "license") {
      await this.sleep(150);
      if (args.includes("--show")) write(D.LICENSE_TEXT);
      else if (args.includes("--status"))
        write(`${this.licenseAgreed ? D.LICENSE_AGREED_MESSAGE : D.LICENSE_MISSING_MESSAGE}\n`);
      else return failRun(77, "Agreeing to the license needs Terminal. Run: sudo fm license");
      return finish(0, null);
    }

    if (sub === "--help" || sub === "help" || sub === "") {
      write(
        "Usage: fm <command> [options]\n\nCOMMANDS\n  available     Check model availability\n  chat          Start an interactive chat session\n  count-tokens  Count tokens in a prompt or instructions\n  license       Show and agree to the Legal Notice & Terms\n  respond       Generate a response to a prompt\n  schema        Generate a structured output generation schema\n  serve         Start a Chat Completions API server\n",
      );
      return finish(0, null);
    }

    return failRun(64, `Unknown option '${sub}'`);
  }

  private loadSchema(schema: string): unknown {
    const text = schema.trim().startsWith("{") ? schema : this.readTextMaybe(schema);
    try {
      return JSON.parse(text ?? "");
    } catch {
      return JSON.parse(D.PERSON_SCHEMA);
    }
  }

  private transcriptAt(path: string): ParsedTranscript | undefined {
    const session = this.sessions.find((s) => D.sessionPath(s.name) === path);
    return session?.transcript ?? this.transcripts.get(path);
  }

  /** `--save-transcript`: append the turn to that transcript (CLI session or other file). */
  private saveTurn(p: D.ParsedRespond, answer: string) {
    const path = p.saveTranscript ?? "";
    const base = p.resume ? this.transcriptAt(p.resume) : undefined;
    const t: ParsedTranscript = base
      ? wire(base)
      : {
          modelName: "system",
          instructions: p.instructions,
          messages: [],
          systemVersion: "Version 27.0.1 (Build 26A434)",
        };
    t.messages.push(
      {
        id: D.uid(),
        role: "user",
        text: [p.prompt, ...p.texts].filter(Boolean).join("\n"),
        images: p.images.map(() => samplePng()),
      },
      { id: D.uid(), role: "response", text: answer, images: [] },
    );
    const prefix = `${D.SESSIONS_DIR}/`;
    if (path.startsWith(prefix) && path.endsWith(".json")) {
      const name = path.slice(prefix.length, -5);
      this.sessions = this.sessions.filter((s) => s.name !== name);
      this.sessions.push({ name, modifiedMs: Date.now(), transcript: t });
    } else {
      this.transcripts.set(path, t);
    }
  }

  // ---------- CLI sessions ----------

  private sessionList(): CliSession[] {
    return [...this.sessions]
      .sort((x, y) => y.modifiedMs - x.modifiedMs)
      .map((s) => {
        const users = s.transcript.messages.filter((m) => m.role === "user");
        return {
          name: s.name,
          path: D.sessionPath(s.name),
          modifiedMs: s.modifiedMs,
          sizeBytes: D.transcriptSize(s.transcript),
          preview: D.plainPreview(users[0]?.text ?? "", 80),
          turns: users.length,
        };
      });
  }

  private session(name: string): D.MockSession {
    return this.sessions.find((s) => s.name === name) ?? fail(`No CLI session named ${name}.`);
  }

  private renameSession(from: string, to: string): null {
    const name = to.trim();
    if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) {
      fail("Use a name without slashes, like trip-ideas.");
    }
    if (this.sessions.some((s) => s.name === name)) fail(`A session named ${name} already exists.`);
    const s = this.session(from);
    s.name = name;
    return null;
  }

  private newSessionPath(base: string): string {
    const slug = D.slugify(base);
    let name = slug;
    for (let n = 2; this.sessions.some((s) => s.name === name); n++) name = `${slug}-${n}`;
    return D.sessionPath(name);
  }

  // ---------- public server ----------

  private serverLog(line: string) {
    const entry: LogLine = { ts: Date.now(), line };
    this.server.logs.push(entry);
    if (this.server.logs.length > 500) this.server.logs.splice(0, this.server.logs.length - 500);
    this.emit("public-server-log", entry);
  }

  private async serverStart(config: PublicServerConfig): Promise<PublicServerStatus> {
    if (this.server.running) return this.server;
    if (!this.binaryFound) fail(`Could not start ${this.config.fmPath}: no such file.`);
    if (!this.licenseAgreed) fail("fm serve stopped: the license is not agreed yet. Run sudo fm license in Terminal.");
    await this.sleep(700);
    const cfg = config ?? this.config.publicServer;
    const socket = cfg.mode === "socket";
    if (socket && !cfg.socketPath.trim()) fail("Choose a socket path first.");
    const url = socket ? null : `http://${cfg.host || "127.0.0.1"}:${cfg.port || 1976}`;
    this.server = {
      running: true,
      pid: 48213,
      url,
      socketPath: socket ? cfg.socketPath : null,
      startedAt: Date.now(),
      command: displayCommand(
        serveArgs({ mode: cfg.mode, host: cfg.host, port: cfg.port, socketPath: cfg.socketPath }),
        this.config.fmPath,
      ),
      lastError: null,
      logs: [],
    };
    for (const line of D.serveBanner(url ?? `unix:${cfg.socketPath}`)) this.serverLog(line);
    this.emit("public-server-state", this.server);
    this.dispose();
    this.serverTimer = setInterval(
      () => this.serverLog(D.fakeRequestLine(this.serverTick++, Date.now())),
      Math.max(50, 1000 * this.timeScale),
    );
    return this.server;
  }

  private async serverStop(): Promise<PublicServerStatus> {
    if (!this.server.running) return this.server;
    await this.sleep(300);
    this.dispose();
    this.serverLog("");
    this.serverLog("  · shutting down");
    this.server = { ...this.server, running: false, pid: null, url: null, socketPath: null, startedAt: null };
    this.emit("public-server-state", this.server);
    return this.server;
  }

  private async serverRequest(method: string, path: string, body: string | null): Promise<HttpResult> {
    if (!this.server.running) fail("The server is not running. Start it first.");
    const started = Date.now();
    const m = method.toUpperCase();
    const created = Math.floor(started / 1000);
    let status = 200;
    let resBody: string;
    let tail = "";
    const error = (code: number, message: string, type: string) => {
      status = code;
      return JSON.stringify({ error: { message, type, code: String(code) } });
    };

    if (m === "GET" && path === "/health") {
      await this.sleep(40);
      resBody = JSON.stringify({ status: "fm serve is running", models: [{ name: "system", available: true }] });
    } else if (m === "GET" && path === "/v1/models") {
      await this.sleep(40);
      resBody = JSON.stringify({
        object: "list",
        data: [{ id: "system", object: "model", owned_by: "Apple", created }],
      });
    } else if (m === "POST" && path === "/v1/chat/completions") {
      let req: Record<string, unknown> | null;
      try {
        req = JSON.parse(body ?? "") as Record<string, unknown>;
      } catch {
        req = null;
      }
      const format = (req?.response_format ?? null) as { type?: string; json_schema?: { schema?: unknown } } | null;
      const messages = Array.isArray(req?.messages) ? (req!.messages as { role?: string; content?: unknown }[]) : [];
      if (!req) resBody = error(400, "The request body is not valid JSON.", "invalid_request_error");
      else if (messages.length === 0) resBody = error(400, "messages must not be empty.", "invalid_request_error");
      else if (format?.type === "json_object")
        resBody = error(400, "response_format json_object is not supported. Use json_schema.", "invalid_request_error");
      else {
        const text = (c: unknown): string =>
          typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c.map((p) => (p && typeof p === "object" && "text" in p ? String(p.text) : "")).join(" ")
              : "";
        const lastUser = [...messages].reverse().find((x) => x.role === "user");
        const answer =
          format?.type === "json_schema"
            ? JSON.stringify(D.sampleFromSchema(format.json_schema?.schema ?? {}))
            : D.pickAnswer(text(lastUser?.content));
        const promptTokens = 40 + D.estimateTokens(messages.map((x) => text(x.content)).join("\n"));
        const completionTokens = D.estimateTokens(answer);
        await this.sleep(600 + completionTokens * 6);
        const id = `chatcmpl-${D.uid().toUpperCase()}`;
        if (req.stream === false) {
          resBody = JSON.stringify({
            usage: {
              completion_tokens: completionTokens,
              completion_tokens_details: { reasoning_tokens: 0 },
              prompt_tokens: promptTokens,
              total_tokens: promptTokens + completionTokens,
              prompt_tokens_details: { cached_tokens: 0 },
            },
            id,
            object: "chat.completion",
            model: "system",
            created,
            choices: [
              { index: 0, message: { role: "assistant", content: answer, refusal: null }, finish_reason: "stop" },
            ],
          });
        } else {
          const chunk = (choice: unknown) =>
            `data: ${JSON.stringify({ created, model: "system", id, object: "chat.completion.chunk", choices: [choice] })}\n\n`;
          resBody =
            chunk({ delta: { role: "assistant" }, index: 0 }) +
            D.splitForStream(answer)
              .map((t) => chunk({ delta: { content: t }, index: 0 }))
              .join("") +
            chunk({ finish_reason: "stop", index: 0, delta: {} }) +
            "data: [DONE]\n\n";
        }
        tail = ` · system · ${promptTokens}→${completionTokens} tokens · ${Date.now() - started}ms`;
      }
    } else {
      await this.sleep(20);
      resBody = error(404, `Not found: ${m} ${path}`, "not_found");
    }
    this.serverLog(`${D.hhmmss(Date.now())} · [${m}]${m === "GET" ? " " : ""} · ${path} · ${status}${tail}`);
    return { status, body: resBody, durationMs: Date.now() - started };
  }

  // ---------- engine and chats ----------

  private engineStatus(): EngineStatus {
    const running = this.binaryFound && this.licenseAgreed;
    return {
      running,
      socketPath: D.PATHS.engineSocket,
      pid: running ? this.enginePid : null,
      lastError: running ? null : "The private fm server is not running: the license is not agreed yet.",
    };
  }

  private chatList(): ChatSummary[] {
    return [...this.chats.values()]
      .sort((x, y) => y.updatedAt - x.updatedAt)
      .map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
        preview: D.plainPreview(c.messages[c.messages.length - 1]?.text ?? ""),
      }));
  }

  private chat(id: string): Chat {
    return this.chats.get(id) ?? fail("This chat does not exist anymore.");
  }

  private chatCreate(instructions: string | null): Chat {
    const now = Date.now();
    const chat: Chat = {
      id: D.uid(),
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      instructions: instructions ?? this.config.chatDefaults.instructions,
      messages: [],
    };
    this.chats.set(chat.id, chat);
    return chat;
  }

  private cancelChat(chatId: string) {
    const run = this.chatRuns.get(chatId);
    if (run) run.cancelled = true;
    for (const [id, pending] of this.approvals) {
      if (pending.chatId === chatId) {
        this.approvals.delete(id);
        pending.resolve("deny");
      }
    }
  }

  private approvalRespond(approvalId: string, decision: ApprovalDecision): null {
    const pending = this.approvals.get(approvalId) ?? fail("This approval is not waiting anymore.");
    this.approvals.delete(approvalId);
    pending.resolve(decision);
    return null;
  }

  private waitForApproval(chatId: string, approvalId: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => this.approvals.set(approvalId, { chatId, resolve }));
  }

  private toolOn(name: string) {
    return this.config.builtinTools[name]?.enabled ?? true;
  }

  private skillMode(name: string) {
    return this.config.skills[name]?.mode ?? "onDemand";
  }

  private async chatSend(chatId: string, text: string, images: string[], channel: unknown): Promise<ChatMessage> {
    const chat = this.chat(chatId);
    const out = channelSender<AgentEvent>(channel);
    if (!this.binaryFound || !this.licenseAgreed) {
      const message = "The model is not ready. Agree to the license first (sudo fm license), then try again.";
      out.send({ type: "error", message });
      out.end();
      fail(message);
    }
    const started = Date.now();
    const run = { cancelled: false };
    this.chatRuns.set(chatId, run);
    const priorTurns = chat.messages.filter((m) => m.role === "user").length;

    const user: ChatMessage = {
      id: D.uid(),
      role: "user",
      text,
      images,
      steps: [],
      skillsUsed: [],
      createdAt: started,
      usage: null,
      durationMs: null,
      error: null,
    };
    chat.messages.push(user);
    chat.updatedAt = started;
    if (chat.title === "New chat") chat.title = titleFrom(text);
    out.send({ type: "userMessage", message: user });

    const messageId = D.uid();
    out.send({ type: "assistantStart", messageId });
    out.send({ type: "status", text: "Thinking…" });
    await this.sleep(700);

    const steps: AgentStep[] = [];
    const notes: string[] = [];
    const skillsUsed = [...this.skills.keys()].filter((n) => this.skillMode(n) === "always");
    const toolsOn = this.config.chatDefaults.toolsEnabled;
    const newStep = (
      toolName: string,
      title: string,
      args: unknown,
      source: AgentStep["source"] = "builtin",
    ): AgentStep => {
      const s: AgentStep = {
        id: D.uid(),
        toolId: source === "skill" ? "skill:use_skill" : `builtin:${toolName}`,
        toolName,
        title,
        source,
        arguments: args,
        status: "running",
        result: null,
        error: null,
        durationMs: null,
      };
      steps.push(s);
      return s;
    };
    const runStep = async (s: AgentStep, ms: number, work: () => string) => {
      out.send({ type: "status", text: `Using ${s.title}…` });
      s.status = "running";
      out.send({ type: "step", step: s });
      const t0 = Date.now();
      await this.sleep(ms);
      try {
        s.result = work();
        s.status = "done";
      } catch (err) {
        s.error = String(err instanceof Error ? err.message : err);
        s.status = "error";
      }
      s.durationMs = Math.max(1, Date.now() - t0);
      out.send({ type: "step", step: s });
    };

    // Calculator when the text has numbers.
    if (toolsOn && !run.cancelled && /\d/.test(text) && this.toolOn("calculator")) {
      const expr = D.findExpression(text);
      if (expr) {
        const s = newStep("calculator", "Calculator", { expression: expr });
        await runStep(s, 400, () => D.formatNumber(D.evaluateMath(expr)));
        if (s.status === "done") notes.push(`I used the calculator: **${expr} = ${s.result}**.`);
      }
    }

    // Date and time.
    if (
      toolsOn &&
      !run.cancelled &&
      /\b(time|date|today|day|clock|now)\b/i.test(text) &&
      this.toolOn("get_current_datetime")
    ) {
      const s = newStep("get_current_datetime", "Current date and time", {});
      await runStep(s, 150, nowText);
      notes.push(`It is now **${s.result}**.`);
    }

    // fetch_url needs approval (unless set to "always").
    const urlMatch = text.match(/https?:\/\/[^\s)>\]]+/);
    if (toolsOn && !run.cancelled && urlMatch && this.toolOn("fetch_url")) {
      const url = urlMatch[0].replace(/[.,;:!?]+$/, "");
      const s = newStep("fetch_url", "Fetch URL", { url });
      let allowed = true;
      if ((this.config.builtinTools.fetch_url?.approval ?? "ask") === "ask") {
        s.status = "pendingApproval";
        out.send({ type: "step", step: s });
        const approvalId = D.uid();
        // Register first, so an instant approval_respond finds it.
        const pending = this.waitForApproval(chatId, approvalId);
        out.send({ type: "approvalRequired", approvalId, step: s });
        out.send({ type: "status", text: "Waiting for your approval…" });
        const decision = await pending;
        if (decision === "always") {
          this.config.builtinTools.fetch_url = { enabled: true, approval: "always" };
        }
        allowed = decision !== "deny";
        if (!allowed) {
          s.status = "denied";
          s.error = "You did not allow this tool call.";
          out.send({ type: "step", step: s });
          notes.push("I did not open the link, because you did not allow it.");
        }
      }
      if (allowed && !run.cancelled) {
        await runStep(s, 900, () => D.FETCHED_PAGE);
        notes.push(
          `I read ${url}. The main points:\n\n- Pay yourself first, on payday.\n- Track every expense for one month.\n- Keep three months of costs as an emergency fund.`,
        );
      }
    }

    // On-demand skill.
    if (
      toolsOn &&
      !run.cancelled &&
      /\be-?mail\b/i.test(text) &&
      this.skills.has("email-writer") &&
      this.skillMode("email-writer") === "onDemand"
    ) {
      const s = newStep("use_skill", "Use skill: email-writer", { name: "email-writer" }, "skill");
      out.send({ type: "status", text: "Loading skill email-writer" });
      const tokens = this.skills.get("email-writer")!.tokenEstimate;
      await runStep(s, 120, () => `Loaded the skill email-writer (${tokens} tokens).`);
      skillsUsed.push("email-writer");
      notes.push(
        "> **Subject:** A quick update\n>\n> Hi team,\n>\n> Here is a short update. Everything is on track for Friday.\n>\n> Thanks,\n> Ada",
      );
    }

    let answer = notes.length ? notes.join("\n\n") : D.pickAnswer(text);
    if (images.length) {
      answer = `I can see the image you sent. It shows a soft blue and purple gradient with three light circles.\n\n${answer}`;
    }

    let streamed = "";
    if (!run.cancelled) {
      for (const chunk of D.splitForStream(answer)) {
        if (run.cancelled) break;
        streamed += chunk;
        out.send({ type: "delta", text: chunk });
        await this.sleep(25);
      }
    }

    const promptTokens = 1180 + 160 * priorTurns + 90 * steps.length + D.estimateTokens(text);
    const completionTokens = D.estimateTokens(streamed);
    const contextSize = this.config.contextSize;
    out.send({
      type: "context",
      usedTokens: Math.min(
        contextSize - 120,
        priorTurns === 0 && steps.length === 0 ? 1450 : promptTokens + completionTokens,
      ),
      contextSize,
    });

    const message: ChatMessage = {
      id: messageId,
      role: "assistant",
      text: streamed,
      images: [],
      steps,
      skillsUsed,
      createdAt: Date.now(),
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      durationMs: Date.now() - started,
      error: run.cancelled ? "Stopped." : null,
    };
    chat.messages.push(message);
    chat.updatedAt = message.createdAt;
    this.chatRuns.delete(chatId);
    // Like the Rust engine: a failed turn sends "error", then "done" with the error on the message.
    if (message.error) out.send({ type: "error", message: message.error });
    out.send({ type: "done", message });
    out.end();
    return message;
  }

  // ---------- tools ----------

  private catalog(): ToolInfo[] {
    const cfg = this.config;
    const list: ToolInfo[] = [];
    for (const t of D.BUILTIN_TOOLS) {
      const prefs = cfg.builtinTools[t.name] ?? { enabled: true, approval: t.dangerous ? "ask" : "always" };
      list.push(
        D.makeToolInfo({
          id: `builtin:${t.name}`,
          name: t.name,
          title: t.title,
          description: t.description,
          source: "builtin",
          sourceLabel: "Built-in",
          enabled: prefs.enabled,
          approval: prefs.approval,
          inputSchema: D.objectInput(t.name, t.params),
          dangerous: !!t.dangerous,
        }),
      );
    }
    for (const c of cfg.customTools) {
      const label = c.kind.type === "http" ? "HTTP" : c.kind.type === "shell" ? "Shell" : "Shortcut";
      list.push(
        D.makeToolInfo({
          id: `custom:${c.id}`,
          name: c.name,
          title: humanize(c.name),
          description: c.description,
          source: "custom",
          sourceLabel: label,
          enabled: c.enabled,
          approval: c.approval,
          inputSchema: D.objectInput(
            c.name,
            c.params.map((p) => [p.name, p.type, p.description, p.required]),
          ),
          dangerous: c.kind.type === "shell",
        }),
      );
    }
    for (const s of cfg.mcpServers) {
      const rt = this.mcp.get(s.id);
      if (!s.enabled || rt?.state !== "connected") continue;
      for (const tool of rt.tools) {
        list.push(
          D.makeToolInfo({
            id: `mcp:${s.id}:${tool.name}`,
            name: `${toolSlug(s.name)}_${tool.name}`,
            title: humanize(tool.name),
            description: tool.description,
            source: "mcp",
            sourceLabel: s.name,
            enabled: !s.disabledTools.includes(tool.name),
            approval: s.approval,
            inputSchema: tool.inputSchema,
            dangerous: /write|delete|move|edit/.test(tool.name),
          }),
        );
      }
    }
    const onDemand = [...this.skills.values()].filter((sk) => this.skillMode(sk.name) === "onDemand");
    if (onDemand.length) {
      list.push(
        D.makeToolInfo({
          id: "skill:use_skill",
          name: "use_skill",
          title: "Use skill",
          description: `Load the full instructions of a skill before you answer. Skills: ${onDemand
            .map((sk) => `${sk.name} (${sk.description})`)
            .join("; ")}`,
          source: "skill",
          sourceLabel: "Skills",
          enabled: true,
          approval: "always",
          inputSchema: {
            title: "use_skill",
            type: "object",
            properties: {
              name: { type: "string", description: "Skill name", enum: onDemand.map((sk) => sk.name) },
            },
            required: ["name"],
            "x-order": ["name"],
            additionalProperties: false,
          },
          dangerous: false,
        }),
      );
    }
    return list;
  }

  private insideAllowed(path: string) {
    return this.config.allowedFolders.some((f) => path === f || path.startsWith(`${f.replace(/\/$/, "")}/`));
  }

  /** Output of a catalog tool. Throws a message on failure. */
  private toolOutput(toolId: string, rawArgs: unknown): string {
    const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
    const str = (k: string, fallback = "") => (typeof args[k] === "string" ? (args[k] as string) : fallback);
    const [source, ...rest] = toolId.split(":");
    const name = rest[rest.length - 1] ?? "";

    if (source === "builtin") {
      switch (name) {
        case "get_current_datetime":
          return nowText();
        case "calculator":
          return D.formatNumber(D.evaluateMath(str("expression", "1 + 1")));
        case "fetch_url":
          if (!/^https?:\/\//.test(str("url"))) throw new Error("The URL must start with http:// or https://.");
          return D.FETCHED_PAGE;
        case "spotlight_search": {
          const q = D.slugify(str("query", "notes"));
          return [
            `${D.HOME}/Documents/${q}.md`,
            `${D.HOME}/Documents/Projects/${q}-plan.pdf`,
            `${D.HOME}/Downloads/${q}-2026.txt`,
          ].join("\n");
        }
        case "read_file": {
          const path = str("path");
          if (!this.insideAllowed(path))
            throw new Error("This path is outside the allowed folders. Add the folder in Settings first.");
          return this.files.get(path) ?? "Hello from a sample file.\nThis text is fake mock data.\n";
        }
        case "list_directory": {
          const path = str("path", this.config.allowedFolders[0] ?? D.HOME);
          if (!this.insideAllowed(path))
            throw new Error("This path is outside the allowed folders. Add the folder in Settings first.");
          return "Projects/\nReceipts/\nnotes.txt\nperson-schema.json";
        }
        case "write_file": {
          const path = str("path");
          if (!this.insideAllowed(path))
            throw new Error("This path is outside the allowed folders. Add the folder in Settings first.");
          this.files.set(path, str("content"));
          return `Wrote ${str("content").length} bytes to ${path}.`;
        }
        case "run_shell_command":
          return `$ ${str("command", "echo hello")}\nhello\n\nexit code 0`;
        case "read_clipboard":
          return "Meeting moved to 3 pm on Thursday.";
        case "open_url":
          return `Opened ${str("url", "https://example.com")} in the default browser.`;
        case "run_shortcut": {
          const sc = str("name", "Log Water");
          if (!D.SHORTCUTS.includes(sc)) throw new Error(`No shortcut named "${sc}".`);
          return sc === "Log Water" ? "Logged 250 ml of water." : `Shortcut "${sc}" finished.`;
        }
      }
    }
    if (source === "custom") {
      const tool = this.config.customTools.find((t) => t.id === name) ?? fail(`No custom tool with id ${name}.`);
      return this.customOutput(tool, args);
    }
    if (source === "mcp") {
      const path = str("path", `${D.HOME}/Documents`);
      switch (name) {
        case "read_text_file":
          return this.files.get(path) ?? "Team sync, Monday\n- Beta ships Friday\n";
        case "list_directory":
          return "[DIR] Projects\n[DIR] Receipts\n[FILE] notes.txt\n[FILE] person-schema.json";
        case "search_files":
          return `${D.HOME}/Documents/notes.txt\n${D.HOME}/Documents/Projects/README.md`;
        case "get_file_info":
          return `size: 1204\ncreated: Mon Oct 05 2026 09:12:44\nmodified: Tue Oct 06 2026 17:40:03\nisDirectory: false\npermissions: 644`;
        default:
          return JSON.stringify({ content: [{ type: "text", text: `Result of ${name}.` }] });
      }
    }
    if (source === "skill") {
      const skill = this.skills.get(str("name")) ?? fail(`No skill named ${str("name")}.`);
      return skill.body;
    }
    return fail(`Tool not found: ${toolId}`);
  }

  private customOutput(tool: CustomTool, args: Record<string, unknown>): string {
    for (const p of tool.params) {
      if (p.required && (args[p.name] === undefined || args[p.name] === "")) {
        throw new Error(`Missing a value for "${p.name}".`);
      }
    }
    const kind = tool.kind;
    if (kind.type === "http") {
      const url = kind.url.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => encodeURIComponent(String(args[k] ?? "")));
      if (/wttr\.in/.test(url)) return `${String(args.city ?? "Lisbon")}: ⛅️  +18°C`;
      return `HTTP 200 (${kind.method} ${url})\n\n{"ok":true}`;
    }
    if (kind.type === "shell") {
      if (/pmset/.test(kind.command)) {
        return "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234567)\t87%; charging; 0:42 remaining present: true";
      }
      return `$ ${kind.command}\nDone.\n\nexit code 0`;
    }
    return `Shortcut "${kind.shortcutName}" finished.`;
  }

  private async toolTest(toolId: string, args: unknown): Promise<ToolTestResult> {
    const t0 = Date.now();
    await this.sleep(400);
    try {
      const output = this.toolOutput(toolId, args);
      return { ok: true, output, durationMs: Date.now() - t0 };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 };
    }
  }

  private async customToolTest(tool: CustomTool, args: unknown): Promise<ToolTestResult> {
    const t0 = Date.now();
    await this.sleep(400);
    try {
      const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
      return { ok: true, output: this.customOutput(tool, a), durationMs: Date.now() - t0 };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 };
    }
  }

  // ---------- MCP ----------

  private connectedRuntime(id: string): McpRuntime {
    const known = D.MCP_SERVER_TOOLS[id];
    return {
      state: "connected",
      error: null,
      serverName: known?.serverName ?? "example-server",
      serverVersion: known?.serverVersion ?? "1.0.0",
      tools: known?.tools ?? D.GENERIC_MCP_TOOLS,
      stderrTail:
        id === "filesystem"
          ? ["Secure MCP Filesystem Server running on stdio", `Allowed directories: [ '${D.HOME}/Documents' ]`]
          : ["Server started"],
    };
  }

  private mcpStatuses(): McpServerStatus[] {
    return this.config.mcpServers.map((s) => {
      const rt = s.enabled ? this.mcp.get(s.id) : undefined;
      return {
        id: s.id,
        name: s.name,
        state: rt?.state ?? "disconnected",
        error: rt?.error ?? null,
        serverName: rt?.serverName ?? null,
        serverVersion: rt?.serverVersion ?? null,
        tools: (rt?.tools ?? []).map((t) => ({ ...t, enabled: !s.disabledTools.includes(t.name) })),
        stderrTail: rt?.stderrTail ?? [],
      };
    });
  }

  private async mcpConnect(id: string): Promise<McpServerStatus[]> {
    if (!this.config.mcpServers.some((s) => s.id === id)) fail("No MCP server with this id.");
    this.mcp.set(id, {
      state: "connecting",
      error: null,
      serverName: null,
      serverVersion: null,
      tools: [],
      stderrTail: [],
    });
    this.emit("mcp-status", this.mcpStatuses());
    await this.sleep(900);
    this.mcp.set(id, this.connectedRuntime(id));
    const statuses = this.mcpStatuses();
    this.emit("mcp-status", statuses);
    return statuses;
  }

  private async mcpDisconnect(id: string): Promise<McpServerStatus[]> {
    await this.sleep(150);
    this.mcp.delete(id);
    const statuses = this.mcpStatuses();
    this.emit("mcp-status", statuses);
    return statuses;
  }

  private async mcpTest(config: McpServerConfig): Promise<McpTestResult> {
    const t0 = Date.now();
    await this.sleep(1200);
    const t = config?.transport;
    if (t?.type === "stdio" && !this.which(t.command) && !t.command.startsWith("/")) {
      return {
        ok: false,
        error: `Could not start "${t.command}": command not found. Install it first, then test again.`,
        serverName: null,
        serverVersion: null,
        tools: [],
        stderrTail: [`zsh:1: command not found: ${t.command}`],
        durationMs: Date.now() - t0,
      };
    }
    const text = t?.type === "stdio" ? [t.command, ...t.args].join(" ") : (t?.url ?? "");
    const key = /filesystem/.test(text) ? "filesystem" : /mcp\.example\.com/.test(text) ? "remote" : "";
    const known = key ? D.MCP_SERVER_TOOLS[key] : undefined;
    return {
      ok: true,
      error: null,
      serverName: known?.serverName ?? "example-server",
      serverVersion: known?.serverVersion ?? "1.0.0",
      tools: (known?.tools ?? D.GENERIC_MCP_TOOLS).slice(0, 3),
      stderrTail: t?.type === "stdio" ? ["Server started on stdio"] : [],
      durationMs: Date.now() - t0,
    };
  }

  // ---------- skills ----------

  private skillList(): Skill[] {
    return [...this.skills.values()].sort((x, y) => x.name.localeCompare(y.name));
  }

  private async skillSave(input: SkillInput): Promise<Skill> {
    await this.sleep(120);
    const name = (input?.name ?? "").trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
      fail("Use lowercase letters, numbers and dashes for the name, like email-writer.");
    if (!input.description.trim()) fail("Add a short description. The model uses it to pick the skill.");
    const original = input.originalName ?? null;
    if (original && original !== name) {
      if (this.skills.has(name)) fail(`A skill named ${name} already exists.`);
      this.skills.delete(original);
    } else if (!original && this.skills.has(name)) {
      fail(`A skill named ${name} already exists.`);
    }
    const prev = original ? undefined : this.skills.get(name);
    const skill = D.makeSkill(
      { name, description: input.description.trim(), body: input.body, files: prev?.files },
      D.PATHS.skillsDir,
    );
    this.skills.set(name, skill);
    return skill;
  }

  private async skillImport(path: string): Promise<Skill> {
    await this.sleep(200);
    const cand = this.candidates.find((c) => c.path === path || `${c.path}/SKILL.md` === path);
    let seed: { name: string; description: string; body: string };
    if (cand) seed = cand;
    else {
      const raw = this.files.get(path) ?? fail(`No SKILL.md found at ${path}.`);
      const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      const field = (k: string) => fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim() ?? "";
      const folder =
        path
          .replace(/\/SKILL\.md$/i, "")
          .split("/")
          .pop() ?? "imported-skill";
      seed = { name: field("name") || folder, description: field("description"), body: (fm?.[2] ?? raw).trim() };
    }
    if (this.skills.has(seed.name)) fail(`A skill named ${seed.name} already exists. Delete it first or rename it.`);
    const skill = D.makeSkill(seed, D.PATHS.skillsDir);
    this.skills.set(skill.name, skill);
    return skill;
  }
}

/** The JSON that `fm` writes for a transcript (for read_text_file on a session path). */
function toFmTranscriptJson(t: ParsedTranscript): string {
  const entries: unknown[] = [];
  if (t.instructions)
    entries.push({ role: "instructions", id: D.uid(), contents: [{ type: "text", text: t.instructions }] });
  for (const m of t.messages) {
    entries.push({
      role: m.role,
      id: m.id,
      contents: [{ type: "text", text: m.text }, ...m.images.map((image) => ({ type: "image", image }))],
      ...(m.role === "response" ? { metadata: { systemVersion: t.systemVersion } } : {}),
    });
  }
  return JSON.stringify(
    {
      modelName: t.modelName ?? "system",
      transcript: { type: "FoundationModels.Transcript", version: "1.1", transcript: { entries } },
    },
    null,
    2,
  );
}

// ---------- install ----------

let active: MockBackend | null = null;

function scenarioFromUrl(): MockScenario {
  if (typeof location === "undefined") return "default";
  const value = new URLSearchParams(location.search).get("mock") ?? "";
  return (["nolicense", "nofm", "setup"] as const).find((s) => s === value) ?? "default";
}

function windowFromUrl(): MockWindow {
  if (typeof location === "undefined") return "main";
  return new URLSearchParams(location.search).get("window") === "quick" ? "quick" : "main";
}

/**
 * Installs the fake backend. Call before React renders. Returns null (and does
 * nothing) inside the real Tauri app.
 */
export function installMocks(options: MockOptions = {}): MockBackend | null {
  const existing = internals();
  if (existing?.invoke && !existing.fmguiMock) {
    console.warn("[mock] A real Tauri backend is present. Mock mode stays off.");
    return null;
  }
  active?.dispose();
  const scenario = options.scenario ?? scenarioFromUrl();
  const label = options.window ?? windowFromUrl();
  const backend = new MockBackend(scenario, options.timeScale ?? 1, label);
  mockWindows(label);
  mockIPC((cmd, payload) => backend.handle(cmd, payload));
  const i = internals();
  if (i) {
    i.fmguiMock = true;
    i.convertFileSrc = () => samplePng();
  }
  active = backend;
  console.info(`[mock] fmGUI mock mode (${scenario}, ${label} window). All data is fake. Nothing runs on this Mac.`);
  return backend;
}

/** Removes the fake backend (tests). */
export function uninstallMocks() {
  active?.dispose();
  active = null;
  clearMocks();
  const i = internals();
  if (i) delete i.fmguiMock;
}
