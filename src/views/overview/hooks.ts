// Hooks shared by the Setup, Overview and Settings views.

import { useCallback, useEffect, useState } from "react";
import { engineRestart, engineStatus, errorMessage } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { AppConfig, EngineStatus } from "../../lib/types";
import type { CheckState } from "./status";

/** Loads the private chat engine status and restarts it on demand. */
export function useEngine() {
  const toast = useApp((s) => s.toast);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  // Load once on mount. The state updates happen after the await, not in the effect body.
  useEffect(() => {
    let alive = true;
    engineStatus()
      .then((next) => {
        if (!alive) return;
        setStatus(next);
        setError(null);
      })
      .catch((err) => alive && setError(errorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

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
