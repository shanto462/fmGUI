// Tools page: every tool the model can use, with prefs, tests and custom tools.

import {
  Calculator,
  Clipboard,
  Clock,
  Cloud,
  Copy,
  ExternalLink,
  FilePen,
  FileText,
  Folder,
  Globe,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  SquareTerminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Callout,
  Empty,
  IconButton,
  Modal,
  Page,
  Section,
  Segmented,
  Select,
  Spinner,
  Toggle,
} from "../components/ui";
import { customToolTest, newId, toolTest } from "../lib/api";
import { cx } from "../lib/cx";
import { tokensLabel } from "../lib/format";
import { useApp, useHandoff } from "../lib/store";
import type { AppConfig, Approval, CustomTool, ToolInfo, ToolTestResult } from "../lib/types";
import { ToolTestPanel } from "./tools/ArgsForm";
import { paramsSchema, uniqueName } from "./tools/customTool";
import { CustomToolWizard } from "./tools/CustomToolWizard";
import { APPROVAL_OPTIONS, toolTokenEstimate } from "./tools/helpers";
import { KIND_INFO } from "./tools/kinds";
import { ConfirmModal, ContextBudget, Tile } from "./tools/shared";
import { useExtendData } from "./tools/useExtendData";

type Filter = "all" | "builtin" | "custom" | "mcp" | "skill";

interface TestTarget {
  title: string;
  name: string;
  schema: unknown;
  dangerous: boolean;
  run: (args: Record<string, unknown>) => Promise<ToolTestResult>;
}

export default function ToolsView() {
  const config = useApp((s) => s.config);
  if (!config) {
    return (
      <Page title="Tools">
        <Empty title="Loading…" />
      </Page>
    );
  }
  return <ToolsPage config={config} />;
}

function ToolsPage({ config }: { config: AppConfig }) {
  const updateConfig = useApp((s) => s.updateConfig);
  const toast = useApp((s) => s.toast);
  const navigate = useApp((s) => s.navigate);
  const handoff = useHandoff();
  const { tools, setTools, skills, toolsError, loading, reload } = useExtendData();

  const [filter, setFilter] = useState<Filter>("all");
  // Another page can open the "New tool" wizard right away.
  const [wizard, setWizard] = useState<{ editing: CustomTool | null } | null>(() =>
    handoff.openWizard ? { editing: null } : null,
  );
  const [testing, setTesting] = useState<TestTarget | null>(null);
  const [deleting, setDeleting] = useState<CustomTool | null>(null);

  const byId = useMemo(() => new Map((tools ?? []).map((t) => [t.id, t])), [tools]);
  const builtin = (tools ?? []).filter((t) => t.source === "builtin");
  const mcpTools = (tools ?? []).filter((t) => t.source === "mcp");
  const skillTools = (tools ?? []).filter((t) => t.source === "skill");
  const mcpGroups = useMemo(() => {
    const groups = new Map<string, ToolInfo[]>();
    for (const t of tools ?? []) {
      if (t.source === "mcp") groups.set(t.sourceLabel, [...(groups.get(t.sourceLabel) ?? []), t]);
    }
    return [...groups.entries()];
  }, [tools]);

  // Names used by tools other than custom ones (for unique-name checks in the wizard).
  const otherNames = (tools ?? []).filter((t) => t.source !== "custom").map((t) => t.name);

  // ---------- saving prefs ----------
  const optimistic = (id: string, p: Partial<ToolInfo>) =>
    setTools((ts) => (ts ? ts.map((t) => (t.id === id ? { ...t, ...p } : t)) : ts));

  const saveThenReload = async (change: (d: AppConfig) => void) => {
    await updateConfig(change);
    await reload();
  };

  const setBuiltin = (t: ToolInfo, p: { enabled?: boolean; approval?: Approval }) => {
    optimistic(t.id, p);
    const key = t.id.startsWith("builtin:") ? t.id.slice("builtin:".length) : t.name;
    const prefs = { enabled: p.enabled ?? t.enabled, approval: p.approval ?? t.approval };
    return saveThenReload((d) => {
      d.builtinTools[key] = prefs;
    });
  };

  const setCustom = (id: string, p: { enabled?: boolean; approval?: Approval }) => {
    optimistic(`custom:${id}`, p);
    return saveThenReload((d) => {
      const tool = d.customTools.find((c) => c.id === id);
      if (tool) Object.assign(tool, p);
    });
  };

  const parseMcpId = (id: string) => {
    const rest = id.slice("mcp:".length);
    const i = rest.indexOf(":");
    return i < 0 ? { serverId: rest, tool: "" } : { serverId: rest.slice(0, i), tool: rest.slice(i + 1) };
  };

  const setMcpEnabled = (t: ToolInfo, enabled: boolean) => {
    const { serverId, tool } = parseMcpId(t.id);
    optimistic(t.id, { enabled });
    return saveThenReload((d) => {
      const s = d.mcpServers.find((x) => x.id === serverId);
      if (!s) return;
      const name = tool || t.name;
      s.disabledTools = enabled ? s.disabledTools.filter((n) => n !== name) : [...new Set([...s.disabledTools, name])];
    });
  };

  const setMcpApproval = (t: ToolInfo, approval: Approval) => {
    const { serverId } = parseMcpId(t.id);
    setTools((ts) => (ts ? ts.map((x) => (x.id.startsWith(`mcp:${serverId}:`) ? { ...x, approval } : x)) : ts));
    return saveThenReload((d) => {
      const s = d.mcpServers.find((x) => x.id === serverId);
      if (s) s.approval = approval;
    });
  };

  const duplicate = async (tool: CustomTool) => {
    const taken = [...config.customTools.map((c) => c.name), ...otherNames];
    const base = `${tool.name.slice(0, 43)}_copy`;
    const copy: CustomTool = { ...structuredClone(tool), id: newId(), name: uniqueName(base, taken) };
    const saved = await updateConfig((d) => {
      d.customTools.push(copy);
    });
    if (saved) toast(`Made a copy named "${copy.name}".`, "success");
    reload();
  };

  const remove = async (tool: CustomTool) => {
    const saved = await updateConfig((d) => {
      d.customTools = d.customTools.filter((c) => c.id !== tool.id);
    });
    if (saved) toast(`Deleted "${tool.name}".`, "success");
    setDeleting(null);
    reload();
  };

  const testCatalogTool = (t: ToolInfo) =>
    setTesting({
      title: t.title || t.name,
      name: t.name,
      schema: t.inputSchema,
      dangerous: t.dangerous,
      run: (args) => toolTest(t.id, args),
    });

  // ---------- rows ----------
  const show = (f: Filter) => filter === "all" || filter === f;
  const count = (n: number) => <span className="ext-count">{n}</span>;

  const builtinRows = builtin.map((t) => (
    <ToolRow
      key={t.id}
      tile={<Tile tone="accent">{builtinIcon(t.name)}</Tile>}
      info={t}
      title={t.title || t.name}
      name={t.name}
      description={t.description}
      badge={<Badge>Built-in</Badge>}
      dangerous={t.dangerous}
      tokens={t.tokenEstimate}
      enabled={t.enabled}
      onEnabled={(v) => setBuiltin(t, { enabled: v })}
      approval={t.approval}
      onApproval={(v) => setBuiltin(t, { approval: v })}
      onTest={() => testCatalogTool(t)}
    />
  ));

  const customRows = config.customTools.map((ct) => {
    const info = byId.get(`custom:${ct.id}`);
    const kind = KIND_INFO[ct.kind.type];
    const schema = info?.inputSchema ?? paramsSchema(ct.params);
    return (
      <ToolRow
        key={ct.id}
        tile={<Tile tone={kind.tone}>{kind.icon}</Tile>}
        info={info}
        title={info?.title || ct.name}
        name={ct.name}
        description={ct.description}
        badge={<Badge tone="purple">{kind.label}</Badge>}
        dangerous={info?.dangerous ?? ct.kind.type === "shell"}
        tokens={info?.tokenEstimate ?? toolTokenEstimate(paramsSchema(ct.params), ct.description, ct.name)}
        enabled={ct.enabled}
        onEnabled={(v) => setCustom(ct.id, { enabled: v })}
        approval={ct.approval}
        onApproval={(v) => setCustom(ct.id, { approval: v })}
        onTest={() =>
          setTesting({
            title: ct.name,
            name: ct.name,
            schema,
            dangerous: ct.kind.type === "shell",
            run: (args) => (info ? toolTest(info.id, args) : customToolTest(ct, args)),
          })
        }
        extra={
          <>
            <IconButton label="Edit" onClick={() => setWizard({ editing: ct })}>
              <Pencil size={14} />
            </IconButton>
            <IconButton label="Duplicate" onClick={() => duplicate(ct)}>
              <Copy size={14} />
            </IconButton>
            <IconButton label="Delete" onClick={() => setDeleting(ct)}>
              <Trash2 size={14} />
            </IconButton>
          </>
        }
      />
    );
  });

  const notConnected = config.mcpServers.filter(
    (s) => s.enabled && !mcpTools.some((t) => t.id.startsWith(`mcp:${s.id}:`)),
  );

  return (
    <Page
      title="Tools"
      subtitle="Actions the model can take in Chat"
      actions={
        <>
          <IconButton label="Refresh" onClick={() => reload()} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw size={15} />}
          </IconButton>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setWizard({ editing: null })}>
            New tool
          </Button>
        </>
      }
    >
      <div className="page__narrow">
        <Section>
          <ContextBudget config={config} tools={tools} skills={skills} />
        </Section>

        {!config.chatDefaults.toolsEnabled && (
          <Section>
            <Callout tone="warning">
              Tools are turned off for chats. The model will not use any tool until you turn them on in{" "}
              <button type="button" className="ext-link" onClick={() => navigate("settings")}>
                Settings
              </button>
              .
            </Callout>
          </Section>
        )}

        {toolsError && (
          <Section>
            <Callout tone="error">
              Could not load the tool list: {toolsError}{" "}
              <button type="button" className="ext-link" onClick={() => reload()}>
                Try again
              </button>
            </Callout>
          </Section>
        )}

        <div className="row" style={{ marginBottom: 16 }}>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "builtin", label: <>Built-in{count(builtin.length)}</> },
              { value: "custom", label: <>Custom{count(config.customTools.length)}</> },
              { value: "mcp", label: <>MCP{count(mcpTools.length)}</> },
              { value: "skill", label: <>Skills{count(skillTools.length)}</> },
            ]}
          />
        </div>

        {tools === null && (
          <div className="row muted small" style={{ padding: 16 }}>
            <Spinner /> Loading tools…
          </div>
        )}

        {tools !== null && show("builtin") && (
          <Section title="Built-in">
            {builtinRows.length ? (
              <div className="group">{builtinRows}</div>
            ) : (
              <div className="card small muted">
                No built-in tools found. The tool engine may still be starting.{" "}
                <button type="button" className="ext-link" onClick={() => reload()}>
                  Check again
                </button>
              </div>
            )}
          </Section>
        )}

        {show("custom") && (
          <Section
            title="Custom"
            actions={
              config.customTools.length > 0 && (
                <Button
                  size="sm"
                  variant="plain"
                  icon={<Plus size={13} />}
                  onClick={() => setWizard({ editing: null })}
                >
                  New tool
                </Button>
              )
            }
          >
            {customRows.length ? (
              <div className="group">{customRows}</div>
            ) : (
              <div className="card">
                <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
                  <Tile tone="purple" size="lg">
                    <Wrench size={20} />
                  </Tile>
                  <div style={{ flex: 1 }}>
                    <div className="card__title">Make your own tool</div>
                    <p className="card__desc">
                      Let the model run a shell command, call a web API, or run an Apple Shortcut. Start from a template
                      like "Weather" or "Battery status". It takes about a minute.
                    </p>
                  </div>
                  <Button variant="primary" icon={<Plus size={14} />} onClick={() => setWizard({ editing: null })}>
                    New tool
                  </Button>
                </div>
              </div>
            )}
          </Section>
        )}

        {tools !== null && show("mcp") && (
          <Section
            title="MCP servers"
            actions={
              <Button size="sm" variant="plain" icon={<Plug size={13} />} onClick={() => navigate("mcp")}>
                Manage servers
              </Button>
            }
          >
            {mcpGroups.length === 0 && (
              <div className="card small muted">
                {config.mcpServers.length === 0 ? (
                  <>
                    No MCP servers yet. MCP servers add ready-made tools, like reading files or fetching web pages.{" "}
                    <button type="button" className="ext-link" onClick={() => navigate("mcp", { openWizard: true })}>
                      Add a server
                    </button>
                  </>
                ) : (
                  <>
                    No MCP tools right now. Tools show up here once a server is connected.{" "}
                    <button type="button" className="ext-link" onClick={() => navigate("mcp")}>
                      Open MCP Servers
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="stack" style={{ gap: 14 }}>
              {mcpGroups.map(([label, list]) => (
                <div key={label}>
                  <div className="xsmall muted" style={{ margin: "0 0 6px 2px" }}>
                    {label} · approval applies to every tool from this server
                  </div>
                  <div className="group">
                    {list.map((t) => (
                      <ToolRow
                        key={t.id}
                        tile={
                          <Tile tone="teal">
                            <Plug size={15} />
                          </Tile>
                        }
                        info={t}
                        title={t.title || t.name}
                        name={t.name}
                        description={t.description}
                        badge={<Badge tone="accent">{t.sourceLabel}</Badge>}
                        dangerous={t.dangerous}
                        tokens={t.tokenEstimate}
                        enabled={t.enabled}
                        onEnabled={(v) => setMcpEnabled(t, v)}
                        approval={t.approval}
                        onApproval={(v) => setMcpApproval(t, v)}
                        onTest={() => testCatalogTool(t)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {notConnected.length > 0 && mcpGroups.length > 0 && (
              <div className="xsmall muted" style={{ marginTop: 8 }}>
                Not connected: {notConnected.map((s) => s.name).join(", ")}. Their tools show up once they connect.
              </div>
            )}
          </Section>
        )}

        {tools !== null && show("skill") && (
          <Section
            title="Skills"
            actions={
              <Button size="sm" variant="plain" icon={<Sparkles size={13} />} onClick={() => navigate("skills")}>
                Manage skills
              </Button>
            }
          >
            {skillTools.length ? (
              <div className="group">
                {skillTools.map((t) => (
                  <ToolRow
                    key={t.id}
                    tile={
                      <Tile tone="orange">
                        <Sparkles size={15} />
                      </Tile>
                    }
                    info={t}
                    title={t.title || t.name}
                    name={t.name}
                    description={t.description}
                    badge={<Badge tone="orange">Skills</Badge>}
                    dangerous={t.dangerous}
                    tokens={t.tokenEstimate}
                    onTest={() => testCatalogTool(t)}
                    extra={
                      <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => navigate("skills")}>
                        Skills page
                      </Button>
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="card small muted">
                The model loads on-demand skills with a <span className="mono">use_skill</span> tool. It shows up here
                when at least one skill is set to On demand.{" "}
                <button type="button" className="ext-link" onClick={() => navigate("skills")}>
                  Open Skills
                </button>
              </div>
            )}
          </Section>
        )}
      </div>

      {wizard && (
        <CustomToolWizard
          editing={wizard.editing}
          takenNames={[
            ...config.customTools.filter((c) => c.id !== wizard.editing?.id).map((c) => c.name),
            ...otherNames,
          ]}
          onClose={() => setWizard(null)}
          onSaved={() => {
            setWizard(null);
            reload();
          }}
        />
      )}

      {testing && (
        <Modal title={`Test "${testing.title}"`} onClose={() => setTesting(null)}>
          <div className="stack">
            <div className="small muted">
              Runs <span className="mono">{testing.name}</span> directly with the arguments below. The model is not
              involved and nothing asks for approval.
            </div>
            <ToolTestPanel schema={testing.schema} dangerous={testing.dangerous} run={testing.run} />
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmModal
          title={`Delete "${deleting.name}"?`}
          message="The model will not be able to use this tool any more. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  );
}

function ToolRow(props: {
  tile: ReactNode;
  info?: ToolInfo;
  title: string;
  name: string;
  description: string;
  badge: ReactNode;
  dangerous: boolean;
  tokens: number;
  enabled?: boolean;
  onEnabled?: (v: boolean) => void;
  approval?: Approval;
  onApproval?: (v: Approval) => void;
  onTest: () => void;
  extra?: ReactNode;
}) {
  const off = props.enabled === false;
  return (
    <div className={cx("group__row ext-row", off && "ext-row--off")}>
      {props.tile}
      <div className="ext-row__main">
        <div className="ext-row__title">
          <span>{props.title}</span>
          {props.title !== props.name && <span className="ext-name">{props.name}</span>}
        </div>
        {props.description && (
          <div className="ext-row__desc" title={props.description}>
            {props.description}
          </div>
        )}
        <div className="ext-row__meta">
          {props.badge}
          {props.dangerous && (
            <Badge tone="orange" title="This tool can write files, run commands or send data.">
              Can change things
            </Badge>
          )}
          <span>{tokensLabel(props.tokens)}</span>
        </div>
      </div>
      <div className="ext-row__controls">
        {props.extra}
        <IconButton label="Test this tool" onClick={props.onTest}>
          <Play size={14} />
        </IconButton>
        {props.approval && props.onApproval && (
          <span className="ext-select-wrap" title="What happens when the model wants to use this tool">
            <Select<Approval>
              value={props.approval}
              onChange={props.onApproval}
              options={APPROVAL_OPTIONS}
              style={{ width: 136, minHeight: 24, height: 24, paddingTop: 0, paddingBottom: 0, fontSize: 12 }}
            />
          </span>
        )}
        {props.onEnabled && props.enabled !== undefined && (
          <Toggle checked={props.enabled} onChange={props.onEnabled} label={`Enable ${props.name}`} />
        )}
      </div>
    </div>
  );
}

function builtinIcon(name: string): ReactNode {
  const n = name.toLowerCase();
  const size = 15;
  if (n.includes("calc") || n.includes("math")) return <Calculator size={size} />;
  if (n.includes("write") || n.includes("edit")) return <FilePen size={size} />;
  if (n.includes("dir") || n.includes("folder") || n.includes("list_files")) return <Folder size={size} />;
  if (n.includes("file") || n.includes("read")) return <FileText size={size} />;
  if (n.includes("time") || n.includes("date") || n.includes("clock")) return <Clock size={size} />;
  if (n.includes("search")) return <Search size={size} />;
  if (n.includes("web") || n.includes("fetch") || n.includes("http") || n.includes("url")) return <Globe size={size} />;
  if (n.includes("clipboard")) return <Clipboard size={size} />;
  if (n.includes("shell") || n.includes("command") || n.includes("run")) return <SquareTerminal size={size} />;
  if (n.includes("weather")) return <Cloud size={size} />;
  if (n.includes("open")) return <ExternalLink size={size} />;
  return <Wrench size={size} />;
}
