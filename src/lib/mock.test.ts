// Tests for the browser mock mode. Runs in plain Node (no jsdom): the pure
// helpers directly, and the full IPC path with `window` pointed at globalThis.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { respondArgs } from "./fmArgs";
import { installMocks, uninstallMocks } from "./mock";
import {
  countTokensFromArgs,
  evaluateMath,
  findExpression,
  formatLikeFm,
  parseRespondArgs,
  sampleFromSchema,
  schemaFromObjectArgs,
  splitForStream,
} from "./mockData";
import type { AgentEvent, LogLine, McpServerStatus, RunEvent } from "./types";

describe("schema object builder", () => {
  it("matches the shape fm prints for flat properties", () => {
    const r = schemaFromObjectArgs([
      "schema", "object", "--name", "Person",
      "--string", "name", "--description", "Full name",
      "--integer", "age", "--optional",
      "--string", "tags", "--array",
      "--boolean", "active",
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.schema).toEqual({
      title: "Person",
      type: "object",
      properties: {
        name: { type: "string", description: "Full name" },
        age: { type: "integer" },
        tags: { type: "array", items: { type: "string" } },
        active: { type: "boolean" },
      },
      required: ["name", "tags", "active"],
      "x-order": ["name", "age", "tags", "active"],
      additionalProperties: false,
    });
  });

  it("puts nested objects in $defs, after plain values (like fm 27.0.1)", () => {
    const r = schemaFromObjectArgs([
      "schema", "object", "--name", "Trip",
      "--string", "city",
      "--double", "budget", "--description", "Budget in USD",
      "--string", "address.street",
      "--integer", "address.number", "--optional",
      "--boolean", "flags", "--array",
    ]);
    if ("error" in r) throw new Error(r.error);
    const s = r.schema as Record<string, any>;
    expect(s["x-order"]).toEqual(["city", "budget", "flags", "address"]);
    expect(s.required).toEqual(["city", "budget", "flags", "address"]);
    expect(s.properties.address).toEqual({ $ref: "#/$defs/Address" });
    expect(s.properties.budget).toEqual({ type: "number", description: "Budget in USD" });
    expect(s.$defs.Address.required).toEqual(["street"]);
    expect(s.$defs.Address.additionalProperties).toBe(false);
  });

  it("reports bad input in simple words", () => {
    expect(schemaFromObjectArgs(["schema", "object", "--string", "a"])).toEqual({
      error: "Missing expected argument '--name <name>'",
    });
    expect("error" in schemaFromObjectArgs(["schema", "object", "--name", "A", "--wat", "x"])).toBe(true);
  });

  it("formats like fm and stays valid JSON", () => {
    const value = { a: "x/y", b: [1, "c: d"] };
    const text = formatLikeFm(value);
    expect(text).toContain('"a" : "x\\/y"');
    expect(text).toContain('"c: d"');
    expect(JSON.parse(text)).toEqual(value);
  });

  it("builds sample output that follows a schema", () => {
    const r = schemaFromObjectArgs(["--name", "P", "--string", "name", "--integer", "age", "--string", "home.city"]);
    if ("error" in r) throw new Error(r.error);
    expect(sampleFromSchema(r.schema)).toEqual({ name: "Ada Lovelace", age: 36, home: { city: "Lisbon" } });
  });
});

describe("streaming and parsing helpers", () => {
  it("splits text into word chunks without losing anything", () => {
    const text = "## Title\n\n1. **One** item\n2. Two  items\n";
    const chunks = splitForStream(text);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.join("")).toBe(text);
  });

  it("parses respond args built by respondArgs()", () => {
    const args = respondArgs({
      prompt: "-starts with a dash",
      instructions: "Be brief",
      textSegments: ["extra"],
      schema: "/tmp/s.json",
      stream: false,
      saveTranscriptPath: "/Users/ada/.fm/sessions/x.json",
    });
    const p = parseRespondArgs(args);
    expect(p.prompt).toBe("-starts with a dash");
    expect(p.instructions).toBe("Be brief");
    expect(p.texts).toEqual(["extra"]);
    expect(p.schema).toBe("/tmp/s.json");
    expect(p.noStream).toBe(true);
    expect(p.saveTranscript).toBe("/Users/ada/.fm/sessions/x.json");
  });

  it("counts tokens like fm for plain text and copies the image bug", () => {
    // Real `fm count-tokens --quiet` says 9 for this sentence.
    expect(countTokensFromArgs(["count-tokens", "--quiet", "--", "Hello there, how are you today?"], () => undefined)).toEqual({
      tokens: 9,
    });
    const img = countTokensFromArgs(["count-tokens", "--image", "/a.png", "--", "hi"], () => undefined);
    expect("error" in img && img.error).toContain("error 1001");
  });

  it("evaluates math safely", () => {
    expect(evaluateMath("(2400 - 1650) * 12")).toBe(9000);
    expect(evaluateMath("2 + 3 * 4")).toBe(14);
    expect(evaluateMath("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluateMath("2,400 + 1")).toBe(2401);
    expect(() => evaluateMath("alert(1)")).toThrow();
    expect(findExpression("What is 12 * 7?")).toBe("12 * 7");
  });
});

describe("mock backend through the real api.ts", () => {
  beforeAll(() => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    vi.spyOn(console, "info").mockImplementation(() => {});
    installMocks({ scenario: "default", timeScale: 0 });
  });

  afterAll(() => {
    uninstallMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("looks like Tauri and returns config, paths and status", async () => {
    expect(api.isTauri()).toBe(true);
    const config = await api.getConfig();
    expect(config.setupCompleted).toBe(true);
    expect(config.customTools).toHaveLength(2);
    expect(config.mcpServers.map((s) => s.name)).toEqual(["Filesystem", "Remote HTTP"]);
    const status = await api.fmStatus();
    expect(status.licenseAgreed).toBe(true);
    expect(status.licenseMessage).toMatch(/^Agreed to license FM1/);
    const saved = await api.saveConfig({ ...config, contextSize: 4096 });
    expect(saved.contextSize).toBe(4096);
    expect((await api.getConfig()).contextSize).toBe(4096);
    expect((await api.getPaths()).cliSessionsDir).toBe("/Users/ada/.fm/sessions");
  });

  it("streams fm respond through the Channel", async () => {
    const events: RunEvent[] = [];
    const result = await api.fmRun(respondArgs({ prompt: "Write a haiku about a Mac" }), (e) => events.push(e));
    expect(events[0]).toEqual({ kind: "started", command: "fm respond -- 'Write a haiku about a Mac'" });
    const stdout = events.filter((e) => e.kind === "stdout");
    expect(stdout.length).toBeGreaterThan(5);
    expect(stdout.map((e) => (e.kind === "stdout" ? e.text : "")).join("")).toBe(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("quiet Mac");
  });

  it("runs count-tokens, schema object and available", async () => {
    const count = await api.fmRun(["count-tokens", "--quiet", "--", "Hello there, how are you today?"], () => {});
    expect(count.stdout.trim()).toBe("9");
    const schema = await api.fmRun(["schema", "object", "--name", "Dog", "--string", "breed", "--boolean", "friendly"], () => {});
    expect(JSON.parse(schema.stdout).title).toBe("Dog");
    expect(schema.stdout).toContain('"title" : "Dog"');
    expect((await api.fmRun(["available"], () => {})).stdout).toBe("System model available\n");
  });

  it("runs a chat turn with tools, an approval and streamed deltas", async () => {
    const chat = await api.chatCreate();
    const events: AgentEvent[] = [];
    const message = await api.chatSend(chat.id, "What is 12 * 7? Then read https://example.com/tips.", [], (e) => {
      events.push(e);
      if (e.type === "approvalRequired") void api.approvalRespond(e.approvalId, "allow");
    });
    const types = events.map((e) => e.type);
    expect(types.slice(0, 3)).toEqual(["userMessage", "assistantStart", "status"]);
    expect(types).toContain("approvalRequired");
    expect(types.slice(-2)).toEqual(["context", "done"]);
    const deltas = events.flatMap((e) => (e.type === "delta" ? [e.text] : []));
    expect(deltas.join("")).toBe(message.text);
    expect(message.steps.map((s) => [s.toolName, s.status])).toEqual([
      ["calculator", "done"],
      ["fetch_url", "done"],
    ]);
    expect(message.steps[0].result).toBe("84");
    const saved = await api.chatGet(chat.id);
    expect(saved.messages).toHaveLength(2);
    expect(saved.title).toBe("What is 12 * 7? Then");
  });

  it("lists chats, sessions, tools, skills and MCP servers", async () => {
    const chats = await api.chatsList();
    expect(chats.length).toBe(4);
    const budget = await api.chatGet("chat-budget");
    expect(budget.messages[1].steps.map((s) => s.toolName)).toEqual(["calculator", "fetch_url", "use_skill"]);
    const sessions = await api.cliSessionsList();
    expect(sessions.map((s) => s.name)).toEqual(["trip-packing-list", "swift-concurrency-tips", "hello-friend"]);
    expect((await api.cliSessionRead("hello-friend")).messages).toHaveLength(4);
    const tools = await api.toolsCatalog();
    expect(tools.filter((t) => t.source === "builtin")).toHaveLength(11);
    expect(tools.filter((t) => t.source === "mcp").map((t) => t.name)).toContain("filesystem_read_text_file");
    expect(tools.find((t) => t.name === "use_skill")).toBeTruthy();
    expect(tools.every((t) => t.tokenEstimate > 0)).toBe(true);
    expect((await api.skillsList()).map((s) => s.name)).toEqual(["email-writer", "explain-like-ten", "meeting-notes"]);
    const test = await api.toolTest("builtin:calculator", { expression: "6 * 7" });
    expect(test).toMatchObject({ ok: true, output: "42" });
    expect(await api.whichCommand("uvx")).toBeNull();
    expect(await api.whichCommand("npx")).toBe("/opt/homebrew/bin/npx");
  });

  it("emits mcp-status events to listen() and unlisten works", async () => {
    const seen: McpServerStatus[][] = [];
    const unlisten = await api.onMcpStatus((s) => seen.push(s));
    const before = await api.mcpStatuses();
    expect(before.find((s) => s.id === "remote")?.state).toBe("error");
    const after = await api.mcpConnect("remote");
    expect(after.find((s) => s.id === "remote")?.state).toBe("connected");
    expect(seen.map((s) => s.find((x) => x.id === "remote")?.state)).toEqual(["connecting", "connected"]);
    unlisten();
    await api.mcpDisconnect("remote");
    expect(seen).toHaveLength(2);
  });

  it("starts the API server, logs lines, answers requests and stops", async () => {
    const lines: LogLine[] = [];
    const unlisten = await api.onPublicServerLog((l) => lines.push(l));
    const config = (await api.getConfig()).publicServer;
    const status = await api.publicServerStart(config);
    expect(status).toMatchObject({ running: true, url: "http://127.0.0.1:1976" });
    expect(status.command).toBe("fm serve --host 127.0.0.1 --port 1976");
    const health = await api.publicServerRequest("GET", "/health");
    expect(JSON.parse(health.body).status).toBe("fm serve is running");
    const chat = await api.publicServerRequest(
      "POST",
      "/v1/chat/completions",
      JSON.stringify({ model: "system", stream: false, messages: [{ role: "user", content: "hi" }] }),
    );
    expect(JSON.parse(chat.body).choices[0].message.content).toMatch(/^Hello!/);
    const missing = await api.publicServerRequest("GET", "/nope");
    expect(missing.status).toBe(404);
    expect(lines.some((l) => l.line.includes("listening on http://127.0.0.1:1976"))).toBe(true);
    expect(lines.some((l) => / · \[POST\] · \/v1\/chat\/completions · 200 · system · \d+→\d+ tokens · \d+ms$/.test(l.line))).toBe(true);
    expect((await api.publicServerStop()).running).toBe(false);
    unlisten();
  });
});

describe("nolicense scenario", () => {
  beforeAll(() => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    vi.spyOn(console, "info").mockImplementation(() => {});
    installMocks({ scenario: "nolicense", timeScale: 0 });
  });

  afterAll(() => {
    uninstallMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("shows the setup wizard state and fails respond with exit 69", async () => {
    expect((await api.getConfig()).setupCompleted).toBe(false);
    expect((await api.fmStatus()).licenseAgreed).toBe(false);
    const r = await api.fmRun(["respond", "--", "hi"], () => {});
    expect(r.exitCode).toBe(69);
    expect(r.error).toMatch(/license/);
    expect(await api.fmLicenseText()).toMatch(/^LEGAL NOTICE & TERMS/);
  });
});
