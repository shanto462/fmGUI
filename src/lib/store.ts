// CONTRACT FILE (owned by the lead). Global UI state: navigation, config,
// fm status, and small hand-offs between pages.

import { listen } from "@tauri-apps/api/event";
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
}

interface AppStore {
  route: Route;
  handoff: Handoff;
  config: AppConfig | null;
  status: FmStatus | null;
  paths: PathsInfo | null;
  statusLoading: boolean;
  /** True after the first config + status load. */
  loaded: boolean;
  toasts: Toast[];

  navigate: (route: Route, handoff?: Handoff) => void;
  takeHandoff: () => Handoff;
  load: () => Promise<void>;
  refreshStatus: () => Promise<FmStatus | null>;
  /** Saves a modified copy of the config. */
  updateConfig: (change: (draft: AppConfig) => AppConfig | void) => Promise<AppConfig | null>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: string) => void;
}

/** Pages that stay open before setup is done, because they help fix problems. */
export const OPEN_ROUTES: ReadonlySet<Route> = new Set<Route>(["setup", "docs", "settings"]);

/** True when setup is finished and fm, the model and the license are all OK. */
export function isReady(config: AppConfig | null, status: FmStatus | null): boolean {
  return !!config?.setupCompleted && !!status?.binaryFound && !!status.modelAvailable && !!status.licenseAgreed;
}

/** A page is locked until the app is ready. */
export function isLocked(route: Route, config: AppConfig | null, status: FmStatus | null): boolean {
  return !OPEN_ROUTES.has(route) && !isReady(config, status);
}

// Rust emits "config-changed" after every save, including saves the engine
// makes itself (an "Always allow" approval). Keep the store in sync.
let configListener: Promise<unknown> | null = null;

export const useApp = create<AppStore>((set, get) => ({
  route: "overview",
  handoff: {},
  config: null,
  status: null,
  paths: null,
  statusLoading: false,
  loaded: false,
  toasts: [],

  navigate: (route, handoff = {}) => {
    const { config, status, loaded } = get();
    if (loaded && isLocked(route, config, status)) {
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

  load: async () => {
    const [config, paths] = await Promise.all([api.getConfig(), api.getPaths()]);
    set({ config, paths });
    configListener ??= listen<AppConfig>("config-changed", (e) => {
      set({ config: e.payload });
      guard();
    });
    const status = await get().refreshStatus();
    set({ loaded: true, route: isReady(config, status) ? "overview" : "setup" });
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
 *  license check fails later, or "Run setup again" was pressed). */
function guard() {
  const s = useApp.getState();
  if (s.loaded && isLocked(s.route, s.config, s.status)) useApp.setState({ route: "setup", handoff: {} });
}
