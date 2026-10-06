// Custom tool draft model, validation and templates.

import type { Approval, CustomTool, KeyValue, ParamType, ToolParam } from "../../lib/types";

export type CustomKindType = "shell" | "http" | "shortcut";

export interface ToolDraft {
  kind: CustomKindType;
  name: string;
  description: string;
  params: ToolParam[];
  shell: { command: string; cwd: string; timeoutSecs: number };
  http: { method: string; url: string; headers: KeyValue[]; body: string; timeoutSecs: number };
  shortcut: { shortcutName: string; timeoutSecs: number };
  enabled: boolean;
  approval: Approval;
}

export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,47}$/;
export const PARAM_NAME_RE = /^[a-z][a-z0-9_]{0,47}$/;

export const PARAM_TYPES: { value: ParamType; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "integer", label: "Whole number" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / no" },
];

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m }));

export function emptyDraft(): ToolDraft {
  return {
    kind: "shell",
    name: "",
    description: "",
    params: [],
    shell: { command: "", cwd: "", timeoutSecs: 30 },
    http: { method: "GET", url: "", headers: [], body: "", timeoutSecs: 30 },
    shortcut: { shortcutName: "", timeoutSecs: 60 },
    enabled: true,
    approval: "ask",
  };
}

export function draftFromTool(tool: CustomTool): ToolDraft {
  const d = emptyDraft();
  d.name = tool.name;
  d.description = tool.description;
  d.params = tool.params.map((p) => ({ ...p }));
  d.enabled = tool.enabled;
  d.approval = tool.approval;
  const k = tool.kind;
  d.kind = k.type;
  if (k.type === "shell") d.shell = { command: k.command, cwd: k.cwd ?? "", timeoutSecs: k.timeoutSecs };
  if (k.type === "http")
    d.http = {
      method: k.method,
      url: k.url,
      headers: k.headers.map((h) => ({ ...h })),
      body: k.body ?? "",
      timeoutSecs: k.timeoutSecs,
    };
  if (k.type === "shortcut") d.shortcut = { shortcutName: k.shortcutName, timeoutSecs: k.timeoutSecs };
  return d;
}

const clampTimeout = (n: number) => (Number.isFinite(n) ? Math.min(600, Math.max(1, Math.round(n))) : 30);

export function toolFromDraft(d: ToolDraft, id: string): CustomTool {
  let kind: CustomTool["kind"];
  if (d.kind === "shell") {
    kind = {
      type: "shell",
      command: d.shell.command,
      cwd: d.shell.cwd.trim() || null,
      timeoutSecs: clampTimeout(d.shell.timeoutSecs),
    };
  } else if (d.kind === "http") {
    kind = {
      type: "http",
      method: d.http.method,
      url: d.http.url.trim(),
      headers: d.http.headers.filter((h) => h.key.trim() !== "").map((h) => ({ key: h.key.trim(), value: h.value })),
      body: d.http.body.trim() ? d.http.body : null,
      timeoutSecs: clampTimeout(d.http.timeoutSecs),
    };
  } else {
    kind = {
      type: "shortcut",
      shortcutName: d.shortcut.shortcutName.trim(),
      timeoutSecs: clampTimeout(d.shortcut.timeoutSecs),
    };
  }
  return {
    id,
    name: d.name.trim(),
    description: d.description.trim(),
    params: d.params.map((p) => ({ ...p, name: p.name.trim(), description: p.description.trim() })),
    kind,
    enabled: d.enabled,
    approval: d.approval,
  };
}

/** JSON schema of the parameters, as the model would see it (close enough for estimates and the test form). */
export function paramsSchema(params: ToolParam[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const p of params) {
    if (!p.name.trim()) continue;
    properties[p.name.trim()] = { type: p.type, description: p.description };
  }
  return {
    type: "object",
    properties,
    required: params.filter((p) => p.required && p.name.trim()).map((p) => p.name.trim()),
    "x-order": params.map((p) => p.name.trim()).filter(Boolean),
  };
}

/** `{{name}}` placeholders used in the HTTP url, headers and body. */
export function placeholders(d: ToolDraft): string[] {
  const text = [d.http.url, d.http.body, ...d.http.headers.flatMap((h) => [h.key, h.value])].join("\n");
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) found.add(m[1]);
  return [...found];
}

export const envVarName = (param: string) => `FM_ARG_${param.toUpperCase()}`;

/** Makes a valid tool name from free text: "Get Weather" → "get_weather". */
export function toToolName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 48);
}

export function uniqueName(base: string, taken: string[], max = 48): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = `_${i}`;
    const name = base.slice(0, max - suffix.length) + suffix;
    if (!taken.includes(name)) return name;
  }
  return base;
}

// ---------- templates ----------

export interface ToolTemplate {
  id: string;
  title: string;
  subtitle: string;
  kind: CustomKindType;
  build: () => ToolDraft;
}

const param = (name: string, description: string, type: ParamType = "string", required = true): ToolParam => ({
  name,
  type,
  description,
  required,
});

function shellTemplate(
  name: string,
  description: string,
  command: string,
  params: ToolParam[] = [],
  approval: Approval = "ask",
) {
  return (): ToolDraft => {
    const d = emptyDraft();
    d.kind = "shell";
    d.name = name;
    d.description = description;
    d.params = params;
    d.shell.command = command;
    d.shell.timeoutSecs = 15;
    d.approval = approval;
    return d;
  };
}

function httpTemplate(name: string, description: string, url: string, params: ToolParam[] = []) {
  return (): ToolDraft => {
    const d = emptyDraft();
    d.kind = "http";
    d.name = name;
    d.description = description;
    d.params = params;
    d.http.url = url;
    d.http.timeoutSecs = 15;
    d.approval = "always";
    return d;
  };
}

export const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    id: "weather",
    title: "Weather",
    subtitle: "GET https://wttr.in/{{city}}?format=3",
    kind: "http",
    build: httpTemplate(
      "get_weather",
      "Get the current weather for a city. Use this when the user asks about the weather, the temperature or rain.",
      "https://wttr.in/{{city}}?format=3",
      [param("city", "City name, for example Paris or Tokyo")],
    ),
  },
  {
    id: "battery",
    title: "Battery status",
    subtitle: "pmset -g batt",
    kind: "shell",
    build: shellTemplate(
      "battery_status",
      "Show the Mac battery level and whether it is charging. Use this when the user asks about the battery.",
      "pmset -g batt",
      [],
      "always",
    ),
  },
  {
    id: "disk",
    title: "Disk space",
    subtitle: "df -h /",
    kind: "shell",
    build: shellTemplate(
      "disk_space",
      "Show how much disk space is used and free on the main drive. Use this when the user asks about storage or free space.",
      "df -h /",
      [],
      "always",
    ),
  },
  {
    id: "open-app",
    title: "Open an app",
    subtitle: 'open -a "$FM_ARG_APP_NAME"',
    kind: "shell",
    build: shellTemplate(
      "open_app",
      "Open a Mac app by its name, for example Safari, Notes or Calendar. Use this when the user asks to open or launch an app.",
      'open -a "$FM_ARG_APP_NAME"',
      [param("app_name", "Name of the app, for example Safari")],
    ),
  },
  {
    id: "wifi",
    title: "Current Wi-Fi network",
    subtitle: "ipconfig getsummary en0 | awk …",
    kind: "shell",
    build: shellTemplate(
      "wifi_network",
      "Show the name of the Wi-Fi network this Mac is connected to. Use this when the user asks which Wi-Fi they are on.",
      "ipconfig getsummary en0 | awk -F ' SSID : ' '/ SSID : / {print $2}'",
      [],
      "always",
    ),
  },
  {
    id: "public-ip",
    title: "Public IP",
    subtitle: "GET https://api.ipify.org",
    kind: "http",
    build: httpTemplate(
      "public_ip",
      "Get the public IP address of this internet connection. Use this when the user asks for their IP address.",
      "https://api.ipify.org",
    ),
  },
];
