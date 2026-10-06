// API Server: run a user-facing `fm serve` that other apps can use (OpenAI-style
// Chat Completions).
// Left: status, settings (saved to config.publicServer), endpoints.
// Right: live logs, "Try it", code snippets, compatibility notes.

import { Copy, Eraser, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  CodeBlock,
  CommandPreview,
  CopyButton,
  Field,
  Page,
  PathInput,
  Segmented,
  StatusDot,
  TextInput,
  Toggle,
} from "../components/ui";
import {
  errorMessage,
  onPublicServerLog,
  onPublicServerState,
  publicServerStart,
  publicServerStatus,
  publicServerStop,
} from "../lib/api";
import { DEFAULT_FM_PATH, displayCommand, serveArgs } from "../lib/fmArgs";
import { formatUptime } from "../lib/format";
import { useTicker } from "../lib/hooks";
import { joinPath, tildePath, tildeText } from "../lib/paths";
import { useApp } from "../lib/store";
import type { LogLine, PublicServerConfig, PublicServerStatus } from "../lib/types";
import { InspectorRow, InspectorSection, Toolbar, Workbench } from "./playground/workbench";
import { LogPanel } from "./server/LogPanel";
import { COMPAT, ENDPOINTS, endpointCopyText, snippetsFor, type CompatStatus, type Target } from "./server/snippets";
import { TryRequest } from "./server/TryRequest";
import "./server/server.css";

type Tab = "logs" | "try" | "code" | "compat";
const COMPAT_BADGE: Record<CompatStatus, { tone: "green" | "red" | "orange" | "accent"; label: string }> = {
  works: { tone: "green", label: "Works" },
  rejected: { tone: "red", label: "Rejected" },
  ignored: { tone: "orange", label: "Ignored" },
  note: { tone: "accent", label: "Note" },
};
const MAX_LOGS = 2000;
const OPEN_HOSTS = ["0.0.0.0", "::", "[::]"];

function clientHost(host: string): string {
  const h = host.trim();
  if (!h || OPEN_HOSTS.includes(h)) return "127.0.0.1";
  if (h.includes(":") && !h.startsWith("[")) return `[${h}]`;
  return h;
}

/** Does the running server listen where these settings say? */
function sameListener(a: PublicServerConfig, b: PublicServerConfig): boolean {
  if (a.mode !== b.mode) return false;
  return a.mode === "socket" ? a.socketPath === b.socketPath : a.host === b.host && a.port === b.port;
}

/** Best guess of the running settings from the status (page opened while running). */
function listenerFromStatus(s: PublicServerStatus, fallback: PublicServerConfig): PublicServerConfig | null {
  if (s.socketPath) return { ...fallback, mode: "socket", socketPath: s.socketPath };
  if (!s.url) return null;
  try {
    const u = new URL(s.url);
    return { ...fallback, mode: "tcp", host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port) || 80 };
  } catch {
    return null;
  }
}

function parsePort(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1 && n <= 65535 ? n : null;
}

export default function ServerView() {
  const config = useApp((s) => s.config);
  const paths = useApp((s) => s.paths);
  const home = paths?.homeDir;
  const updateConfig = useApp((s) => s.updateConfig);
  const toast = useApp((s) => s.toast);
  const fmPath = config?.fmPath || DEFAULT_FM_PATH;
  const defaultSocket = joinPath(paths?.dataDir ?? "~/Library/Application Support/fmGUI", "fm.sock");

  const saved = config?.publicServer;
  const [draft, setDraft] = useState<PublicServerConfig>(
    () => saved ?? { mode: "tcp", host: "127.0.0.1", port: 1976, socketPath: "", autostart: false },
  );
  const [portText, setPortText] = useState(String(draft.port));
  const [status, setStatus] = useState<PublicServerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  /** Settings the server was started with from this page. */
  const [startedWith, setStartedWith] = useState<PublicServerConfig | null>(null);
  const [tab, setTab] = useState<Tab>("logs");
  const [snippetId, setSnippetId] = useState("curl");

  const port = parsePort(portText);
  const hostOk = draft.host.trim().length > 0;
  const effective: PublicServerConfig = {
    ...draft,
    host: draft.host.trim(),
    port: port ?? draft.port,
    socketPath: draft.socketPath.trim() || defaultSocket,
  };
  const valid = draft.mode === "socket" ? true : hostOk && port != null;

  // Save settings shortly after a change.
  useEffect(() => {
    if (!valid) return;
    const next = { ...draft, host: draft.host.trim(), port: port ?? draft.port };
    if (JSON.stringify(next) === JSON.stringify(useApp.getState().config?.publicServer)) return;
    const t = setTimeout(() => {
      updateConfig((c) => {
        c.publicServer = next;
      });
    }, 500);
    return () => clearTimeout(t);
  }, [draft, port, valid, updateConfig]);

  // Status, logs and live events.
  useEffect(() => {
    let alive = true;
    const unlisten: (() => void)[] = [];
    publicServerStatus()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        setStatusError(null);
        // Keep lines that arrived as events before this answer.
        setLogs((prev) => [...s.logs.filter((l) => !prev.length || l.ts < prev[0].ts), ...prev].slice(-MAX_LOGS));
      })
      .catch((err) => alive && setStatusError(errorMessage(err)));
    // Live events are optional: the poll below keeps the status fresh without them.
    onPublicServerLog((line) => alive && setLogs((prev) => [...prev, line].slice(-MAX_LOGS)))
      .then((u) => (alive ? unlisten.push(u) : u()))
      .catch(() => {});
    onPublicServerState((s) => alive && setStatus(s))
      .then((u) => (alive ? unlisten.push(u) : u()))
      .catch(() => {});
    // Fallback poll, in case an event is missed. The first call above shows its error.
    const poll = setInterval(() => {
      publicServerStatus()
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    }, 4000);
    return () => {
      alive = false;
      clearInterval(poll);
      unlisten.forEach((u) => u());
    };
  }, []);

  const running = !!status?.running;
  const now = useTicker(running, 1000);
  const startedMs = status?.startedAt ? (status.startedAt < 1e12 ? status.startedAt * 1000 : status.startedAt) : null;

  const target: Target = useMemo(
    () => ({
      mode: effective.mode,
      baseUrl: `http://${clientHost(effective.host)}:${effective.port}`,
      socketPath: effective.socketPath,
    }),
    [effective.mode, effective.host, effective.port, effective.socketPath],
  );
  const snippets = snippetsFor(target);
  const snippet = snippets.find((s) => s.id === snippetId) ?? snippets[0];

  const command = displayCommand(serveArgs(effective), fmPath);
  const isOpenHost = effective.mode === "tcp" && OPEN_HOSTS.includes(effective.host);
  // Settings changed while running?
  const runningListener = status?.running ? (startedWith ?? listenerFromStatus(status, effective)) : null;
  const needsRestart = !!runningListener && !sameListener(runningListener, effective);

  const start = async () => {
    if (!valid) return;
    setBusy("start");
    try {
      await updateConfig((c) => {
        c.publicServer = { ...draft, host: effective.host, port: effective.port };
      });
      const s = await publicServerStart(effective);
      setStatus(s);
      setStartedWith(s.running ? effective : null);
      if (s.lastError && !s.running) toast(s.lastError, "error");
    } catch (err) {
      toast(errorMessage(err), "error");
      setStatus((s) => (s ? { ...s, lastError: errorMessage(err) } : s));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy("stop");
    try {
      setStatus(await publicServerStop());
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const restart = async () => {
    await stop();
    await start();
  };

  return (
    <Page
      title="API Server"
      subtitle="Run fm serve so other apps can use the on-device model with an OpenAI-style API."
      flush
    >
      <Workbench
        sideWidth={380}
        side={
          <>
            <InspectorSection title="Status">
              <div className="sv-status">
                <StatusDot tone={running ? "green" : status?.lastError ? "red" : "gray"} pulse={busy === "start"} />
                <div className="sv-status__text">
                  <div className="sv-status__title">
                    {running ? "Running" : busy === "start" ? "Starting…" : "Stopped"}
                  </div>
                  <div className="xsmall muted truncate selectable">
                    {running
                      ? status?.url || (status?.socketPath && tildePath(status.socketPath, home)) || "Address unknown"
                      : "Not listening. Start it to accept requests."}
                  </div>
                </div>
                {running ? (
                  <Button
                    variant="danger"
                    icon={<Square size={11} fill="currentColor" />}
                    onClick={stop}
                    loading={busy === "stop"}
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    icon={<Play size={12} fill="currentColor" />}
                    onClick={start}
                    loading={busy === "start"}
                    disabled={!valid}
                  >
                    Start
                  </Button>
                )}
              </div>
              {running && (
                <div className="sv-facts">
                  <span>
                    PID <strong>{status?.pid ?? "n/a"}</strong>
                  </span>
                  <span>
                    Uptime <strong>{startedMs ? formatUptime(now - startedMs) : "n/a"}</strong>
                  </span>
                </div>
              )}
              {status?.lastError && <Callout tone="error">{tildeText(status.lastError, home)}</Callout>}
              {statusError && <Callout tone="error">Could not read the server status: {statusError}</Callout>}
              {needsRestart && (
                <Callout tone="warning">
                  <div className="row">
                    <span style={{ flex: 1 }}>Settings changed. Restart to use them.</span>
                    <Button size="sm" onClick={restart} disabled={!!busy}>
                      Restart
                    </Button>
                  </div>
                </Callout>
              )}
              <CommandPreview command={running && status?.command ? status.command : command} />
            </InspectorSection>

            <InspectorSection title="Connection">
              <Segmented<"tcp" | "socket">
                value={draft.mode}
                onChange={(mode) => setDraft({ ...draft, mode })}
                options={[
                  { value: "tcp", label: "TCP port" },
                  { value: "socket", label: "Unix socket" },
                ]}
              />
              {draft.mode === "tcp" ? (
                <>
                  <div className="sv-hostport">
                    <Field label="Host" error={hostOk ? undefined : "Enter a host, like 127.0.0.1"}>
                      <TextInput
                        className="wb-mono-input"
                        value={draft.host}
                        placeholder="127.0.0.1"
                        onChange={(e) => setDraft({ ...draft, host: e.target.value })}
                      />
                    </Field>
                    <Field label="Port" error={port == null ? "1 to 65535" : undefined}>
                      <TextInput
                        className="wb-mono-input"
                        value={portText}
                        inputMode="numeric"
                        placeholder="1976"
                        onChange={(e) => {
                          setPortText(e.target.value);
                          const p = parsePort(e.target.value);
                          if (p != null) setDraft({ ...draft, port: p });
                        }}
                      />
                    </Field>
                  </div>
                  <div className="xsmall muted">127.0.0.1 means only this Mac. 0.0.0.0 opens it to your network.</div>
                  {isOpenHost && (
                    <Callout tone="warning">
                      <strong>Open to your network.</strong> Other devices on your network can use the model through
                      this server. There is no password or API key.
                    </Callout>
                  )}
                </>
              ) : (
                <Field label="Socket path" hint="Only programs on this Mac with access to the file can connect.">
                  <PathInput
                    className="wb-mono-input"
                    value={draft.socketPath}
                    placeholder={tildePath(defaultSocket, home)}
                    onChange={(socketPath) => setDraft({ ...draft, socketPath })}
                  />
                </Field>
              )}
              <InspectorRow label="Start with fmGUI" hint="Starts the server when the app opens">
                <Toggle
                  label="Start with fmGUI"
                  checked={draft.autostart}
                  onChange={(autostart) => setDraft({ ...draft, autostart })}
                />
              </InspectorRow>
            </InspectorSection>

            <InspectorSection title="Endpoints">
              <div className="sv-endpoints">
                {ENDPOINTS.map((e) => (
                  <div key={e.path} className="sv-endpoint">
                    <span className={`sv-method sv-method--${e.method.toLowerCase()}`}>{e.method}</span>
                    <div className="sv-endpoint__text">
                      <div className="mono truncate">{e.path}</div>
                      <div className="xsmall muted truncate">{e.description}</div>
                    </div>
                    <CopyButton
                      text={endpointCopyText(target, e)}
                      label={target.mode === "socket" ? "Copy curl command" : "Copy URL"}
                    />
                  </div>
                ))}
              </div>
              <div className="xsmall muted">
                {target.mode === "socket" ? (
                  <>
                    Socket: <span className="mono selectable">{tildePath(target.socketPath, home)}</span>
                  </>
                ) : (
                  <>
                    Base URL for OpenAI clients: <span className="mono selectable">{target.baseUrl}/v1</span>
                  </>
                )}
              </div>
            </InspectorSection>
          </>
        }
      >
        <Toolbar>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "logs", label: `Logs${logs.length ? ` (${logs.length})` : ""}` },
              { value: "try", label: "Try it" },
              { value: "code", label: "Code" },
              { value: "compat", label: "Compatibility" },
            ]}
          />
          <div className="spacer" />
          {tab === "logs" && (
            <>
              <Button
                size="sm"
                icon={<Copy size={12} />}
                disabled={!logs.length}
                onClick={() =>
                  navigator.clipboard
                    .writeText(logs.map((l) => l.line).join("\n"))
                    .then(() => toast("Logs copied.", "success"))
                    .catch((err) => toast(errorMessage(err), "error"))
                }
              >
                Copy
              </Button>
              <Button size="sm" icon={<Eraser size={12} />} disabled={!logs.length} onClick={() => setLogs([])}>
                Clear
              </Button>
            </>
          )}
          {tab === "code" && (
            <Segmented<string>
              value={snippet.id}
              onChange={setSnippetId}
              options={snippets.map((s) => ({ value: s.id, label: s.label }))}
            />
          )}
        </Toolbar>

        {tab === "logs" && (
          <div className="sv-logs-wrap">
            <LogPanel logs={logs} />
          </div>
        )}

        {tab === "try" && (
          <div className="wb__scroll">
            <div className="sv-pane">
              <TryRequest target={target} running={running} />
            </div>
          </div>
        )}

        {tab === "code" && (
          <div className="wb__scroll">
            <div className="sv-pane">
              <CodeBlock code={snippet.code} />
              <Callout>
                {target.mode === "socket" ? (
                  <>
                    Socket mode has no TCP port. Clients connect through the socket file, and the host name in the URL
                    is ignored. Browsers cannot use a Unix socket.
                  </>
                ) : (
                  <>
                    fm serve streams by default. Send <span className="mono">"stream": false</span> when you want one
                    JSON reply. The model name is <span className="mono">system</span>. No API key is checked, so any
                    value works. Web pages cannot call it: fm serve answers HTTP 403 to browser requests, so call it
                    from a server, a script or an app.
                  </>
                )}
              </Callout>
            </div>
          </div>
        )}

        {tab === "compat" && (
          <div className="wb__scroll">
            <div className="sv-pane">
              <div className="sv-card">
                <table className="wb-table">
                  <thead>
                    <tr>
                      <th>Request field</th>
                      <th>Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPAT.map((c) => (
                      <tr key={c.feature}>
                        <td className="mono">{c.feature}</td>
                        <td>
                          <Badge tone={COMPAT_BADGE[c.status].tone}>{COMPAT_BADGE[c.status].label}</Badge>
                        </td>
                        <td className="small">{c.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="xsmall muted">
                Tested with fm serve on macOS 27.0.1. Later macOS versions may change this.
              </div>
            </div>
          </div>
        )}
      </Workbench>
    </Page>
  );
}
