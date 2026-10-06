// Global UI state: navigation, config, fm status, toasts, and small hand-offs
// between pages.

import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { create } from "zustand";
import * as api from "./api";
import type { AppConfig, FmStatus, PathsInfo } from "./types";

export type Route =
  | "setup"
  | "overview"
  | "chat"
  | "sessions"
  | "playground"
  | "schema"
  | "tokens"
  | "tools"
  | "mcp"
  | "skills"
  | "server"
  | "docs"
  | "settings";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error";
  text: string;
}

/** Data one page hands to another when navigating. Read once, then clear. */
export interface Handoff {
  /** Schema Builder → Playground: JSON schema text. */
  playgroundSchema?: string;
  /** Any page → Chat: open this chat id. */
  chatId?: string;
  /** Any page → Docs: open this doc file name (e.g. "06-tools.md"). */
  docName?: string;
  /** Any page → Tools/MCP/Skills: open the "add" wizard right away. */
  openWizard?: boolean;
  /** Any page → Setup: start on this step ("Run setup again" passes 0). */
  setupStep?: number;
}

interface AppStore {
  route: Route;
  handoff: Handoff;
  /** Quick Chat → the open Chat page: open this chat. A new object for every request. */
  chatRequest: { id: string } | null;
  config: AppConfig | null;
  status: FmStatus | null;
  paths: PathsInfo | null;
  statusLoading: boolean;
  /** True after the first config + status load. */
  loaded: boolean;
  toasts: Toast[];

  navigate: (route: Route, handoff?: Handoff) => void;
  /** Returns the hand-off and clears it. For an effect that acts on it once; pages that only need it for their first render use `useHandoff`. */
  takeHandoff: () => Handoff;
  /** Opens a chat on the Chat page (Quick Chat "Open in fmGUI"). Works when the Chat page is open already. */
  openChat: (id: string) => void;
  /** Loads config, paths and the fm status. Throws when the config or paths cannot be read. */
  load: () => Promise<void>;
  refreshStatus: () => Promise<FmStatus | null>;
  /** Saves a modified copy of the config. */
  updateConfig: (change: (draft: AppConfig) => AppConfig | void) => Promise<AppConfig | null>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: string) => void;
}

/** Pages that stay open while a check fails, because they help fix problems. */
const OPEN_ROUTES: ReadonlySet<Route> = new Set<Route>(["setup", "docs", "settings"]);

/** True when fm is found, the model is available and the license is agreed. */
export function isReady(status: FmStatus | null): boolean {
  return !!status?.binaryFound && !!status.modelAvailable && !!status.licenseAgreed;
}

/** A page is locked while one of the checks fails. */
export function isLocked(route: Route, status: FmStatus | null): boolean {
  return !OPEN_ROUTES.has(route) && !isReady(status);
}

// Rust emits "config-changed" after every save, including saves the engine
// makes itself (an "Always allow" approval). Keep the store in sync.
let configListener: Promise<unknown> | null = null;
let loading: Promise<void> | null = null;

/** First load: config, paths and the fm checks. Opens Overview when every check passes, else Setup. */
async function loadApp() {
  const { getState: get, setState: set } = useApp;
  const [config, paths] = await Promise.all([api.getConfig(), api.getPaths()]);
  set({ config, paths });
  // Without the listener the store only misses saves made by the engine itself.
  configListener ??= listen<AppConfig>("config-changed", (e) => {
    set({ config: e.payload });
    guard();
  }).catch(() => null);
  const status = await get().refreshStatus();
  const ready = isReady(status);
  set({ loaded: true, route: ready ? "overview" : "setup" });
  // Every check passes, so there is nothing left to set up: mark setup as done.
  if (ready && !config.setupCompleted) {
    const saved = await get().updateConfig((c) => {
      c.setupCompleted = true;
    });
    if (saved) get().toast("Everything is ready.", "success");
  }
}

export const useApp = create<AppStore>((set, get) => ({
  route: "overview",
  handoff: {},
  chatRequest: null,
  config: null,
  status: null,
  paths: null,
  statusLoading: false,
  loaded: false,
  toasts: [],

  navigate: (route, handoff = {}) => {
    const { status, loaded } = get();
    if (loaded && isLocked(route, status)) {
      set({ route: "setup", handoff: {} });
      get().toast("Finish the setup first. Other pages open when fm, the model and the license are ready.");
      return;
    }
    set({ route, handoff });
  },

  takeHandoff: () => {
    const h = get().handoff;
    set({ handoff: {} });
    return h;
  },

  // The Chat page reads a hand-off only when it opens, so an open Chat page gets a request instead.
  openChat: (id) => {
    if (get().route === "chat") set({ chatRequest: { id } });
    else get().navigate("chat", { chatId: id });
  },

  // Calls made while a load runs share it (React runs start-up effects twice in development).
  load: () => {
    loading ??= loadApp().catch((err) => {
      loading = null; // so "Try again" can run it again
      throw err;
    });
    return loading;
  },

  refreshStatus: async () => {
    set({ statusLoading: true });
    try {
      const status = await api.fmStatus();
      set({ status });
      guard();
      return status;
    } catch (err) {
      get().toast(api.errorMessage(err), "error");
      return null;
    } finally {
      set({ statusLoading: false });
    }
  },

  updateConfig: async (change) => {
    const current = get().config;
    if (!current) return null;
    const draft: AppConfig = structuredClone(current);
    const next = change(draft) ?? draft;
    try {
      const saved = await api.saveConfig(next);
      set({ config: saved });
      guard();
      return saved;
    } catch (err) {
      get().toast(api.errorMessage(err), "error");
      return null;
    }
  },

  toast: (text, kind = "info") => {
    const id = api.newId();
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** Sends the user to Setup when the open page becomes locked (for example the
 *  license check fails later). */
function guard() {
  const s = useApp.getState();
  if (s.loaded && isLocked(s.route, s.status)) useApp.setState({ route: "setup", handoff: {} });
}

/**
 * The hand-off the current page was opened with. It is read once when the page
 * mounts and then cleared in the store, so it does not apply again later.
 */
export function useHandoff(): Handoff {
  const [handoff] = useState(() => useApp.getState().handoff);
  useEffect(() => {
    if (Object.keys(useApp.getState().handoff).length > 0) useApp.setState({ handoff: {} });
  }, []);
  return handoff;
}
