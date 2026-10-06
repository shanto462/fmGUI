// Small pieces shared by the Setup, Overview and Settings views. OWNER: agent "ui-shell".

import { AlertCircle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Spinner, cx } from "../../components/ui";
import { engineRestart, engineStatus, errorMessage } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { AppConfig, EngineStatus, FmStatus } from "../../lib/types";
import "./shared.css";

export type Tone = "green" | "orange" | "red" | "gray";

export type TileColor =
  | "accent"
  | "blue"
  | "indigo"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "gray";

/** A colored rounded square with a white glyph, like the icons in System Settings. */
export function IconTile(props: { color: TileColor; size?: "sm" | "md" | "lg" | "xl"; children: ReactNode }) {
  return (
    <span className={cx("shell-tile", `shell-tile--${props.color}`, `shell-tile--${props.size ?? "md"}`)} aria-hidden>
      {props.children}
    </span>
  );
}

export interface ModelState {
  tone: Tone;
  title: string;
  detail: string;
  ready: boolean;
}

/** One readable state for the model, in the same order as the sidebar status. */
export function modelState(status: FmStatus | null, loading: boolean): ModelState {
  if (!status) {
    return loading
      ? { tone: "gray", title: "Checking…", detail: "Asking fm about the model.", ready: false }
      : { tone: "gray", title: "Unknown", detail: "The status check did not finish. Try Refresh.", ready: false };
  }
  if (!status.binaryFound) {
    return {
      tone: "red",
      title: "fm not found",
      detail: `There is no fm tool at ${status.binaryPath || "the set path"}. It ships with macOS 27.`,
      ready: false,
    };
  }
  if (!status.licenseAgreed) {
    return {
      tone: "orange",
      title: "License not agreed",
      detail: status.licenseMessage || "Run sudo fm license in Terminal to read and accept the terms.",
      ready: false,
    };
  }
  if (!status.modelAvailable) {
    return {
      tone: "orange",
      title: "Model unavailable",
      detail: status.availabilityMessage || "Apple Intelligence is off, or the model is still downloading.",
      ready: false,
    };
  }
  return {
    tone: "green",
    title: "Ready",
    detail: status.availabilityMessage || "The on-device model is ready.",
    ready: true,
  };
}

export type CheckState = "ok" | "warn" | "bad" | "pending" | "unknown";

export function CheckIcon(props: { state: CheckState }) {
  switch (props.state) {
    case "ok":
      return <CheckCircle2 size={18} className="shell-check shell-check--ok" />;
    case "warn":
      return <AlertCircle size={18} className="shell-check shell-check--warn" />;
    case "bad":
      return <XCircle size={18} className="shell-check shell-check--bad" />;
    case "pending":
      return <Spinner />;
    default:
      return <CircleDashed size={18} className="shell-check" />;
  }
}

/** A `.group__row` with a check icon, a label and a value on the right. */
export function CheckRow(props: {
  state: CheckState;
  label: ReactNode;
  hint?: ReactNode;
  value?: ReactNode;
  mono?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="group__row shell-check-row">
      <CheckIcon state={props.state} />
      <div className="group__label">
        <div>{props.label}</div>
        {props.hint && <div className="group__hint">{props.hint}</div>}
      </div>
      {props.value != null && props.value !== "" && (
        <div className={cx("shell-check-row__value selectable", props.mono && "mono")}>{props.value}</div>
      )}
      {props.action}
    </div>
  );
}

/** Loads the private chat engine status and restarts it on demand. */
export function useEngine(auto = true) {
  const toast = useApp((s) => s.toast);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(auto);
  const [restarting, setRestarting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await engineStatus());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const restart = useCallback(async () => {
    setRestarting(true);
    try {
      const next = await engineRestart();
      setStatus(next);
      setError(null);
      if (next.running) toast("The chat engine is running.", "success");
      else toast(next.lastError || "The chat engine did not start.", "error");
      return next;
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast(message, "error");
      return null;
    } finally {
      setRestarting(false);
    }
  }, [toast]);

  useEffect(() => {
    if (auto) void refresh();
  }, [auto, refresh]);

  return { status, error, loading, restarting, refresh, restart };
}

export type EngineHandle = ReturnType<typeof useEngine>;

export function engineCheckState(engine: EngineHandle): CheckState {
  if (engine.loading || engine.restarting) return "pending";
  if (engine.error) return "unknown";
  if (!engine.status) return "unknown";
  if (engine.status.running) return "ok";
  return engine.status.lastError ? "bad" : "warn";
}

/** Saves a config change through the store and shows a small toast. */
export function useSaveConfig() {
  const updateConfig = useApp((s) => s.updateConfig);
  const toast = useApp((s) => s.toast);
  return useCallback(
    async (change: (draft: AppConfig) => void, message: string | null = "Saved") => {
      const saved = await updateConfig((draft) => {
        change(draft);
      });
      if (saved && message) toast(message, "success");
      return saved;
    },
    [updateConfig, toast],
  );
}

/** Replaces the home folder with "~" for display. */
export function tildify(path: string, home: string | null | undefined): string {
  if (home && (path === home || path.startsWith(home + "/"))) return "~" + path.slice(home.length);
  return path;
}

/** "macOS 27.0.1 (26A434)", or a fallback when unknown. */
export function macosLabel(status: FmStatus | null): string {
  if (!status?.macosVersion) return "Unknown";
  return status.macosBuild ? `macOS ${status.macosVersion} (${status.macosBuild})` : `macOS ${status.macosVersion}`;
}

/** True when the macOS major version is known and below 27. */
export function isOldMacos(status: FmStatus | null): boolean {
  const major = parseInt(status?.macosVersion ?? "", 10);
  return Number.isFinite(major) && major < 27;
}
