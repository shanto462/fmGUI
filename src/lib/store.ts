// CONTRACT FILE (owned by the lead). Global UI state: navigation, config,
// fm status, and small hand-offs between pages.

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

export const useApp = create<AppStore>((set, get) => ({
  route: "overview",
  handoff: {},
  config: null,
  status: null,
  paths: null,
  statusLoading: false,
  toasts: [],

  navigate: (route, handoff = {}) => set({ route, handoff }),

  takeHandoff: () => {
    const h = get().handoff;
    set({ handoff: {} });
    return h;
  },

  load: async () => {
    const [config, paths] = await Promise.all([api.getConfig(), api.getPaths()]);
    set({ config, paths, route: config.setupCompleted ? "overview" : "setup" });
    await get().refreshStatus();
  },

  refreshStatus: async () => {
    set({ statusLoading: true });
    try {
      const status = await api.fmStatus();
      set({ status });
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
