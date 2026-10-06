// Fake data and pure helpers for the browser mock mode (see mock.ts).
// OWNER: agent "ui-mock". Placeholders only, no real personal data.

import type {
  AgentStep,
  AppConfig,
  Chat,
  ChatMessage,
  McpToolSummary,
  ParsedTranscript,
  PathsInfo,
  Skill,
  SkillCandidate,
  ToolInfo,
} from "./types";

// ---------- small helpers ----------

export const HOME = "/Users/ada";
export const DATA_DIR = `${HOME}/Library/Application Support/dev.local.fmgui`;
export const SESSIONS_DIR = `${HOME}/.fm/sessions`;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

/** Rough token estimate, the same rule of thumb the app uses (4 chars per token). */
export const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

/** Splits text into stream chunks (one word plus its trailing spaces). Joining the chunks gives the input back. */
export function splitForStream(text: string): string[] {
  return text.match(/\s+|\S+\s*/g) ?? [];
}

/** Splits text into fixed size chunks (for JSON output, which has few spaces). */
export function splitFixed(text: string, size = 12): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "session";
}

export function plainPreview(markdown: string, max = 90): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export const hhmmss = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

// ---------- config and paths ----------

export const PATHS: PathsInfo = {
  dataDir: DATA_DIR,
  configFile: `${DATA_DIR}/config.json`,
  chatsDir: `${DATA_DIR}/chats`,
  skillsDir: `${DATA_DIR}/skills`,
  tmpDir: `${DATA_DIR}/tmp`,
  engineSocket: `${DATA_DIR}/engine.sock`,
  cliSessionsDir: SESSIONS_DIR,
  homeDir: HOME,
};

export const DEFAULT_INSTRUCTIONS =
  "You are a helpful assistant running on-device on a Mac. Answer clearly and briefly.";

export function seedConfig(setupCompleted: boolean): AppConfig {
  return {
    fmPath: "/usr/bin/fm",
    setupCompleted,
    contextSize: 8192,
    chatDefaults: {
      instructions: DEFAULT_INSTRUCTIONS,
      maxToolSteps: 4,
      toolsEnabled: true,
      temperature: null,
    },
    builtinTools: {
      get_current_datetime: { enabled: true, approval: "always" },
      calculator: { enabled: true, approval: "always" },
      fetch_url: { enabled: true, approval: "ask" },
      spotlight_search: { enabled: true, approval: "always" },
      read_file: { enabled: true, approval: "always" },
      list_directory: { enabled: true, approval: "always" },
      write_file: { enabled: true, approval: "ask" },
      run_shell_command: { enabled: false, approval: "ask" },
      read_clipboard: { enabled: true, approval: "ask" },
      open_url: { enabled: true, approval: "ask" },
      run_shortcut: { enabled: true, approval: "ask" },
    },
    customTools: [
      {
        id: "weather",
        name: "get_weather",
        description: "Current weather for a city, from wttr.in.",
        params: [{ name: "city", type: "string", description: "City name, like Paris", required: true }],
        kind: {
          type: "http",
          method: "GET",
          url: "https://wttr.in/{{city}}?format=3",
          headers: [{ key: "Accept", value: "text/plain" }],
          body: null,
          timeoutSecs: 15,
        },
        enabled: true,
        approval: "always",
      },
      {
        id: "battery",
        name: "battery_status",
        description: "Battery level and charging state of this Mac.",
        params: [],
        kind: { type: "shell", command: "pmset -g batt", cwd: null, timeoutSecs: 10 },
        enabled: true,
        approval: "always",
      },
    ],
    mcpServers: [
      {
        id: "filesystem",
        name: "Filesystem",
        enabled: true,
        transport: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", `${HOME}/Documents`],
          env: [],
          cwd: null,
        },
        disabledTools: ["write_file"],
        approval: "ask",
      },
      {
        id: "remote",
        name: "Remote HTTP",
        enabled: true,
        transport: {
          type: "http",
          url: "https://mcp.example.com/mcp",
          headers: [{ key: "Authorization", value: "Bearer YOUR_TOKEN" }],
        },
        disabledTools: [],
        approval: "ask",
      },
    ],
    skills: {
      "email-writer": { mode: "onDemand" },
      "meeting-notes": { mode: "always" },
      "explain-like-ten": { mode: "off" },
    },
    allowedFolders: [`${HOME}/Documents`],
    publicServer: { mode: "tcp", host: "127.0.0.1", port: 1976, socketPath: "", autostart: false },
  };
}

// ---------- fm status / license ----------

export const MACOS_VERSION = "27.0.1";
export const MACOS_BUILD = "26A434";
export const LICENSE_AGREED_MESSAGE = "Agreed to license FM1 version 1.0 on 6 Oct, 2026 at 18:04.";
export const LICENSE_MISSING_MESSAGE = "License not agreed. Run 'sudo fm license' to read and agree to it.";

/** Same shape as `fm license --show` (wording shortened for the mock). */
export const LICENSE_TEXT = `LEGAL NOTICE & TERMS

PLEASE READ THESE TERMS BEFORE YOU USE THE APPLE FOUNDATION MODELS CLI. USE OF THE
CLI IS COVERED BY THE SOFTWARE LICENSE AGREEMENT FOR macOS AT
https://www.apple.com/legal/sla/. ONLY ACCESS APPLE MODELS IN THE WAYS THAT
AGREEMENT ALLOWS. IF YOU DO NOT AGREE, DO NOT USE THE CLI.
`;

// ---------- canned answers ----------

const GREETING = "Hello! I am the on-device model on your Mac. How can I help you today?";

const POEM = `Morning light on glass,
a quiet Mac hums softly,
words bloom on the screen.`;

const CODE = `Here is a small Swift example that uses an **actor** to keep a counter safe:

\`\`\`swift
actor Counter {
    private var value = 0

    func increment() -> Int {
        value += 1
        return value
    }
}

let counter = Counter()
let next = await counter.increment()
print(next)
\`\`\`

- The actor makes sure only one task changes \`value\` at a time.
- From outside the actor, call its methods with \`await\`.`;

const PACKING = `### Packing list for a 4 day city trip

| Item | How many |
| --- | --- |
| T-shirts | 4 |
| Light jacket | 1 |
| Comfortable shoes | 1 pair |
| Phone charger | 1 |
| Small umbrella | 1 |

**Tip:** roll your clothes. They take less space and wrinkle less.`;

const SUMMARY = `**Summary**

- The team agreed to ship the beta on Friday.
- Two bugs still block the release.
- Ada will send the test plan by Wednesday.`;

const FOCUS = `## Three ways to focus better

Here are simple habits that help most people:

1. **Plan the top task first.** Pick one thing before you open email.
2. **Work in short blocks.** Try 25 minutes of work, then a 5 minute break.
3. **Remove noise.** Close the tabs you do not need and mute chat for an hour.

> Small steps every day beat one big push.

Do you want me to turn this into a daily checklist?`;

/** Picks a plausible Markdown answer for a prompt. */
export function pickAnswer(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/^\s*(hi|hello|hey)\b/.test(p) && p.length < 40) return GREETING;
  if (/haiku|poem/.test(p)) return POEM;
  if (/swift|code|function|actor|async|program/.test(p)) return CODE;
  if (/trip|pack|travel|lisbon/.test(p)) return PACKING;
  if (/summar|tl;dr|shorten/.test(p)) return SUMMARY;
  return FOCUS;
}

// ---------- math (calculator tool) ----------

/** Evaluates + - * / % ^ and parentheses. Throws on bad input. No eval(). */
export function evaluateMath(expression: string): number {
  const src = expression.replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/(\d),(?=\d{3}\b)/g, "$1");
  const tokens = src.match(/\d+(?:\.\d+)?|[-+*/%^()]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const primary = (): number => {
    const t = next();
    if (t === undefined) throw new Error("The expression ends too early.");
    if (t === "(") {
      const v = sum();
      if (next() !== ")") throw new Error("A closing parenthesis is missing.");
      return v;
    }
    if (t === "-") return -primary();
    if (t === "+") return primary();
    if (/^\d/.test(t)) return Number(t);
    throw new Error(`"${t}" is not allowed in an expression.`);
  };
  const power = (): number => {
    const base = primary();
    if (peek() === "^") {
      next();
      return base ** power();
    }
    return base;
  };
  const product = (): number => {
    let v = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const r = power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const value = sum();
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}".`);
  if (!Number.isFinite(value)) throw new Error("The result is not a finite number.");
  return value;
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
}

/** Finds a math expression in free text, like "what is 12 * 7?" → "12 * 7". */
export function findExpression(text: string): string | null {
  const match = text.match(/[(\d][\d.,\s()]*(?:[-+*/x×÷^%]\s*[(\d][\d.,\s()]*)+/);
  if (match) {
    const expr = match[0].trim().replace(/[\s,]+$/, "");
    try {
      evaluateMath(expr);
      return expr;
    } catch {
      /* fall through */
    }
  }
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  if (!numbers) return null;
  return numbers.slice(0, 4).join(" + ");
}

// ---------- fm respond / count-tokens argument parsing ----------

export interface ParsedRespond {
  prompt: string;
  instructions: string | null;
  texts: string[];
  images: string[];
  tools: string[];
  schema: string | null;
  resume: string | null;
  saveTranscript: string | null;
  noStream: boolean;
  verbose: boolean;
}

const RESPOND_VALUE_FLAGS = new Set([
  "-i",
  "--instructions",
  "--schema",
  "--text",
  "--image",
  "--label",
  "--tool",
  "--resume",
  "--save-transcript",
  "--use-case",
  "--guardrails",
  "--transcript",
]);

/** Parses the args of `fm respond ...` (as built by respondArgs in fmArgs.ts). */
export function parseRespondArgs(args: string[]): ParsedRespond {
  const out: ParsedRespond = {
    prompt: "",
    instructions: null,
    texts: [],
    images: [],
    tools: [],
    schema: null,
    resume: null,
    saveTranscript: null,
    noStream: false,
    verbose: false,
  };
  const positional: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (RESPOND_VALUE_FLAGS.has(a)) {
      const v = args[++i] ?? "";
      if (a === "-i" || a === "--instructions") out.instructions = v;
      else if (a === "--schema") out.schema = v;
      else if (a === "--text") out.texts.push(v);
      else if (a === "--image") out.images.push(v);
      else if (a === "--tool") out.tools.push(v);
      else if (a === "--resume") out.resume = v;
      else if (a === "--save-transcript") out.saveTranscript = v;
      continue;
    }
    if (a === "--no-stream") out.noStream = true;
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (!a.startsWith("-")) positional.push(a);
  }
  out.prompt = positional.join(" ");
  return out;
}

/** `fm count-tokens` result for the given args. Mirrors the 27.0.1 image bug. */
export function countTokensFromArgs(
  args: string[],
  readText: (path: string) => string | undefined,
): { tokens: number } | { error: string } {
  const parsed = parseRespondArgs(args);
  if (parsed.images.length > 0) {
    return {
      error: "The operation couldn’t be completed. (ModelManagerServices.ModelManagerError error 1001.)",
    };
  }
  const transcriptIdx = args.indexOf("--transcript");
  let chars = parsed.prompt.length + parsed.texts.join("\n").length;
  let overhead = 1;
  if (parsed.instructions) {
    chars += parsed.instructions.length;
    overhead += 4;
  }
  if (transcriptIdx >= 0) {
    const path = args[transcriptIdx + 1] ?? "";
    const text = readText(path);
    if (text === undefined) return { error: `The file “${path}” couldn’t be opened because there is no such file.` };
    chars += text.length;
    overhead += 12;
  }
  if (chars === 0) return { error: "Provide a prompt, text, or transcript to count." };
  return { tokens: Math.ceil(chars / 4) + overhead };
}

// ---------- fm schema object ----------

type SchemaKind = "string" | "integer" | "number" | "boolean";

interface FlagProp {
  path: string[];
  kind: SchemaKind;
  description: string | null;
  optional: boolean;
  array: boolean;
}

interface SchemaNode {
  order: string[];
  leaves: Map<string, FlagProp>;
  children: Map<string, SchemaNode>;
}

const TYPE_FLAGS: Record<string, SchemaKind> = {
  "--string": "string",
  "--integer": "integer",
  "--int": "integer",
  "--double": "number",
  "--number": "number",
  "--float": "number",
  "--boolean": "boolean",
  "--bool": "boolean",
};

type Json = Record<string, unknown>;

/**
 * Builds the JSON schema that `fm schema object` prints for the given args
 * (title, type, properties, required, x-order, additionalProperties false,
 * nested objects as $defs). Returns an error message for bad input.
 */
export function schemaFromObjectArgs(args: string[]): { schema: Json } | { error: string } {
  const start = args[0] === "schema" ? (args[1] === "object" ? 2 : 1) : 0;
  let name: string | null = null;
  const props: FlagProp[] = [];
  for (let i = start; i < args.length; i++) {
    const a = args[i];
    if (a === "--name") {
      name = args[++i] ?? "";
    } else if (a in TYPE_FLAGS) {
      const propName = args[++i];
      if (!propName) return { error: `Missing value for '${a}'.` };
      props.push({ path: propName.split("."), kind: TYPE_FLAGS[a], description: null, optional: false, array: false });
    } else if (a === "--description") {
      const last = props[props.length - 1];
      if (!last) return { error: "'--description' must come after a property." };
      last.description = args[++i] ?? "";
    } else if (a === "--optional" || a === "--array") {
      const last = props[props.length - 1];
      if (!last) return { error: `'${a}' must come after a property.` };
      if (a === "--optional") last.optional = true;
      else last.array = true;
    } else {
      return { error: `Unknown option '${a}'` };
    }
  }
  if (!name) return { error: "Missing expected argument '--name <name>'" };
  if (props.length === 0) return { error: "Add at least one property, like --string name." };

  const root: SchemaNode = { order: [], leaves: new Map(), children: new Map() };
  for (const p of props) {
    let node = root;
    for (let d = 0; d < p.path.length - 1; d++) {
      const key = p.path[d];
      if (node.leaves.has(key)) return { error: `'${key}' is used as a value and as an object.` };
      let child = node.children.get(key);
      if (!child) {
        child = { order: [], leaves: new Map(), children: new Map() };
        node.children.set(key, child);
        node.order.push(key);
      }
      node = child;
    }
    const leaf = p.path[p.path.length - 1];
    if (node.leaves.has(leaf) || node.children.has(leaf)) {
      return { error: `Property '${p.path.join(".")}' is declared twice.` };
    }
    node.leaves.set(leaf, p);
    node.order.push(leaf);
  }

  const defs: Record<string, Json> = {};
  const schema = objectSchema(name, root, defs);
  if (Object.keys(defs).length > 0) schema.$defs = defs;
  return { schema };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function allOptional(node: SchemaNode): boolean {
  for (const leaf of node.leaves.values()) if (!leaf.optional) return false;
  for (const child of node.children.values()) if (!allOptional(child)) return false;
  return true;
}

function objectSchema(title: string, node: SchemaNode, defs: Record<string, Json>): Json {
  const properties: Json = {};
  const required: string[] = [];
  const order: string[] = [];
  // fm 27.0.1 lists plain values first and nested objects after them.
  for (const key of node.order) {
    const leaf = node.leaves.get(key);
    if (!leaf) continue;
    const base: Json = { type: leaf.kind };
    const prop: Json = leaf.array ? { type: "array", items: base } : base;
    if (leaf.description) prop.description = leaf.description;
    properties[key] = prop;
    order.push(key);
    if (!leaf.optional) required.push(key);
  }
  for (const key of node.order) {
    const child = node.children.get(key);
    if (!child) continue;
    const defName = capitalize(key);
    defs[defName] = objectSchema(defName, child, defs);
    properties[key] = { $ref: `#/$defs/${defName}` };
    order.push(key);
    if (!allOptional(child)) required.push(key);
  }
  return { title, type: "object", properties, required, "x-order": order, additionalProperties: false };
}

/** Pretty JSON in the style of fm (Swift JSONEncoder): `"key" : value` and escaped slashes. */
export function formatLikeFm(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/^(\s*"(?:[^"\\]|\\.)*"): /gm, "$1 : ")
    .replace(/\//g, "\\/");
}

/** Builds a plausible JSON value that matches a schema (for `fm respond --schema`). */
export function sampleFromSchema(schema: unknown, root: unknown = schema, key = "", depth = 0): unknown {
  if (depth > 6 || !schema || typeof schema !== "object") return null;
  const s = schema as Json;
  if (typeof s.$ref === "string") {
    const target = s.$ref
      .replace(/^#\//, "")
      .split("/")
      .reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Json)[part] : undefined), root);
    return sampleFromSchema(target, root, key, depth + 1);
  }
  if (Array.isArray(s.anyOf) && s.anyOf.length) return sampleFromSchema(s.anyOf[0], root, key, depth + 1);
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  switch (s.type) {
    case "object": {
      const out: Json = {};
      const props = (s.properties ?? {}) as Json;
      const order = Array.isArray(s["x-order"]) ? (s["x-order"] as string[]) : Object.keys(props);
      for (const k of order) if (k in props) out[k] = sampleFromSchema(props[k], root, k, depth + 1);
      return out;
    }
    case "array":
      return [0, 1].map((n) => sampleFromSchema(s.items, root, `${key}#${n}`, depth + 1));
    case "integer":
      return /age/i.test(key) ? 36 : /year/i.test(key) ? 2026 : 3;
    case "number":
      return /price|cost|budget/i.test(key) ? 120.5 : 4.5;
    case "boolean":
      return true;
    case "string":
      return sampleString(key);
    default:
      return null;
  }
}

function sampleString(key: string): string {
  const [base, idx] = key.split("#");
  const n = Number(idx ?? 0);
  const k = base.toLowerCase();
  if (k.includes("email")) return "ada@example.com";
  if (k.includes("phone")) return "+15550100001";
  if (k.includes("name")) return n ? "Grace Hopper" : "Ada Lovelace";
  if (k.includes("city")) return n ? "Porto" : "Lisbon";
  if (k.includes("country")) return "Portugal";
  if (k.includes("street")) return "1 Example Street";
  if (k.includes("date")) return "2026-10-06";
  if (k.includes("tag") || k.includes("keyword")) return ["travel", "food", "weekend"][n % 3];
  if (k.includes("title")) return "A quiet weekend in Lisbon";
  if (k.includes("summary") || k.includes("description")) return "A short and clear summary of the text.";
  if (k.includes("color")) return n ? "blue" : "green";
  return n ? "Second sample value" : "Sample value";
}

// ---------- CLI sessions (~/.fm/sessions) ----------

export interface MockSession {
  name: string;
  modifiedMs: number;
  transcript: ParsedTranscript;
}

const SYSTEM_VERSION = `Version ${MACOS_VERSION} (Build ${MACOS_BUILD})`;

function transcript(instructions: string | null, turns: [string, string][]): ParsedTranscript {
  const messages = turns.flatMap(([user, response], i) => [
    { id: `u${i}`, role: "user", text: user, images: [] },
    { id: `r${i}`, role: "response", text: response, images: [] },
  ]);
  return { modelName: "system", instructions, messages, systemVersion: SYSTEM_VERSION };
}

export function seedSessions(now: number): MockSession[] {
  return [
    {
      name: "trip-packing-list",
      modifiedMs: now - 25 * MINUTE,
      transcript: transcript("You help people plan trips. Keep lists short.", [
        ["Make a packing list for 4 days in Lisbon in October.", PACKING],
        [
          "Add things for rain.",
          "Good idea. Add these:\n\n- A small umbrella\n- A light rain jacket\n- Shoes that can get wet\n- A zip bag for your phone",
        ],
      ]),
    },
    {
      name: "swift-concurrency-tips",
      modifiedMs: now - 3 * HOUR,
      transcript: transcript(null, [
        [
          "Give me three tips for Swift concurrency.",
          "1. **Use actors for shared state.** They stop data races.\n2. **Prefer `async let`** when you run a few tasks at once.\n3. **Mark UI code with `@MainActor`** so it always runs on the main thread.",
        ],
        [
          "What is a Sendable type?",
          "A `Sendable` type is safe to pass between tasks. Value types like `struct` and `enum` are usually Sendable when all their stored properties are Sendable.\n\n```swift\nstruct Point: Sendable {\n    let x: Double\n    let y: Double\n}\n```",
        ],
      ]),
    },
    {
      name: "hello-friend",
      modifiedMs: now - 2 * DAY,
      transcript: transcript("You are a friendly assistant.", [
        [
          "Hello, friend! Can you tell me a fun fact?",
          "Sure! Honey never spoils. People have found very old pots of honey that were still safe to eat.",
        ],
        ["Wow. One more?", "Octopuses have three hearts and blue blood."],
      ]),
    },
  ];
}

export const sessionPath = (name: string) => `${SESSIONS_DIR}/${name}.json`;

/** Approximate size of the transcript file on disk. */
export function transcriptSize(t: ParsedTranscript): number {
  return 900 + t.messages.reduce((n, m) => n + m.text.length + 420, 0) + (t.instructions?.length ?? 0);
}

export function transcriptText(t: ParsedTranscript): string {
  return [t.instructions ?? "", ...t.messages.map((m) => m.text)].join("\n");
}

// ---------- agent chats ----------

function step(partial: Partial<AgentStep> & Pick<AgentStep, "toolId" | "toolName" | "title" | "source">): AgentStep {
  return {
    id: uid(),
    arguments: {},
    status: "done",
    result: null,
    error: null,
    durationMs: 3,
    ...partial,
  };
}

function message(partial: Partial<ChatMessage> & Pick<ChatMessage, "role" | "text" | "createdAt">): ChatMessage {
  return {
    id: uid(),
    images: [],
    steps: [],
    skillsUsed: [],
    usage: null,
    durationMs: null,
    error: null,
    ...partial,
  };
}

export const FETCHED_PAGE = `Budget tips for beginners

1. Pay yourself first. Move savings on payday.
2. Track every expense for one month.
3. Keep three months of costs as an emergency fund.
4. Review subscriptions every quarter.`;

const BUDGET_ANSWER = `## Your yearly savings

You save **750 per month**, so in one year you save **9,000**.

### Tips from the page

- Move the 750 to savings on payday, before you spend.
- Track every expense for one month to find leaks.
- Keep about **4,950** (three months of costs) as an emergency fund.

### Draft email

> **Subject:** Simple budget tips for the team
>
> Hi team,
>
> I found a short list of budget tips that may help. The best one: pay yourself first, right on payday.
>
> Have a great week,
> Ada`;

export function seedChats(now: number): Chat[] {
  const t1 = now - 40 * MINUTE;
  const budget: Chat = {
    id: "chat-budget",
    title: "Savings plan and team email",
    createdAt: t1,
    updatedAt: t1 + 2 * MINUTE,
    instructions: DEFAULT_INSTRUCTIONS,
    messages: [
      message({
        role: "user",
        text: "I earn 2400 a month and spend 1650. How much do I save in a year? Read https://example.com/budget-tips and write a short email to my team about it.",
        createdAt: t1,
      }),
      message({
        role: "assistant",
        text: BUDGET_ANSWER,
        createdAt: t1 + 2 * MINUTE,
        steps: [
          step({
            toolId: "builtin:calculator",
            toolName: "calculator",
            title: "Calculator",
            source: "builtin",
            arguments: { expression: "(2400 - 1650) * 12" },
            result: "9000",
            durationMs: 2,
          }),
          step({
            toolId: "builtin:fetch_url",
            toolName: "fetch_url",
            title: "Fetch URL",
            source: "builtin",
            arguments: { url: "https://example.com/budget-tips" },
            result: FETCHED_PAGE,
            durationMs: 812,
          }),
          step({
            toolId: "skill:use_skill",
            toolName: "use_skill",
            title: "Use skill: email-writer",
            source: "skill",
            arguments: { name: "email-writer" },
            result: "Loaded the skill email-writer (96 tokens).",
            durationMs: 4,
          }),
        ],
        skillsUsed: ["meeting-notes", "email-writer"],
        usage: { promptTokens: 1586, completionTokens: 164, totalTokens: 1750 },
        durationMs: 6420,
      }),
    ],
  };

  const t2 = now - 5 * HOUR;
  const swift: Chat = {
    id: "chat-swift",
    title: "Swift actors",
    createdAt: t2,
    updatedAt: t2 + MINUTE,
    instructions: "You are a senior Swift developer. Show short code examples.",
    messages: [
      message({ role: "user", text: "How do I keep a counter safe across tasks in Swift?", createdAt: t2 }),
      message({
        role: "assistant",
        text: CODE,
        createdAt: t2 + MINUTE,
        skillsUsed: ["meeting-notes"],
        usage: { promptTokens: 902, completionTokens: 121, totalTokens: 1023 },
        durationMs: 3110,
      }),
    ],
  };

  const t3 = now - 3 * DAY;
  const lisbon: Chat = {
    id: "chat-lisbon",
    title: "Weekend in Lisbon",
    createdAt: t3,
    updatedAt: t3 + 3 * MINUTE,
    instructions: DEFAULT_INSTRUCTIONS,
    messages: [
      message({ role: "user", text: "What day is it, and what should I pack for Lisbon this weekend?", createdAt: t3 }),
      message({
        role: "assistant",
        text: `Today is **Saturday, 3 October 2026**.\n\n${PACKING}`,
        createdAt: t3 + 3 * MINUTE,
        steps: [
          step({
            toolId: "builtin:get_current_datetime",
            toolName: "get_current_datetime",
            title: "Current date and time",
            source: "builtin",
            result: "Saturday, 3 October 2026 at 10:14:52 CEST",
            durationMs: 1,
          }),
        ],
        skillsUsed: ["meeting-notes"],
        usage: { promptTokens: 1130, completionTokens: 98, totalTokens: 1228 },
        durationMs: 4280,
      }),
    ],
  };

  return [budget, swift, lisbon];
}

// ---------- skills ----------

interface SkillSeed {
  name: string;
  description: string;
  body: string;
  files?: string[];
}

const SKILL_SEEDS: SkillSeed[] = [
  {
    name: "email-writer",
    description: "Write clear, friendly emails with a subject line.",
    body: `# Email writer

When the user asks for an email:

1. Start with a short subject line.
2. Greet the reader by name if you know it.
3. Keep the body under 120 words.
4. End with one clear next step.
5. Sign with the user's first name.

Use simple words. Avoid long sentences.`,
    files: ["SKILL.md", "examples.md"],
  },
  {
    name: "meeting-notes",
    description: "Turn rough notes into clean meeting notes with action items.",
    body: `# Meeting notes

Format notes like this:

## Summary
Two or three sentences.

## Decisions
- One line per decision.

## Action items
- [ ] Owner: task (due date)

Never invent owners or dates. Write "TBD" when you do not know.`,
  },
  {
    name: "explain-like-ten",
    description: "Explain any topic so a ten year old understands it.",
    body: `# Explain like I am ten

- Use short sentences and everyday words.
- Give one example from daily life (school, games, food).
- End with a one line recap that starts with "So,".`,
  },
];

export function makeSkill(seed: SkillSeed, skillsDir: string): Skill {
  return {
    name: seed.name,
    description: seed.description,
    body: seed.body,
    path: `${skillsDir}/${seed.name}`,
    files: seed.files ?? ["SKILL.md"],
    tokenEstimate: estimateTokens(seed.body),
  };
}

export const seedSkills = (skillsDir: string) => SKILL_SEEDS.map((s) => makeSkill(s, skillsDir));

export interface CandidateSeed extends SkillCandidate {
  body: string;
}

export function seedCandidates(): CandidateSeed[] {
  const body1 = `# Commit message\n\nWrite a commit message with a short subject (under 60 characters) and a body that says why the change was made.`;
  const body2 = `# Code review lite\n\nCheck the change for bugs first, then naming, then tests. List at most five findings, most important first.`;
  return [
    {
      name: "commit-message",
      description: "Write a short, clear git commit message.",
      path: `${HOME}/.claude/skills/commit-message`,
      source: "~/.claude/skills",
      tokenEstimate: estimateTokens(body1),
      alreadyImported: false,
      body: body1,
    },
    {
      name: "code-review-lite",
      description: "A quick code review checklist.",
      path: `${HOME}/.claude/skills/code-review-lite`,
      source: "~/.claude/skills",
      tokenEstimate: estimateTokens(body2),
      alreadyImported: false,
      body: body2,
    },
  ];
}

// ---------- tools ----------

type Param = [name: string, type: string, description: string, required: boolean];

export function objectInput(title: string, params: Param[]): Json {
  const properties: Json = {};
  for (const [name, type, description] of params) properties[name] = { type, description };
  return {
    title,
    type: "object",
    properties,
    required: params.filter((p) => p[3]).map((p) => p[0]),
    "x-order": params.map((p) => p[0]),
    additionalProperties: false,
  };
}

interface BuiltinSeed {
  name: string;
  title: string;
  description: string;
  params: Param[];
  dangerous?: boolean;
}

export const BUILTIN_TOOLS: BuiltinSeed[] = [
  {
    name: "get_current_datetime",
    title: "Current date and time",
    description: "Get the current date, time and time zone of this Mac.",
    params: [],
  },
  {
    name: "calculator",
    title: "Calculator",
    description: "Evaluate a math expression exactly. Supports + - * / % ^ and parentheses.",
    params: [["expression", "string", "Math expression, like (12 + 3) * 4", true]],
  },
  {
    name: "fetch_url",
    title: "Fetch URL",
    description: "Download a web page and return its readable text.",
    params: [
      ["url", "string", "Full URL starting with https://", true],
      ["maxChars", "integer", "Maximum characters to return", false],
    ],
  },
  {
    name: "spotlight_search",
    title: "Spotlight search",
    description: "Find files on this Mac with Spotlight.",
    params: [
      ["query", "string", "Words to search for", true],
      ["limit", "integer", "Maximum number of results", false],
    ],
  },
  {
    name: "read_file",
    title: "Read file",
    description: "Read a text file inside an allowed folder.",
    params: [["path", "string", "Absolute path of the file", true]],
  },
  {
    name: "list_directory",
    title: "List folder",
    description: "List the files in a folder inside an allowed folder.",
    params: [["path", "string", "Absolute path of the folder", true]],
  },
  {
    name: "write_file",
    title: "Write file",
    description: "Create or replace a text file inside an allowed folder.",
    params: [
      ["path", "string", "Absolute path of the file", true],
      ["content", "string", "Full text to write", true],
    ],
    dangerous: true,
  },
  {
    name: "run_shell_command",
    title: "Run shell command",
    description: "Run a command with zsh and return its output.",
    params: [
      ["command", "string", "The command line to run", true],
      ["cwd", "string", "Working folder", false],
    ],
    dangerous: true,
  },
  {
    name: "read_clipboard",
    title: "Read clipboard",
    description: "Read the text that is on the clipboard.",
    params: [],
  },
  {
    name: "open_url",
    title: "Open URL",
    description: "Open a link in the default browser.",
    params: [["url", "string", "Full URL to open", true]],
  },
  {
    name: "run_shortcut",
    title: "Run shortcut",
    description: "Run an Apple Shortcut by name and return its output.",
    params: [
      ["name", "string", "Name of the shortcut", true],
      ["input", "string", "Text passed to the shortcut", false],
    ],
  },
];

export const BUILTIN_TITLES: Record<string, string> = Object.fromEntries(
  BUILTIN_TOOLS.map((t) => [t.name, t.title]),
);

export function toolTokenEstimate(name: string, description: string, schema: unknown): number {
  return estimateTokens(name + description + JSON.stringify(schema));
}

export function makeToolInfo(partial: Omit<ToolInfo, "tokenEstimate">): ToolInfo {
  return { ...partial, tokenEstimate: toolTokenEstimate(partial.name, partial.description, partial.inputSchema) };
}

/** Tools offered by the mock MCP servers (unfiltered). */
export const MCP_SERVER_TOOLS: Record<string, { serverName: string; serverVersion: string; tools: McpToolSummary[] }> =
  {
    filesystem: {
      serverName: "secure-filesystem-server",
      serverVersion: "0.2.0",
      tools: [
        {
          name: "read_text_file",
          description: "Read the full text of a file. Only works inside allowed folders.",
          inputSchema: objectInput("read_text_file", [
            ["path", "string", "Path of the file", true],
            ["head", "integer", "Only return the first N lines", false],
          ]),
          enabled: true,
        },
        {
          name: "list_directory",
          description: "List files and folders in a path. Folders end with a slash.",
          inputSchema: objectInput("list_directory", [["path", "string", "Path of the folder", true]]),
          enabled: true,
        },
        {
          name: "search_files",
          description: "Search for files whose names match a pattern, in all sub folders.",
          inputSchema: objectInput("search_files", [
            ["path", "string", "Folder to start in", true],
            ["pattern", "string", "Pattern, like *.md", true],
          ]),
          enabled: true,
        },
        {
          name: "get_file_info",
          description: "Size, dates and type of a file or folder.",
          inputSchema: objectInput("get_file_info", [["path", "string", "Path of the file or folder", true]]),
          enabled: true,
        },
        {
          name: "write_file",
          description: "Create a new file or replace a file. Use with care.",
          inputSchema: objectInput("write_file", [
            ["path", "string", "Path of the file", true],
            ["content", "string", "Text to write", true],
          ]),
          enabled: true,
        },
      ],
    },
    remote: {
      serverName: "example-docs-server",
      serverVersion: "1.4.2",
      tools: [
        {
          name: "search_docs",
          description: "Search the team documentation.",
          inputSchema: objectInput("search_docs", [["query", "string", "Words to search for", true]]),
          enabled: true,
        },
        {
          name: "get_page",
          description: "Get one documentation page as Markdown.",
          inputSchema: objectInput("get_page", [["id", "string", "Page id", true]]),
          enabled: true,
        },
        {
          name: "list_spaces",
          description: "List the documentation spaces.",
          inputSchema: objectInput("list_spaces", []),
          enabled: true,
        },
      ],
    },
  };

/** Three generic tools for servers the user adds in the mock. */
export const GENERIC_MCP_TOOLS: McpToolSummary[] = [
  {
    name: "echo",
    description: "Return the text you send.",
    inputSchema: objectInput("echo", [["text", "string", "Text to echo", true]]),
    enabled: true,
  },
  {
    name: "get_time",
    description: "Current time on the server.",
    inputSchema: objectInput("get_time", []),
    enabled: true,
  },
  {
    name: "add",
    description: "Add two numbers.",
    inputSchema: objectInput("add", [
      ["a", "number", "First number", true],
      ["b", "number", "Second number", true],
    ]),
    enabled: true,
  },
];

export const SHORTCUTS = ["Make GIF", "Log Water", "Daily Summary"];

// ---------- files on the fake disk ----------

export const PERSON_SCHEMA = formatLikeFm({
  title: "Person",
  type: "object",
  properties: {
    name: { type: "string", description: "Full name" },
    age: { type: "integer" },
    email: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["name", "email", "tags"],
  "x-order": ["name", "age", "email", "tags"],
  additionalProperties: false,
});

export function seedFiles(): Record<string, string> {
  return {
    [`${HOME}/Documents/person-schema.json`]: PERSON_SCHEMA,
    [`${HOME}/Documents/notes.txt`]:
      "Team sync, Monday\n- Beta ships Friday\n- Two bugs block the release\n- Ada sends the test plan Wednesday\n",
    [`${HOME}/Downloads/standup-notes/SKILL.md`]:
      "---\nname: standup-notes\ndescription: Write a short daily standup update.\n---\n\n# Standup notes\n\nList yesterday, today and blockers. One line each.\n",
  };
}

// ---------- fm serve ----------

export function serveBanner(url: string): string[] {
  return [
    "Apple Foundation Models Serve",
    `  url    ${url}`,
    "  access loopback-only",
    "",
    "  · POST /v1/chat/completions",
    "  · GET  /v1/models",
    "  · GET  /health",
    "",
    `  · listening on ${url}  (press Ctrl+C to stop)`,
  ];
}

const REQUEST_LINES: string[] = [
  "[GET]  · /health · 200",
  "[POST] · /v1/chat/completions · 200 · system · 63→5 tokens · 737ms",
  "[GET]  · /v1/models · 200",
  "[POST] · /v1/chat/completions · 200 · system · 412→96 tokens · 2310ms",
  "[POST] · /v1/chat/completions · 200 · system · 128→31 tokens · 1104ms",
  "[POST] · /v1/chat/completions · 400 · system · json_object is not supported",
];

export const fakeRequestLine = (n: number, ms: number) => `${hhmmss(ms)} · ${REQUEST_LINES[n % REQUEST_LINES.length]}`;

/** A tiny valid 1x1 PNG, used when no canvas is available. */
export const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
