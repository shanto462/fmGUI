// MCP Servers page: connected tool servers, their tools, and the add wizard.

import { ChevronRight, Pencil, Plug, Plus, RotateCw, Trash2, Wrench } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  CodeBlock,
  CommandPreview,
  Empty,
  IconButton,
  Page,
  Section,
  Select,
  Spinner,
  StatusDot,
  Toggle,
} from "../components/ui";
import { errorMessage, mcpConnect, mcpDisconnect, mcpStatuses, onMcpStatus } from "../lib/api";
import { cx } from "../lib/cx";
import { tokensLabel } from "../lib/format";
import { tildeText } from "../lib/paths";
import { useApp, useHandoff } from "../lib/store";
import type { AppConfig, Approval, McpServerConfig, McpServerStatus } from "../lib/types";
import { McpWizard } from "./mcp/McpWizard";
import { MCP_TEMPLATES } from "./mcp/templates";
import { mcpToolTokens, transportLine } from "./mcp/transport";
import { APPROVAL_OPTIONS, computeBudget } from "./tools/helpers";
import { ConfirmModal, ContextBudget, Tile } from "./tools/shared";
import { useExtendData } from "./tools/useExtendData";

export default function McpView() {
  const config = useApp((s) => s.config);
  if (!config) {
    return (
      <Page title="MCP Servers">
        <Empty title="Loading…" />
      </Page>
    );
  }
  return <McpPage config={config} />;
}

function McpPage({ config }: { config: AppConfig }) {
  const updateConfig = useApp((s) => s.updateConfig);
  const toast = useApp((s) => s.toast);
  const navigate = useApp((s) => s.navigate);
  const handoff = useHandoff();
  const { tools, skills, reload } = useExtendData();

  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Another page can open the "Add server" wizard right away.
  const [wizard, setWizard] = useState<{ editing: McpServerConfig | null } | null>(() =>
    handoff.openWizard ? { editing: null } : null,
  );
  const [deleting, setDeleting] = useState<McpServerConfig | null>(null);

  const apply = useCallback((list: McpServerStatus[]) => {
    setStatuses((prev) => {
      const next = { ...prev };
      for (const s of list) next[s.id] = s;
      return next;
    });
  }, []);

  // Never rejects: a failure shows above the list.
  const refreshStatuses = useCallback(
    () =>
      mcpStatuses().then(
        (list) => {
          apply(list);
          setStatusError(null);
        },
        (err) => setStatusError(errorMessage(err)),
      ),
    [apply],
  );

  // A server connected or stopped: its tools change the catalog and the budget.
  const onLiveStatus = useEffectEvent((list: McpServerStatus[]) => {
    apply(list);
    void reload();
  });

  useEffect(() => {
    void refreshStatuses();
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    onMcpStatus((list) => onLiveStatus(list))
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {
        // Live updates are optional; the page still works with manual refresh.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshStatuses]);

  const budget = useMemo(() => computeBudget(config, tools, skills), [config, tools, skills]);

  // ---------- actions ----------
  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await fn();
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
      reload();
    }
  };

  const connect = (id: string) =>
    withBusy(id, async () => {
      setStatuses((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], state: "connecting", error: null } } : prev));
      try {
        apply(await mcpConnect(id));
      } catch (err) {
        toast(errorMessage(err), "error");
        await refreshStatuses();
      }
    });

  const setEnabled = (server: McpServerConfig, enabled: boolean) =>
    withBusy(server.id, async () => {
      const saved = await updateConfig((d) => {
        const s = d.mcpServers.find((x) => x.id === server.id);
        if (s) s.enabled = enabled;
      });
      if (!saved) return;
      try {
        if (enabled) {
          setStatuses((prev) => ({
            ...prev,
            [server.id]: { ...(prev[server.id] ?? emptyStatus(server)), state: "connecting", error: null },
          }));
          apply(await mcpConnect(server.id));
        } else {
          apply(await mcpDisconnect(server.id));
        }
      } catch (err) {
        toast(errorMessage(err), "error");
        await refreshStatuses();
      }
    });

  const setApproval = (server: McpServerConfig, approval: Approval) =>
    updateConfig((d) => {
      const s = d.mcpServers.find((x) => x.id === server.id);
      if (s) s.approval = approval;
    }).then(() => reload());

  const setToolsOn = (server: McpServerConfig, names: string[], on: boolean) =>
    updateConfig((d) => {
      const s = d.mcpServers.find((x) => x.id === server.id);
      if (!s) return;
      s.disabledTools = on
        ? s.disabledTools.filter((n) => !names.includes(n))
        : [...new Set([...s.disabledTools, ...names])];
    }).then(() => reload());

  const remove = async (server: McpServerConfig) => {
    try {
      await mcpDisconnect(server.id);
    } catch {
      // Not connected, or the backend is not ready: deleting the config is still fine.
    }
    const saved = await updateConfig((d) => {
      d.mcpServers = d.mcpServers.filter((s) => s.id !== server.id);
    });
    if (saved) {
      setStatuses((prev) => {
        const next = { ...prev };
        delete next[server.id];
        return next;
      });
      toast(`Deleted "${server.name}".`, "success");
    }
    setDeleting(null);
    reload();
  };

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Tokens of the edited server's own tools, so the wizard does not count them twice.
  const ownTokens = (id: string | undefined) =>
    id
      ? (tools ?? []).filter((t) => t.enabled && t.id.startsWith(`mcp:${id}:`)).reduce((s, t) => s + t.tokenEstimate, 0)
      : 0;

  const servers = config.mcpServers;

  return (
    <Page
      title="MCP Servers"
      subtitle="Tool servers that use the Model Context Protocol"
      actions={
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setWizard({ editing: null })}>
          Add server
        </Button>
      }
    >
      <div className="page__narrow">
        {statusError && (
          <Section>
            <Callout tone="error">
              Could not read the server status: {statusError}{" "}
              <button type="button" className="ext-link" onClick={refreshStatuses}>
                Try again
              </button>
            </Callout>
          </Section>
        )}

        {servers.length === 0 ? (
          <Section>
            <div className="card" style={{ padding: 28 }}>
              <div className="stack" style={{ alignItems: "center", textAlign: "center", gap: 10 }}>
                <Tile tone="teal" size="lg">
                  <Plug size={20} />
                </Tile>
                <div className="empty__title">Add your first MCP server</div>
                <div className="small muted" style={{ maxWidth: 480 }}>
                  MCP (Model Context Protocol) servers are small programs that give the model new tools, like reading
                  files in a folder or fetching web pages. The wizard checks what you need and tests the connection.
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Plus size={16} />}
                  onClick={() => setWizard({ editing: null })}
                >
                  Add MCP server
                </Button>
                <div className="row row--wrap" style={{ justifyContent: "center", gap: 6, marginTop: 6 }}>
                  <span className="xsmall muted">Popular:</span>
                  {MCP_TEMPLATES.slice(0, 4).map((t) => (
                    <Badge key={t.id}>{t.title}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        ) : (
          <Section title="Servers">
            <div className="group">
              {servers.map((server) => (
                <ServerRow
                  key={server.id}
                  server={server}
                  status={statuses[server.id]}
                  busy={!!busy[server.id]}
                  open={expanded.has(server.id)}
                  onToggleOpen={() => toggleExpanded(server.id)}
                  onEnabled={(v) => setEnabled(server, v)}
                  onReconnect={() => connect(server.id)}
                  onEdit={() => setWizard({ editing: server })}
                  onDelete={() => setDeleting(server)}
                  onApproval={(a) => setApproval(server, a)}
                  onToolsOn={(names, on) => setToolsOn(server, names, on)}
                />
              ))}
            </div>
            <div className="row xsmall muted" style={{ marginTop: 8 }}>
              <Wrench size={12} />
              Enabled tools from connected servers also show on the{" "}
              <button type="button" className="ext-link" onClick={() => navigate("tools")}>
                Tools page
              </button>
              .
            </div>
          </Section>
        )}

        <Section>
          <ContextBudget config={config} tools={tools} skills={skills} />
        </Section>
      </div>

      {wizard && (
        <McpWizard
          editing={wizard.editing}
          knownTools={wizard.editing ? statuses[wizard.editing.id]?.tools : undefined}
          takenNames={servers.filter((s) => s.id !== wizard.editing?.id).map((s) => s.name)}
          baseTokens={Math.max(0, budget.total - ownTokens(wizard.editing?.id))}
          contextSize={budget.contextSize}
          onClose={() => setWizard(null)}
          onSaved={(server) => {
            setWizard(null);
            setExpanded((prev) => new Set(prev).add(server.id));
            if (server.enabled) connect(server.id);
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title={`Delete "${deleting.name}"?`}
          message="fmGUI disconnects the server and removes it. Its tools stop working in Chat. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  );
}

function emptyStatus(server: McpServerConfig): McpServerStatus {
  return {
    id: server.id,
    name: server.name,
    state: "disconnected",
    error: null,
    serverName: null,
    serverVersion: null,
    tools: [],
    stderrTail: [],
  };
}

function ServerRow(props: {
  server: McpServerConfig;
  status: McpServerStatus | undefined;
  busy: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onEnabled: (v: boolean) => void;
  onReconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onApproval: (a: Approval) => void;
  onToolsOn: (names: string[], on: boolean) => void;
}) {
  const { server, status } = props;
  const home = useApp((s) => s.paths?.homeDir);
  const tilde = (text: string) => tildeText(text, home);
  const line = tilde(transportLine(server.transport));
  const state = status?.state ?? "disconnected";
  const tools = status?.tools ?? [];
  const isOn = (name: string) => !server.disabledTools.includes(name);
  const onCount = tools.filter((t) => isOn(t.name)).length;
  const tokens = tools.filter((t) => isOn(t.name)).reduce((s, t) => s + mcpToolTokens(t), 0);

  let tone: "green" | "orange" | "red" | "gray" = "gray";
  let text = "Not connected";
  if (!server.enabled) text = "Off";
  else if (state === "connected") [tone, text] = ["green", `Connected · ${onCount} of ${tools.length} tools on`];
  else if (state === "connecting") [tone, text] = ["orange", "Connecting…"];
  else if (state === "error") [tone, text] = ["red", "Error"];

  return (
    <div className="ext-server">
      <div className={cx("group__row ext-row", !server.enabled && "ext-row--off")}>
        <IconButton
          label={props.open ? "Hide details" : "Show details"}
          onClick={props.onToggleOpen}
          style={{ width: 22, height: 22, marginTop: 3 }}
        >
          <ChevronRight size={14} className={cx("ext-chevron", props.open && "ext-chevron--open")} />
        </IconButton>
        <div className="ext-row__main" onClick={props.onToggleOpen}>
          <div className="ext-row__title">
            <span>{server.name}</span>
            {status?.serverName && (
              <span className="ext-name">
                {status.serverName}
                {status.serverVersion ? ` ${status.serverVersion}` : ""}
              </span>
            )}
          </div>
          <div className="row small" style={{ gap: 6 }}>
            <StatusDot tone={tone} pulse={state === "connecting"} />
            <span className="muted">{text}</span>
            {state === "connected" && tokens > 0 && <span className="xsmall muted">· {tokensLabel(tokens)}</span>}
          </div>
          {state === "error" && status?.error && (
            <div className="ext-row__desc" style={{ color: "var(--red)" }} title={tilde(status.error)}>
              {tilde(status.error)}
            </div>
          )}
          <div className="ext-row__meta mono truncate" style={{ maxWidth: "100%" }} title={line}>
            {line}
          </div>
        </div>
        <div className="ext-row__controls">
          {props.busy && <Spinner />}
          <IconButton label="Reconnect" onClick={props.onReconnect} disabled={!server.enabled || props.busy}>
            <RotateCw size={14} />
          </IconButton>
          <IconButton label="Edit" onClick={props.onEdit}>
            <Pencil size={14} />
          </IconButton>
          <IconButton label="Delete" onClick={props.onDelete}>
            <Trash2 size={14} />
          </IconButton>
          <Toggle
            checked={server.enabled}
            onChange={props.onEnabled}
            disabled={props.busy}
            label={`Enable ${server.name}`}
          />
        </div>
      </div>
      {props.open && (
        <div className="ext-expander">
          <div className="stack" style={{ gap: 12, paddingTop: 10 }}>
            <div className="row">
              <span className="small">When the model wants to use a tool from this server</span>
              <div className="spacer" />
              <Select<Approval>
                value={server.approval}
                onChange={props.onApproval}
                options={APPROVAL_OPTIONS}
                style={{ width: 150 }}
              />
            </div>
            <CommandPreview command={transportLine(server.transport)} />

            {state === "error" && (
              <>
                <Callout tone="error">
                  <div className="selectable">{tilde(status?.error ?? "The server stopped with an error.")}</div>
                  <div className="xsmall muted" style={{ marginTop: 4 }}>
                    {server.transport.type === "http"
                      ? "Check the URL and headers with Edit, then click Reconnect."
                      : "Check the command with Edit, then click Reconnect."}
                  </div>
                </Callout>
                {status && status.stderrTail.length > 0 && (
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="xsmall muted">What the server printed (last lines)</div>
                    <CodeBlock code={status.stderrTail.join("\n")} wrap maxHeight={200} />
                  </div>
                )}
              </>
            )}

            {tools.length > 0 ? (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row">
                  <span className="small">
                    <b>Tools</b>{" "}
                    <span className="muted">
                      · {onCount} of {tools.length} on · {tokensLabel(tokens)}
                    </span>
                  </span>
                  <div className="spacer" />
                  <Button
                    size="sm"
                    variant="plain"
                    onClick={() =>
                      props.onToolsOn(
                        tools.map((t) => t.name),
                        true,
                      )
                    }
                  >
                    All on
                  </Button>
                  <Button
                    size="sm"
                    variant="plain"
                    onClick={() =>
                      props.onToolsOn(
                        tools.map((t) => t.name),
                        false,
                      )
                    }
                  >
                    All off
                  </Button>
                </div>
                <div className="group">
                  {tools.map((t) => {
                    const on = isOn(t.name);
                    return (
                      <div key={t.name} className={cx("group__row ext-row", !on && "ext-row--off")}>
                        <div className="ext-row__main">
                          <div className="ext-row__title mono">{t.name}</div>
                          {t.description && (
                            <div className="ext-row__desc" title={t.description}>
                              {t.description}
                            </div>
                          )}
                          <div className="ext-row__meta">{tokensLabel(mcpToolTokens(t))}</div>
                        </div>
                        <Toggle checked={on} onChange={(v) => props.onToolsOn([t.name], v)} label={t.name} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="small muted">
                {!server.enabled
                  ? "Turn the server on to see its tools."
                  : state === "connected"
                    ? "This server has no tools."
                    : state === "connecting"
                      ? "Connecting… Its tools show up here when it is ready."
                      : "Connect the server to see its tools."}
                {server.enabled && state === "disconnected" && (
                  <>
                    {" "}
                    <button type="button" className="ext-link" onClick={props.onReconnect}>
                      Connect now
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
