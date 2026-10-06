// Base styles first, so page styles (imported by App's views) can override them.
import "./styles/tokens.css";
import "./styles/base.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { appReady, isTauri } from "./lib/api";
import type { MockBackend } from "./lib/mock";
import QuickApp from "./quick/QuickApp";

// Browser preview with fake data (dev only): http://localhost:1420/?mock=1
// Variants: ?mock=nolicense, ?mock=nofm, ?mock=setup. Add &window=quick for Quick Chat.
let backend: MockBackend | null = null;
if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
  const { installMocks } = await import("./lib/mock");
  backend = installMocks();
}

// Both windows load this page; the window label picks the root.
const label = isTauri() ? getCurrentWindow().label : "main";
let root: ReactNode = label === "quick" ? <QuickApp /> : <App />;

// Mock mode has no real window: show Quick Chat in a fake one that follows its mode.
if (import.meta.env.DEV && backend && label === "quick") {
  const { MockQuickFrame } = await import("./quick/MockQuickFrame");
  root = <MockQuickFrame backend={backend}>{root}</MockQuickFrame>;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode>{root}</React.StrictMode>);

// Tell Rust the page is alive (after the first paint).
if (isTauri()) requestAnimationFrame(() => void appReady().catch(() => undefined));
