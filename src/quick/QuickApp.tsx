// Root of the Quick Chat window (window label "quick", see src-tauri/src/quick.rs).
// macOS draws the Liquid Glass background, so this page stays transparent.
// Two layers: the overlay (a chat) and the pill. quick.css shows the one that
// fits the window size, so the layout always matches what Rust set.

import { Boxes, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, IconButton, Spinner } from "../components/ui";
import { errorMessage, isTauri, openMainWindow, quickClose, quickSetMode } from "../lib/api";
import { isReady, useApp } from "../lib/store";
import { useQuickMode } from "./quick";
import { QuickChat } from "./QuickChat";
import { QuickHeader, QuickPill } from "./QuickParts";
import "./quick.css";

export default function QuickApp() {
  const load = useApp((s) => s.load);
  const loaded = useApp((s) => s.loaded);
  const status = useApp((s) => s.status);
  const refreshStatus = useApp((s) => s.refreshStatus);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const { mode, opened } = useQuickMode();

  // Config and fm status, like the main window. Its route is not used here.
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

  // Setup may be done in the main window by now: check again when the overlay opens.
  useEffect(() => {
    if (opened > 0 && useApp.getState().loaded && !isReady(useApp.getState().status)) void refreshStatus();
  }, [opened, refreshStatus]);

  // Esc shrinks the overlay to the pill (an open image preview closes first).
  useEffect(() => {
    if (mode !== "overlay") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".modal-backdrop")) return;
      e.preventDefault();
      quickSetMode("pip").catch(() => undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // Safety net, like the main window: a missed error still shows.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      e.preventDefault();
      useApp.getState().toast(errorMessage(e.reason), "error");
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  if (!isTauri()) {
    return <div className="empty">Open Quick Chat from the fmGUI menu bar icon.</div>;
  }

  const ready = loaded && isReady(status);
  return (
    <div className="qa">
      {ready ? (
        <QuickChat key={session} mode={mode} opened={opened} onReset={() => setSession((n) => n + 1)} />
      ) : (
        <QuickGate loaded={loaded} error={loadError} onRetry={() => void start()} />
      )}
    </div>
  );
}

/** Shown until the app is loaded and fm, the model and the license are ready. */
function QuickGate(props: { loaded: boolean; error: string | null; onRetry: () => void }) {
  const pill = props.error
    ? { text: "Could not load the settings", tone: "error" as const }
    : props.loaded
      ? { text: "Finish setup in fmGUI first.", tone: "warn" as const }
      : { text: "Checking fm…", tone: "muted" as const };

  return (
    <>
      <section className="qa-layer qa-overlay" aria-label="Quick Chat">
        <QuickHeader>
          <IconButton label="Close" onClick={() => quickClose().catch(() => undefined)}>
            <X size={16} />
          </IconButton>
        </QuickHeader>
        <div className="qa-gate">
          {props.error ? (
            <>
              <Boxes size={26} />
              <div className="qa-gate__title">fmGUI could not load its settings</div>
              <div className="qa-gate__text selectable">{props.error}</div>
              <Button onClick={props.onRetry}>Try again</Button>
            </>
          ) : props.loaded ? (
            <>
              <Wrench size={26} />
              <div className="qa-gate__title">Finish setup in fmGUI first.</div>
              <div className="qa-gate__text">
                Quick Chat needs the fm command, the on-device model and the license. The Setup Guide in fmGUI helps you
                with each step.
              </div>
              <Button variant="primary" onClick={() => openMainWindow(null).catch(() => undefined)}>
                Open fmGUI
              </Button>
            </>
          ) : (
            <>
              <Spinner />
              <div className="qa-gate__text">Checking fm…</div>
            </>
          )}
        </div>
      </section>
      <QuickPill text={pill.text} tone={pill.tone} onOpen={() => quickSetMode("overlay").catch(() => undefined)} />
    </>
  );
}
