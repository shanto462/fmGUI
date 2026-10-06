// App shell: sidebar navigation and the routed pages.
// Pages live in src/views/<Name>View.tsx, their parts in src/views/<name>/.

import {
  MessageCircleMore,
  BookOpen,
  Boxes,
  Braces,
  Gauge,
  History,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Plug,
  Radio,
  Settings,
  Sparkles,
  TerminalSquare,
  Wand2,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Empty, StatusDot, Toasts } from "./components/ui";
import { errorMessage, isTauri, onOpenChat, quickSetMode } from "./lib/api";
import { cx } from "./lib/cx";
import { isLocked, useApp, type Route } from "./lib/store";
import ChatView from "./views/ChatView";
import DocsView from "./views/DocsView";
import McpView from "./views/McpView";
import OverviewView from "./views/OverviewView";
import PlaygroundView from "./views/PlaygroundView";
import SchemaView from "./views/SchemaView";
import ServerView from "./views/ServerView";
import SessionsView from "./views/SessionsView";
import SettingsView from "./views/SettingsView";
import SetupView from "./views/SetupView";
import SkillsView from "./views/SkillsView";
import TokensView from "./views/TokensView";
import ToolsView from "./views/ToolsView";

interface NavItem {
  route: Route;
  label: string;
  icon: ReactNode;
}

const NAV: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { route: "overview", label: "Overview", icon: <LayoutDashboard size={16} /> },
      { route: "chat", label: "Chat", icon: <MessageSquare size={16} /> },
      { route: "sessions", label: "CLI Sessions", icon: <History size={16} /> },
    ],
  },
  {
    title: "Build",
    items: [
      { route: "playground", label: "Playground", icon: <TerminalSquare size={16} /> },
      { route: "schema", label: "Schema Builder", icon: <Braces size={16} /> },
      { route: "tokens", label: "Token Counter", icon: <Gauge size={16} /> },
    ],
  },
  {
    title: "Extend",
    items: [
      { route: "tools", label: "Tools", icon: <Wrench size={16} /> },
      { route: "mcp", label: "MCP Servers", icon: <Plug size={16} /> },
      { route: "skills", label: "Skills", icon: <Sparkles size={16} /> },
    ],
  },
  {
    title: "Run",
    items: [{ route: "server", label: "API Server", icon: <Radio size={16} /> }],
  },
  {
    title: "Learn",
    items: [
      { route: "docs", label: "Docs", icon: <BookOpen size={16} /> },
      { route: "setup", label: "Setup Guide", icon: <Wand2 size={16} /> },
    ],
  },
];

const VIEWS: Record<Route, () => ReactNode> = {
  setup: () => <SetupView />,
  overview: () => <OverviewView />,
  chat: () => <ChatView />,
  sessions: () => <SessionsView />,
  playground: () => <PlaygroundView />,
  schema: () => <SchemaView />,
  tokens: () => <TokensView />,
  tools: () => <ToolsView />,
  mcp: () => <McpView />,
  skills: () => <SkillsView />,
  server: () => <ServerView />,
  docs: () => <DocsView />,
  settings: () => <SettingsView />,
};

function SidebarStatus() {
  const status = useApp((s) => s.status);
  const navigate = useApp((s) => s.navigate);
  let tone: "green" | "orange" | "red" | "gray" = "gray";
  let text = "Checking…";
  if (status) {
    if (!status.binaryFound) [tone, text] = ["red", "fm not found"];
    else if (!status.licenseAgreed) [tone, text] = ["orange", "License not agreed"];
    else if (!status.modelAvailable) [tone, text] = ["orange", "Model unavailable"];
    else [tone, text] = ["green", "On-device model ready"];
  }
  return (
    <button className="sidebar__item" onClick={() => navigate("overview")} title={status?.availabilityMessage}>
      <StatusDot tone={tone} />
      <span className="truncate small">{text}</span>
    </button>
  );
}

export default function App() {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const load = useApp((s) => s.load);
  const status = useApp((s) => s.status);
  const loaded = useApp((s) => s.loaded);
  const toast = useApp((s) => s.toast);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Quick Chat needs the same checks as the locked pages (Chat uses the same engine).
  const quickLocked = loaded && isLocked("chat", status);

  const start = useCallback(
    () =>
      load()
        .then(() => setLoadError(null))
        .catch((err) => setLoadError(errorMessage(err))),
    [load],
  );

  useEffect(() => {
    if (isTauri()) void start();
  }, [start]);

  // Quick Chat "Open in fmGUI": show that chat on the Chat page.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    onOpenChat((chatId) => useApp.getState().openChat(chatId))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Safety net: every call shows its own error, but if one slips through, the
  // user still sees it instead of a silent failure.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      e.preventDefault();
      useApp.getState().toast(errorMessage(e.reason), "error");
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  if (!isTauri()) {
    return (
      <div className="empty">
        Open this page inside the fmGUI app (npm run app). For a preview with fake data, add ?mock=1 to the address.
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__top" data-tauri-drag-region />
        <nav className="sidebar__nav">
          {NAV.map((group, i) => (
            <div key={i} className="sidebar__group">
              {group.title && <div className="sidebar__group-title">{group.title}</div>}
              {group.items.map((item) => {
                const locked = loaded && isLocked(item.route, status);
                return (
                  <button
                    key={item.route}
                    className={cx(
                      "sidebar__item",
                      route === item.route && "sidebar__item--active",
                      locked && "sidebar__item--locked",
                    )}
                    title={locked ? "Finish the setup to open this page" : undefined}
                    onClick={() => navigate(item.route)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {locked && <Lock size={12} className="sidebar__lock" />}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">
          <SidebarStatus />
          {/* Opens the floating Quick Chat and minimizes this window. */}
          <button
            className={cx("sidebar__item", quickLocked && "sidebar__item--locked")}
            title={quickLocked ? "Finish the setup to use Quick Chat" : "Ask from anywhere. This window minimizes."}
            onClick={() =>
              quickLocked
                ? navigate("setup")
                : quickSetMode("overlay").catch((err) => toast(errorMessage(err), "error"))
            }
          >
            <MessageCircleMore size={16} />
            <span>Quick Chat</span>
          </button>
          <button
            className={cx("sidebar__item", route === "settings" && "sidebar__item--active")}
            onClick={() => navigate("settings")}
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
        </div>
      </aside>
      <main className="content">
        {loaded ? (
          VIEWS[route]()
        ) : loadError ? (
          <Empty
            icon={<Boxes size={28} />}
            title="fmGUI could not load its settings"
            action={<Button onClick={() => void start()}>Try again</Button>}
          >
            <span className="selectable">{loadError}</span>
          </Empty>
        ) : (
          <div className="empty">
            <Boxes size={28} />
            Checking fm…
          </div>
        )}
      </main>
      <Toasts />
    </div>
  );
}
