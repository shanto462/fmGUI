// Overview: a dashboard of the model, the app services and quick actions.

import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  BookOpen,
  Braces,
  Check,
  Cpu,
  FileText,
  Gauge,
  Laptop,
  MessageSquare,
  MessageSquarePlus,
  Plug,
  Radio,
  RefreshCw,
  Sparkles,
  TerminalSquare,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Page, StatusDot } from "../components/ui";
import {
  chatCreate,
  chatsList,
  cliSessionsList,
  errorMessage,
  mcpStatuses,
  onMcpStatus,
  onPublicServerState,
  openInTerminal,
  publicServerStart,
  publicServerStatus,
  skillsList,
  toolsCatalog,
} from "../lib/api";
import { displayCommand } from "../lib/fmArgs";
import { formatNumber } from "../lib/format";
import { tildePath } from "../lib/paths";
import { useApp, type Route } from "../lib/store";
import type { ChatSummary, CliSession, McpServerStatus, PublicServerStatus, Skill, ToolInfo } from "../lib/types";
import { useEngine } from "./overview/hooks";
import { IconTile, type TileColor } from "./overview/shared";
import { macosLabel, modelState } from "./overview/status";
import "./OverviewView.css";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(p: Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

interface OverviewData {
  server: Result<PublicServerStatus>;
  chats: Result<ChatSummary[]>;
  sessions: Result<CliSession[]>;
  tools: Result<ToolInfo[]>;
  mcp: Result<McpServerStatus[]>;
  skills: Result<Skill[]>;
}

export default function OverviewView() {
  const status = useApp((s) => s.status);
  const statusLoading = useApp((s) => s.statusLoading);
  const config = useApp((s) => s.config);
  const home = useApp((s) => s.paths?.homeDir);
  const refreshStatus = useApp((s) => s.refreshStatus);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const engine = useEngine();

  const [data, setData] = useState<OverviewData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [startingServer, setStartingServer] = useState(false);

  // Never rejects: each part keeps its own error.
  const loadData = useCallback(
    () =>
      Promise.all([
        settle(publicServerStatus()),
        settle(chatsList()),
        settle(cliSessionsList()),
        settle(toolsCatalog()),
        settle(mcpStatuses()),
        settle(skillsList()),
      ]).then(([server, chats, sessions, tools, mcp, skills]) =>
        setData({ server, chats, sessions, tools, mcp, skills }),
      ),
    [],
  );

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshStatus(), engine.refresh(), loadData()]);
    setRefreshing(false);
  };

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Live updates for MCP servers and the API server.
  useEffect(() => {
    let alive = true;
    let unlisten: UnlistenFn[] = [];
    Promise.all([
      onMcpStatus((value) => setData((d) => d && { ...d, mcp: { ok: true, value } })),
      onPublicServerState((value) => setData((d) => d && { ...d, server: { ok: true, value } })),
    ])
      .then((fns) => {
        if (alive) unlisten = fns;
        else fns.forEach((f) => f());
      })
      // Live updates are optional: Refresh still loads everything.
      .catch(() => undefined);
    return () => {
      alive = false;
      unlisten.forEach((f) => f());
    };
  }, []);

  const model = modelState(status, statusLoading, home);
  const contextSize = status?.contextSize || config?.contextSize || 8192;
  const server = data?.server.ok ? data.server.value : null;
  const eng = engine.status;
  let serverDetail: ReactNode = "Start it to use the model from other apps.";
  if (data && !data.server.ok) serverDetail = data.server.error;
  else if (server?.running) {
    serverDetail = <span className="mono">{server.url || tildePath(server.socketPath ?? "", home)}</span>;
  } else if (server?.lastError) serverDetail = server.lastError;

  const newChat = async () => {
    setCreatingChat(true);
    try {
      const chat = await chatCreate();
      navigate("chat", { chatId: chat.id });
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setCreatingChat(false);
    }
  };

  const startServer = async () => {
    if (!config) return;
    setStartingServer(true);
    try {
      const s = await publicServerStart(config.publicServer);
      setData((d) => d && { ...d, server: { ok: true, value: s } });
      if (s.running) toast(`The API server is running${s.url ? ` at ${s.url}` : ""}.`, "success");
      else toast(s.lastError || "The API server did not start. Open the API Server page for details.", "error");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setStartingServer(false);
    }
  };

  const runSetupAgain = () => navigate("setup", { setupStep: 0 });

  const openLicense = async () => {
    try {
      await openInTerminal("sudo " + displayCommand(["license"], config?.fmPath));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <Page
      title="Overview"
      subtitle="Your on-device model at a glance"
      actions={
        <Button icon={<RefreshCw size={14} />} loading={refreshing} onClick={refresh}>
          Refresh
        </Button>
      }
    >
      <div className="ov">
        {/* Hero */}
        <section className={`card ov-hero ov-hero--${model.tone}`}>
          <IconTile color={heroColor(model.tone)} size="xl">
            <Cpu />
          </IconTile>
          <div className="ov-hero__text">
            <div className="ov-hero__eyebrow">Apple on-device model</div>
            <div className="ov-hero__title">
              <StatusDot tone={model.tone} pulse={statusLoading} />
              {model.title}
            </div>
            <div className="ov-hero__detail selectable">{model.detail}</div>
            <div className="row row--wrap ov-hero__badges">
              <Badge>{macosLabel(status)}</Badge>
              <Badge>{formatNumber(contextSize)} token context</Badge>
              <Badge tone="green">Runs on this Mac</Badge>
            </div>
          </div>
          <div className="ov-hero__cta">
            {model.ready ? (
              <Button
                variant="primary"
                size="lg"
                icon={<MessageSquarePlus size={16} />}
                loading={creatingChat}
                onClick={newChat}
              >
                New chat
              </Button>
            ) : (
              <Button variant="primary" size="lg" icon={<Wand2 size={16} />} onClick={() => navigate("setup")}>
                Open Setup Guide
              </Button>
            )}
          </div>
        </section>

        {/* Status cards */}
        <div className="ov-cards">
          <InfoCard
            icon={<FileText />}
            color="orange"
            label="License"
            value={!status ? "Unknown" : status.licenseAgreed ? "Agreed" : "Not agreed"}
            tone={!status ? undefined : status.licenseAgreed ? "green" : "orange"}
            detail={status?.licenseMessage || "Apple's terms for the on-device model."}
            action={
              status && !status.licenseAgreed ? (
                <Button size="sm" onClick={openLicense}>
                  Open Terminal
                </Button>
              ) : undefined
            }
          />
          <InfoCard
            icon={<TerminalSquare />}
            color="gray"
            label="fm tool"
            value={!status ? "Unknown" : status.binaryFound ? "Found" : "Not found"}
            tone={!status ? undefined : status.binaryFound ? "green" : "red"}
            detail={<span className="mono">{tildePath(status?.binaryPath || config?.fmPath || "", home)}</span>}
            action={
              <Button size="sm" onClick={() => navigate("settings")}>
                Change
              </Button>
            }
          />
          <InfoCard
            icon={<Laptop />}
            color="blue"
            label="macOS"
            value={status?.macosVersion ? `macOS ${status.macosVersion}` : "Unknown"}
            detail={status?.macosBuild ? `Build ${status.macosBuild}` : "fm needs macOS 27 or later."}
          />
          <InfoCard
            icon={<Gauge />}
            color="yellow"
            label="Context window"
            value={`${formatNumber(contextSize)} tokens`}
            detail="Instructions, history, tools and the reply all share this space."
            action={
              <Button size="sm" onClick={() => navigate("tokens")}>
                Count tokens
              </Button>
            }
          />
          <InfoCard
            icon={<Zap />}
            color="green"
            label="Chat engine"
            value={engine.loading ? "Checking…" : !eng ? "Unknown" : eng.running ? "Running" : "Stopped"}
            tone={!eng ? undefined : eng.running ? "green" : eng.lastError ? "red" : undefined}
            detail={
              engine.error ||
              eng?.lastError ||
              (eng?.running ? "Private socket, no network port." : "Starts on its own when you chat.")
            }
            action={
              <Button size="sm" icon={<RefreshCw size={12} />} loading={engine.restarting} onClick={engine.restart}>
                {eng?.running ? "Restart" : "Start"}
              </Button>
            }
          />
          <InfoCard
            icon={<Radio />}
            color="indigo"
            label="API server"
            value={!data ? "Checking…" : !data.server.ok ? "Unknown" : server?.running ? "Running" : "Off"}
            tone={server?.running ? "green" : server?.lastError ? "red" : undefined}
            detail={serverDetail}
            action={
              <Button size="sm" onClick={() => navigate("server")}>
                Open
              </Button>
            }
          />
        </div>

        {/* Counters */}
        <section>
          <h3 className="section__title">Your stuff</h3>
          <div className="ov-stats">
            <Stat label="Chats" route="chat" result={data?.chats} count={(v) => v.length} onOpen={navigate} />
            <Stat
              label="CLI sessions"
              route="sessions"
              result={data?.sessions}
              count={(v) => v.length}
              onOpen={navigate}
            />
            <Stat
              label="Tools enabled"
              route="tools"
              result={data?.tools}
              count={(v) => v.filter((t) => t.enabled).length}
              sub={(v) => `of ${v.length}`}
              onOpen={navigate}
            />
            <Stat
              label="MCP online"
              route="mcp"
              result={data?.mcp}
              count={(v) => v.filter((s) => s.state === "connected").length}
              sub={(v) => `of ${v.length} ${v.length === 1 ? "server" : "servers"}`}
              onOpen={navigate}
            />
            <Stat label="Skills" route="skills" result={data?.skills} count={(v) => v.length} onOpen={navigate} />
          </div>
        </section>

        {/* Quick actions */}
        <section>
          <h3 className="section__title">Quick actions</h3>
          <div className="ov-actions">
            <Action icon={<MessageSquarePlus />} color="blue" label="New chat" busy={creatingChat} onClick={newChat} />
            <Action
              icon={<TerminalSquare />}
              color="indigo"
              label="Playground"
              onClick={() => navigate("playground")}
            />
            <Action icon={<Braces />} color="teal" label="Schema Builder" onClick={() => navigate("schema")} />
            <Action
              icon={<Plug />}
              color="purple"
              label="Add MCP server"
              onClick={() => navigate("mcp", { openWizard: true })}
            />
            <Action
              icon={<Sparkles />}
              color="orange"
              label="Create skill"
              onClick={() => navigate("skills", { openWizard: true })}
            />
            {server?.running ? (
              <Action icon={<Radio />} color="green" label="Open API server" onClick={() => navigate("server")} />
            ) : (
              <Action
                icon={<Radio />}
                color="green"
                label="Start API server"
                busy={startingServer}
                onClick={startServer}
              />
            )}
            <Action icon={<Wand2 />} color="pink" label="Run setup again" onClick={runSetupAgain} />
            <Action icon={<BookOpen />} color="gray" label="Read the docs" onClick={() => navigate("docs")} />
          </div>
        </section>

        {/* Good to know */}
        <section className="card ov-know">
          <div className="row" style={{ marginBottom: 12 }}>
            <IconTile color="yellow" size="sm">
              <Sparkles />
            </IconTile>
            <div className="card__title" style={{ margin: 0 }}>
              Good to know
            </div>
          </div>
          <div className="ov-know__cols">
            <div>
              <div className="ov-know__head">Good at</div>
              <KnowItem good>Summaries of text you give it</KnowItem>
              <KnowItem good>Pulling out data, like names, dates or fields</KnowItem>
              <KnowItem good>Tagging and sorting content</KnowItem>
              <KnowItem good>Rewriting, shortening and changing tone</KnowItem>
            </div>
            <div>
              <div className="ov-know__head">Not so good at</div>
              <KnowItem>World facts. It is small and can be wrong.</KnowItem>
              <KnowItem>Math. Turn on the calculator tool.</KnowItem>
              <KnowItem>Writing or fixing code</KnowItem>
              <KnowItem>Long documents. The context is {formatNumber(contextSize)} tokens.</KnowItem>
            </div>
          </div>
          <div className="ov-know__foot small muted">
            <MessageSquare size={13} />
            Tip: short, clear prompts and few enabled tools give the best results.
          </div>
        </section>
      </div>
    </Page>
  );
}

function heroColor(tone: string): TileColor {
  if (tone === "green") return "green";
  if (tone === "orange") return "orange";
  if (tone === "red") return "red";
  return "gray";
}

function InfoCard(props: {
  icon: ReactNode;
  color: TileColor;
  label: string;
  value: ReactNode;
  tone?: "green" | "orange" | "red";
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card ov-card">
      <div className="ov-card__head">
        <IconTile color={props.color} size="sm">
          {props.icon}
        </IconTile>
        <span className="ov-card__label">{props.label}</span>
      </div>
      <div className="ov-card__value">
        {props.tone && <StatusDot tone={props.tone} />}
        {props.value}
      </div>
      {props.detail && <div className="ov-card__detail selectable">{props.detail}</div>}
      {props.action && <div className="ov-card__foot">{props.action}</div>}
    </div>
  );
}

function Stat<T>(props: {
  label: string;
  route: Route;
  result: Result<T> | undefined;
  count: (v: T) => number;
  sub?: (v: T) => string;
  onOpen: (route: Route) => void;
}) {
  const r = props.result;
  return (
    <button
      type="button"
      className="card ov-stat"
      onClick={() => props.onOpen(props.route)}
      title={r && !r.ok ? `Could not load: ${r.error}` : `Open ${props.label}`}
    >
      <span className="ov-stat__num">{!r ? "…" : r.ok ? formatNumber(props.count(r.value)) : "?"}</span>
      <span className="ov-stat__label">{props.label}</span>
      <span className="ov-stat__sub">
        {r?.ok && props.sub ? props.sub(r.value) : r && !r.ok ? "Not available" : " "}
      </span>
    </button>
  );
}

function Action(props: { icon: ReactNode; color: TileColor; label: string; busy?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="ov-action" onClick={props.onClick} disabled={props.busy}>
      <IconTile color={props.color} size="md">
        {props.icon}
      </IconTile>
      <span className="ov-action__label">{props.label}</span>
      {props.busy && <span className="spinner" />}
    </button>
  );
}

function KnowItem(props: { good?: boolean; children: ReactNode }) {
  return (
    <div className="ov-know__item">
      {props.good ? <Check size={14} className="ov-know__yes" /> : <X size={14} className="ov-know__no" />}
      <span>{props.children}</span>
    </div>
  );
}
