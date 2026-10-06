// Chat tool picker: lists every catalog tool with a switch that saves to the
// app config.

import { ArrowRight, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Callout, Modal, Spinner, Toggle } from "../../components/ui";
import { formatNumber } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { AppConfig, ToolInfo, ToolSource } from "../../lib/types";
import { SourceIcon } from "./StepCard";

/** Writes the enabled flag for one catalog tool into the config draft. False if the tool is unknown. */
function applyToolEnabled(draft: AppConfig, tool: ToolInfo, on: boolean): boolean {
  const [kind, ...rest] = tool.id.split(":");
  if (kind === "builtin" || (tool.source === "builtin" && rest.length === 0)) {
    const key = rest.join(":") || tool.name;
    const prev = draft.builtinTools[key] ?? { enabled: true, approval: tool.approval };
    draft.builtinTools[key] = { ...prev, enabled: on };
    return true;
  }
  if (kind === "custom") {
    const id = rest.join(":");
    const custom = draft.customTools.find((t) => t.id === id || t.name === tool.name);
    if (!custom) return false;
    custom.enabled = on;
    return true;
  }
  if (kind === "mcp") {
    const [serverId, ...toolParts] = rest;
    const toolName = toolParts.join(":") || tool.name;
    const server = draft.mcpServers.find((s) => s.id === serverId);
    if (!server) return false;
    const others = server.disabledTools.filter((n) => n !== toolName);
    server.disabledTools = on ? others : [...others, toolName];
    return true;
  }
  return false;
}

const GROUP_ORDER: ToolSource[] = ["builtin", "custom", "mcp", "skill"];
const GROUP_TITLE: Record<ToolSource, string> = {
  builtin: "Built-in",
  custom: "Custom tools",
  mcp: "MCP",
  skill: "Skills",
};

function groupTools(tools: ToolInfo[]): { key: string; title: string; tools: ToolInfo[] }[] {
  const groups = new Map<string, { key: string; title: string; order: number; tools: ToolInfo[] }>();
  for (const t of tools) {
    const order = GROUP_ORDER.indexOf(t.source);
    const key = t.source === "mcp" ? `mcp:${t.sourceLabel}` : t.source;
    const title = t.source === "mcp" ? `MCP: ${t.sourceLabel || "server"}` : (GROUP_TITLE[t.source] ?? t.source);
    if (!groups.has(key)) groups.set(key, { key, title, order: order === -1 ? 9 : order, tools: [] });
    groups.get(key)!.tools.push(t);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function ToolsModal(props: {
  catalog: ToolInfo[] | null;
  error: string | null;
  reload: () => Promise<void>;
  setCatalog: (fn: (c: ToolInfo[] | null) => ToolInfo[] | null) => void;
  onClose: () => void;
}) {
  const config = useApp((s) => s.config);
  const updateConfig = useApp((s) => s.updateConfig);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);

  const toolsOn = config?.chatDefaults.toolsEnabled ?? true;
  const enabled = (props.catalog ?? []).filter((t) => t.enabled);
  const tokenCost = enabled.reduce((n, t) => n + (t.tokenEstimate || 0), 0);
  const tools = (props.catalog ?? []).filter((t) => t.source !== "skill");
  const toolsEnabled = tools.filter((t) => t.enabled).length;
  const contextSize = config?.contextSize ?? 8192;

  async function setEnabled(tool: ToolInfo, on: boolean) {
    if (!config) return;
    const probe = structuredClone(config);
    if (!applyToolEnabled(probe, tool, on)) {
      toast("This tool cannot be switched here. Open the Tools page to change it.", "error");
      return;
    }
    setBusy(tool.id);
    props.setCatalog((c) => c?.map((t) => (t.id === tool.id ? { ...t, enabled: on } : t)) ?? c);
    const saved = await updateConfig((draft) => {
      applyToolEnabled(draft, tool, on);
    });
    if (!saved) {
      props.setCatalog((c) => c?.map((t) => (t.id === tool.id ? { ...t, enabled: !on } : t)) ?? c);
    } else {
      await props.reload();
    }
    setBusy(null);
  }

  async function setToolsOn(on: boolean) {
    setBusy("__all");
    await updateConfig((draft) => {
      draft.chatDefaults.toolsEnabled = on;
    });
    setBusy(null);
  }

  function go(route: "tools" | "skills" | "mcp") {
    props.onClose();
    navigate(route);
  }

  return (
    <Modal
      title="Tools for chats"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="plain" onClick={() => go("tools")}>
            Manage tools
            <ArrowRight size={14} />
          </Button>
          <div className="spacer" />
          <Button variant="primary" onClick={props.onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="group">
          <div className="group__row">
            <div className="group__label">
              <div>Use tools in chats</div>
              <div className="group__hint">
                When this is off, the model only answers from what it knows. Applies to every chat.
              </div>
            </div>
            {busy === "__all" && <Spinner />}
            <Toggle checked={toolsOn} onChange={setToolsOn} disabled={busy === "__all"} label="Use tools in chats" />
          </div>
        </div>

        {props.catalog && props.catalog.length > 0 && (
          <div className="xsmall muted">
            {toolsEnabled} of {tools.length} tools on. Tool descriptions use about {formatNumber(tokenCost)} of the{" "}
            {formatNumber(contextSize)} tokens in every request, so switch off the ones you do not need.
          </div>
        )}

        {props.error && (
          <Callout tone="error">
            <div>Could not load the tool list.</div>
            <div className="xsmall selectable" style={{ marginTop: 4 }}>
              {props.error}
            </div>
            <Button size="sm" style={{ marginTop: 8 }} onClick={() => props.reload()}>
              Try again
            </Button>
          </Callout>
        )}

        {!props.error && props.catalog === null && (
          <div className="row muted small">
            <Spinner /> Loading tools…
          </div>
        )}

        {props.catalog && props.catalog.length === 0 && !props.error && (
          <Callout>
            No tools yet. Add built-in tools, your own commands, MCP servers or skills to give the model new abilities.
          </Callout>
        )}

        {props.catalog &&
          groupTools(props.catalog).map((group) => (
            <div key={group.key} style={{ opacity: toolsOn ? 1 : 0.55 }}>
              <h3 className="section__title">{group.title}</h3>
              <div className="group">
                {group.tools.map((tool) => (
                  <div key={tool.id} className="group__row cv-toolrow">
                    <SourceIcon source={tool.source} size={14} />
                    <div className="group__label">
                      <div className="row" style={{ gap: 6 }}>
                        <span className="truncate" style={{ fontWeight: 500 }}>
                          {tool.title || tool.name}
                        </span>
                        <span className="mono xsmall muted truncate">{tool.name}</span>
                      </div>
                      {tool.description && <div className="group__hint cv-clamp2">{tool.description}</div>}
                      <div className="row" style={{ gap: 4, marginTop: 3 }}>
                        {tool.dangerous && (
                          <Badge tone="orange" title="This tool can change files or run commands">
                            <ShieldAlert size={10} />
                            Can change things
                          </Badge>
                        )}
                        {tool.approval === "ask" && tool.source !== "skill" && <Badge>Asks first</Badge>}
                        {tool.tokenEstimate > 0 && <Badge>{formatNumber(tool.tokenEstimate)} tokens</Badge>}
                      </div>
                    </div>
                    {tool.source === "skill" ? (
                      <Button size="sm" variant="plain" onClick={() => go("skills")}>
                        Skills page
                      </Button>
                    ) : (
                      <>
                        {busy === tool.id && <Spinner />}
                        <Toggle
                          checked={tool.enabled}
                          disabled={busy === tool.id}
                          onChange={(v) => setEnabled(tool, v)}
                          label={`Use ${tool.title || tool.name}`}
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </Modal>
  );
}
