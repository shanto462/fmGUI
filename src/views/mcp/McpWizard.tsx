// "Add MCP server" / "Edit MCP server" wizard. OWNER: agent "ui-extend".

import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleCheck, CircleX, RefreshCw, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Callout,
  CodeBlock,
  CommandPreview,
  Field,
  Meter,
  Modal,
  Segmented,
  Spinner,
  Steps,
  TextInput,
  Toggle,
  formatDuration,
  formatNumber,
} from "../../components/ui";
import { errorMessage, mcpTest, newId, openInTerminal, whichCommand } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { Approval, KeyValue, McpServerConfig, McpTestResult, McpToolSummary, McpTransport } from "../../lib/types";
import {
  ApprovalChoice,
  Block,
  ChoiceCard,
  FolderField,
  KeyValueEditor,
  StringListEditor,
  Tile,
  shellQuote,
  tokensLabel,
  toolTokenEstimate,
} from "../tools/shared";
import { MCP_TEMPLATES, REQUIREMENTS, argsWithFolder, templateCommand, type McpTemplate, type Requirement } from "./templates";

const STEPS = ["Server", "Requirements", "Configure", "Test", "Tools", "Save"];

interface Draft {
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  env: KeyValue[];
  cwd: string;
  url: string;
  headers: KeyValue[];
  folder: string;
  disabledTools: string[];
  approval: Approval;
}

type CheckState = { state: "checking" } | { state: "found"; path: string } | { state: "missing" } | { state: "error"; error: string };

export const mcpToolTokens = (t: McpToolSummary) => toolTokenEstimate(t.inputSchema, t.description);

export function transportLine(t: McpTransport): string {
  return t.type === "http" ? t.url : [t.command, ...t.args].map(shellQuote).join(" ");
}

function draftFromConfig(c: McpServerConfig): Draft {
  const t = c.transport;
  return {
    name: c.name,
    transport: t.type,
    command: t.type === "stdio" ? t.command : "",
    args: t.type === "stdio" ? [...t.args] : [],
    env: t.type === "stdio" ? t.env.map((e) => ({ ...e })) : [],
    cwd: t.type === "stdio" ? (t.cwd ?? "") : "",
    url: t.type === "http" ? t.url : "",
    headers: t.type === "http" ? t.headers.map((h) => ({ ...h })) : [],
    folder: "",
    disabledTools: [...c.disabledTools],
    approval: c.approval,
  };
}

function uniqueServerName(base: string, taken: string[]): string {
  if (!base || !taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
  return base;
}

function tipsFor(text: string, stdio: boolean): string[] {
  const t = text.toLowerCase();
  const tips: string[] = [];
  if (/not found|enoent|no such file|command not found/.test(t))
    tips.push("The program was not found. Go back to Requirements, or use the full path of the command (for example /opt/homebrew/bin/npx).");
  if (/timed out|timeout/.test(t))
    tips.push("The server took too long to answer. The first run downloads the package, so try again.");
  if (/401|403|unauthori[sz]ed|forbidden/.test(t)) tips.push("The server refused the request. Check the Authorization header or token.");
  if (/404/.test(t)) tips.push("Check the URL. Many servers use a path that ends in /mcp.");
  if (/eacces|permission denied|operation not permitted/.test(t))
    tips.push("macOS blocked access. Check the folder permissions, or allow fmGUI in System Settings > Privacy & Security.");
  if (/not a git repository|\.git/.test(t)) tips.push("The folder must be a Git repository (it has a .git folder).");
  if (/not implemented/.test(t)) tips.push("This part of fmGUI is not ready yet. Try again after an update.");
  if (tips.length === 0)
    tips.push(
      stdio
        ? "Check the command and arguments. Run it in Terminal to see the full error."
        : "Check the URL and headers, and that the server is online.",
    );
  return tips;
}

export function McpWizard(props: {
  editing: McpServerConfig | null;
  /** Tools of the server being edited, from its live status. */
  knownTools?: McpToolSummary[];
  takenNames: string[];
  /** Tokens already used by other tools and skills. */
  baseTokens: number;
  contextSize: number;
  onClose: () => void;
  onSaved: (server: McpServerConfig) => void;
}) {
  const updateConfig = useApp((s) => s.updateConfig);
  const toast = useApp((s) => s.toast);
  const editing = props.editing;

  const [step, setStep] = useState(editing ? 2 : 0);
  const [template, setTemplate] = useState<McpTemplate | null>(() =>
    editing ? (MCP_TEMPLATES.find((t) => t.id === (editing.transport.type === "http" ? "remote" : "custom")) ?? null) : null,
  );
  const [draft, setDraft] = useState<Draft>(() =>
    editing
      ? draftFromConfig(editing)
      : { name: "", transport: "stdio", command: "", args: [], env: [], cwd: "", url: "", headers: [], folder: "", disabledTools: [], approval: "ask" },
  );
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  // ---------- requirements ----------
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [brew, setBrew] = useState<CheckState | null>(null);

  const reqNames: string[] = useMemo(() => {
    if (template && template.needs.length) return template.needs;
    if (draft.transport === "stdio" && draft.command.trim() && !draft.command.includes("/")) return [draft.command.trim()];
    return [];
  }, [template, draft.transport, draft.command]);

  const runChecks = async () => {
    const names = reqNames;
    setChecks(Object.fromEntries(names.map((n) => [n, { state: "checking" } as CheckState])));
    setBrew(null);
    const results = await Promise.all(
      names.map(async (n): Promise<[string, CheckState]> => {
        try {
          const path = await whichCommand(n);
          return [n, path ? { state: "found", path } : { state: "missing" }];
        } catch (err) {
          return [n, { state: "error", error: errorMessage(err) }];
        }
      }),
    );
    setChecks(Object.fromEntries(results));
    if (results.some(([, r]) => r.state === "missing")) {
      try {
        const path = await whichCommand("brew");
        setBrew(path ? { state: "found", path } : { state: "missing" });
      } catch (err) {
        setBrew({ state: "error", error: errorMessage(err) });
      }
    }
  };

  useEffect(() => {
    if (step === 1) runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ---------- build ----------
  const buildTransport = (): McpTransport =>
    draft.transport === "http"
      ? { type: "http", url: draft.url.trim(), headers: draft.headers.filter((h) => h.key.trim() && h.value.trim()).map((h) => ({ key: h.key.trim(), value: h.value })) }
      : {
          type: "stdio",
          command: draft.command.trim(),
          args: draft.args.filter((a) => a.trim() !== ""),
          env: draft.env.filter((e) => e.key.trim()).map((e) => ({ key: e.key.trim(), value: e.value })),
          cwd: draft.cwd.trim() || null,
        };

  const buildConfig = (id: string): McpServerConfig => ({
    id,
    name: draft.name.trim(),
    enabled: editing?.enabled ?? true,
    transport: buildTransport(),
    disabledTools: draft.disabledTools,
    approval: draft.approval,
  });

  const sig = JSON.stringify(buildTransport());

  // ---------- test ----------
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<McpTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testedSig, setTestedSig] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<number | null>(null);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    setTestError(null);
    setElapsed(0);
    const started = Date.now();
    timer.current = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    try {
      const r = await mcpTest(buildConfig(newId()));
      setResult(r);
      setTestedSig(sig);
    } catch (err) {
      setTestError(errorMessage(err));
      setTestedSig(sig);
    } finally {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
      setTesting(false);
    }
  };

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
  }, []);

  useEffect(() => {
    if (step === 3 && testedSig !== sig && !testing) runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const tools: McpToolSummary[] = result?.ok ? result.tools : (props.knownTools ?? []);

  // ---------- validation ----------
  const nameError = !draft.name.trim()
    ? "Give the server a name."
    : props.takenNames.includes(draft.name.trim())
      ? "Another server already uses this name."
      : null;
  const configError = (() => {
    if (nameError) return nameError;
    if (draft.transport === "stdio") {
      if (!draft.command.trim()) return "Enter the command that starts the server.";
      if (template?.folder && !editing && !draft.folder.trim()) return `Choose the ${template.folder.label.toLowerCase()}.`;
    } else if (!/^https?:\/\/\S+$/.test(draft.url.trim())) return "Enter a URL that starts with https:// or http://.";
    return null;
  })();
  const stepError = [
    template ? null : "Pick a server to continue.",
    null,
    configError,
    testing ? "Testing…" : result?.ok ? null : "The test must pass first.",
    null,
    null,
  ][step];

  // ---------- actions ----------
  const pickTemplate = (t: McpTemplate) => {
    setTemplate(t);
    setDraft((d) => ({
      ...d,
      name: uniqueServerName(t.name, props.takenNames),
      transport: t.transport,
      command: t.command,
      args: argsWithFolder(t, ""),
      env: [],
      cwd: "",
      url: t.url ?? "",
      headers: (t.headers ?? []).map((h) => ({ ...h })),
      folder: "",
      disabledTools: [],
    }));
    setResult(null);
    setTestedSig(null);
  };

  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const id = editing?.id ?? newId();
      const server = buildConfig(id);
      const saved = await updateConfig((d) => {
        const i = d.mcpServers.findIndex((s) => s.id === id);
        if (i >= 0) d.mcpServers[i] = server;
        else d.mcpServers.push(server);
      });
      if (saved) {
        toast(editing ? `Saved "${server.name}".` : `Added "${server.name}". Connecting…`, "success");
        props.onSaved(server);
      }
    } finally {
      setSaving(false);
    }
  };

  const terminalCommand = () => {
    const t = buildTransport();
    if (t.type !== "stdio") return "";
    const line = transportLine(t);
    return t.cwd ? `cd ${shellQuote(t.cwd)} && ${line}` : line;
  };

  const runInTerminal = async (command: string) => {
    try {
      await openInTerminal(command);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  // ---------- steps ----------
  let body: ReactNode;
  if (step === 0) {
    body = (
      <div className="stack" style={{ gap: 16 }}>
        <Callout>
          <b>What is MCP?</b> The Model Context Protocol is an open standard for tool servers. A server is a small program
          that gives the model new tools, like reading files or fetching web pages.
        </Callout>
        <div className="ext-choices">
          {MCP_TEMPLATES.map((t) => (
            <ChoiceCard
              key={t.id}
              icon={<Tile tone={t.tone}>{t.icon}</Tile>}
              title={t.title}
              selected={template?.id === t.id}
              onClick={() => pickTemplate(t)}
              description={t.description}
              code={t.id === "custom" ? "your-command --flag" : templateCommand(t)}
              badge={
                t.needs.includes("node") ? (
                  <Badge>Node.js</Badge>
                ) : t.needs.includes("uvx") ? (
                  <Badge>uv</Badge>
                ) : t.transport === "http" ? (
                  <Badge>Web</Badge>
                ) : undefined
              }
            />
          ))}
        </div>
      </div>
    );
  } else if (step === 1) {
    body = (
      <div className="stack" style={{ gap: 14 }}>
        {reqNames.length === 0 ? (
          <Callout tone="success">
            {draft.transport === "http"
              ? "A remote server runs on the web. There is nothing to install on this Mac."
              : "Nothing to check yet. We check your command when you test the connection."}
          </Callout>
        ) : (
          <>
            <p className="ext-lead" style={{ margin: 0 }}>
              This server needs a few programs on your Mac. fmGUI looks for them in your login shell PATH.
            </p>
            <div className="group">
              {reqNames.map((n) => {
                const info = REQUIREMENTS[n as Requirement];
                const c = checks[n] ?? { state: "checking" };
                return (
                  <div key={n} className="group__row ext-row">
                    <span style={{ paddingTop: 2 }}>
                      {c.state === "checking" ? (
                        <Spinner />
                      ) : c.state === "found" ? (
                        <CircleCheck size={18} color="var(--green)" />
                      ) : (
                        <CircleX size={18} color={c.state === "missing" ? "var(--red)" : "var(--orange)"} />
                      )}
                    </span>
                    <div className="ext-row__main">
                      <div className="ext-row__title">
                        {info?.label ?? n}
                        <span className="ext-name">{n}</span>
                      </div>
                      {info && <div className="ext-row__desc">{info.why}</div>}
                      {c.state === "found" && <div className="xsmall mono muted">{c.path}</div>}
                      {c.state === "error" && <div className="xsmall" style={{ color: "var(--orange)" }}>Could not check: {c.error}</div>}
                      {c.state === "missing" && (
                        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                          <div className="small" style={{ color: "var(--red)" }}>
                            Not found.{" "}
                            {info ? "Install it with this command in Terminal:" : "Install it, or use the full path of the program in the next step."}
                          </div>
                          {info && (
                            <div className="row">
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <CommandPreview command={info.install} />
                              </div>
                              <Button size="sm" icon={<SquareTerminal size={13} />} onClick={() => runInTerminal(info.install)}>
                                Open in Terminal
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {brew?.state === "missing" && (
              <Callout tone="warning">
                The install commands use Homebrew, and Homebrew is not installed. Install it first from{" "}
                <button type="button" className="ext-link" onClick={() => openUrl("https://brew.sh").catch((e) => toast(errorMessage(e), "error"))}>
                  brew.sh
                </button>
                , then run the command above.
              </Callout>
            )}
            <div className="row">
              <Button icon={<RefreshCw size={13} />} onClick={runChecks}>
                Re-check
              </Button>
              <span className="xsmall muted">
                Installed it just now? Click Re-check. If it is still not found, restart fmGUI.
              </span>
            </div>
            {Object.values(checks).some((c) => c.state === "missing") && (
              <div className="small muted">You can continue, but the server will not start until everything is installed.</div>
            )}
          </>
        )}
      </div>
    );
  } else if (step === 2) {
    body = (
      <div className="stack" style={{ gap: 16 }}>
        <Field label="Name" error={draft.name && nameError ? nameError : undefined} hint="Shown in the app, for example Filesystem.">
          <TextInput value={draft.name} autoFocus placeholder="My server" onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Block label="Connection">
          <div>
            <Segmented<"stdio" | "http">
              value={draft.transport}
              onChange={(transport) => patch({ transport })}
              options={[
                { value: "stdio", label: "Command on this Mac" },
                { value: "http", label: "Remote URL" },
              ]}
            />
          </div>
        </Block>
        {draft.transport === "stdio" ? (
          <>
            {template?.folder && (
              <Block label={template.folder.label} hint={template.folder.hint}>
                <FolderField
                  value={draft.folder}
                  title={`Choose the ${template.folder.label.toLowerCase()}`}
                  onError={(m) => toast(m, "error")}
                  onChange={(folder) => patch({ folder, args: argsWithFolder(template, folder) })}
                />
              </Block>
            )}
            <Field label="Command" hint="The program that starts the server, for example npx or uvx. A full path also works.">
              <TextInput className="mono" value={draft.command} placeholder="npx" onChange={(e) => patch({ command: e.target.value })} />
            </Field>
            <Block label="Arguments" hint="One per row. No quotes needed, even when a path has spaces.">
              <StringListEditor
                items={draft.args}
                onChange={(args) => patch({ args })}
                placeholder="-y"
                addLabel="Add argument"
                folderPicker
                onError={(m) => toast(m, "error")}
              />
            </Block>
            <Block
              label="Environment variables"
              hint="Optional. For example an API key the server needs. Values are saved in plain text in the app's config file."
            >
              <KeyValueEditor rows={draft.env} onChange={(env) => patch({ env })} keyPlaceholder="API_KEY" valuePlaceholder="value" addLabel="Add variable" monoKeys />
            </Block>
            <Block label="Working folder" hint="Optional. Leave empty for the default.">
              <FolderField value={draft.cwd} onChange={(cwd) => patch({ cwd })} title="Choose the working folder" onError={(m) => toast(m, "error")} />
            </Block>
            {draft.command.trim() && (
              <Block label="The command fmGUI will run">
                <CommandPreview command={transportLine(buildTransport())} />
              </Block>
            )}
          </>
        ) : (
          <>
            <Field label="Server URL" hint="The Streamable HTTP endpoint, often ending in /mcp.">
              <TextInput className="mono" value={draft.url} placeholder="https://example.com/mcp" onChange={(e) => patch({ url: e.target.value })} />
            </Field>
            <Block label="Headers" hint="Optional. Many servers need a token, for example Authorization: Bearer <token>.">
              <KeyValueEditor
                rows={draft.headers}
                onChange={(headers) => patch({ headers })}
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer <token>"
                addLabel="Add header"
                monoKeys
              />
            </Block>
            <Callout tone="warning">Tokens are saved in plain text in the app's config file. Only use tokens you trust this Mac with.</Callout>
          </>
        )}
      </div>
    );
  } else if (step === 3) {
    const errText = testError ?? (result && !result.ok ? (result.error ?? "The server did not answer.") : null);
    body = (
      <div className="stack" style={{ gap: 14 }}>
        {testing && (
          <div className="card">
            <div className="row">
              <Spinner />
              <b>Starting the server and asking for its tools…</b>
              <div className="spacer" />
              <span className="small muted">{elapsed} s</span>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {draft.transport === "stdio"
                ? "The first run of npx or uvx downloads the package. This can take a minute. Please wait."
                : "Connecting to the remote server."}
            </div>
          </div>
        )}
        {!testing && result?.ok && (
          <>
            <Callout tone="success">
              Connected to <b>{result.serverName ?? draft.name}</b>
              {result.serverVersion ? ` ${result.serverVersion}` : ""} in {formatDuration(result.durationMs)}. It offers{" "}
              {result.tools.length} {result.tools.length === 1 ? "tool" : "tools"}.
            </Callout>
            {result.tools.length > 0 && (
              <div className="row row--wrap" style={{ gap: 6 }}>
                {result.tools.map((t) => (
                  <Badge key={t.name} title={t.description}>
                    {t.name}
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}
        {!testing && errText && (
          <>
            <Callout tone="error">
              <b>The connection failed.</b> {errText}
            </Callout>
            <div className="card">
              <div className="ext-h">Tips</div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {tipsFor(`${errText}\n${(result?.stderrTail ?? []).join("\n")}`, draft.transport === "stdio").map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            {result && result.stderrTail.length > 0 && (
              <Block label="What the server printed (last lines)">
                <CodeBlock code={result.stderrTail.join("\n")} wrap maxHeight={200} />
              </Block>
            )}
          </>
        )}
        {!testing && (
          <div className="row">
            <Button icon={<RefreshCw size={13} />} onClick={runTest}>
              {result || testError ? "Test again" : "Test connection"}
            </Button>
            {draft.transport === "stdio" && (result?.ok === false || testError) && (
              <Button icon={<SquareTerminal size={13} />} onClick={() => runInTerminal(terminalCommand())}>
                Run in Terminal
              </Button>
            )}
          </div>
        )}
      </div>
    );
  } else if (step === 4) {
    const enabledTools = tools.filter((t) => !draft.disabledTools.includes(t.name));
    const serverTokens = enabledTools.reduce((s, t) => s + mcpToolTokens(t), 0);
    const total = props.baseTokens + serverTokens;
    const ratio = total / props.contextSize;
    const setOn = (name: string, on: boolean) =>
      patch({ disabledTools: on ? draft.disabledTools.filter((n) => n !== name) : [...new Set([...draft.disabledTools, name])] });
    body = (
      <div className="stack" style={{ gap: 14 }}>
        <p className="ext-lead" style={{ margin: 0 }}>
          Every enabled tool adds tokens to every request, and the on-device model has a small context. Turn on only the
          tools you need.
        </p>
        {template?.note && <Callout tone="warning">{template.note}</Callout>}
        {tools.length === 0 ? (
          <div className="card small muted">No tools to choose. You can choose them later on the MCP Servers page.</div>
        ) : (
          <>
            <div className="row">
              <span className="small muted">
                {enabledTools.length} of {tools.length} on
              </span>
              <div className="spacer" />
              <Button size="sm" onClick={() => patch({ disabledTools: [] })}>
                Turn all on
              </Button>
              <Button size="sm" onClick={() => patch({ disabledTools: tools.map((t) => t.name) })}>
                Turn all off
              </Button>
            </div>
            <div className="group" style={{ maxHeight: 300, overflowY: "auto" }}>
              {tools.map((t) => {
                const on = !draft.disabledTools.includes(t.name);
                return (
                  <div key={t.name} className={on ? "group__row ext-row" : "group__row ext-row ext-row--off"}>
                    <div className="ext-row__main">
                      <div className="ext-row__title mono">{t.name}</div>
                      {t.description && <div className="ext-row__desc">{t.description}</div>}
                      <div className="ext-row__meta">{tokensLabel(mcpToolTokens(t))}</div>
                    </div>
                    <Toggle checked={on} onChange={(v) => setOn(t.name, v)} label={t.name} />
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="card ext-budget">
          <div className="row small">
            <span>
              This server: <b>{formatNumber(serverTokens)}</b> tokens. With your other tools and skills:{" "}
              <b>{formatNumber(total)}</b> of {formatNumber(props.contextSize)} ({Math.round(ratio * 100)}%).
            </span>
          </div>
          <Meter value={ratio} />
          {ratio >= 0.25 && (
            <Callout tone={ratio >= 0.5 ? "error" : "warning"}>
              That is a lot of the context. Turn off tools you do not need so chats have room.
            </Callout>
          )}
        </div>
      </div>
    );
  } else {
    const t = buildTransport();
    const on = tools.filter((x) => !draft.disabledTools.includes(x.name)).length;
    body = (
      <div className="stack" style={{ gap: 16 }}>
        <div>
          <div className="ext-h">When the model wants to use a tool from this server</div>
          <ApprovalChoice value={draft.approval} onChange={(approval) => patch({ approval })} recommendAsk />
        </div>
        <div className="card">
          <dl className="ext-summary" style={{ margin: 0 }}>
            <dt>Name</dt>
            <dd>{draft.name}</dd>
            <dt>{t.type === "http" ? "URL" : "Command"}</dt>
            <dd className="mono">{transportLine(t)}</dd>
            <dt>Tools</dt>
            <dd>{tools.length ? `${on} of ${tools.length} on` : "Choose them after it connects"}</dd>
          </dl>
        </div>
        <div className="small muted">After you save, fmGUI connects to the server. Its tools show up on the Tools page.</div>
      </div>
    );
  }

  return (
    <Modal
      wide
      title={editing ? `Edit "${editing.name}"` : "Add MCP server"}
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <div className="spacer" />
          {stepError && step > 0 && step !== 3 && <span className="xsmall" style={{ color: "var(--red)" }}>{stepError}</span>}
          {step === 3 && !testing && !result?.ok && (
            <Button variant="plain" onClick={() => setStep(5)}>
              Skip and save anyway
            </Button>
          )}
          {step > 0 && (
            <Button onClick={() => setStep(step - 1)} disabled={testing}>
              Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" disabled={!!stepError} onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" loading={saving} onClick={save}>
              {editing ? "Save changes" : "Save and connect"}
            </Button>
          )}
        </>
      }
    >
      <div className="ext-wizard">
        <Steps steps={STEPS} current={step} />
        {body}
      </div>
    </Modal>
  );
}
