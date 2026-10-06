// Mock mode only (?mock=1&window=quick): a fake desktop with a fake window that
// takes the Quick Chat size and place for each mode, like quick.rs does. A click
// on the desktop is a "click outside"; the menu bar button acts like the tray icon.
// Never loaded in the real app.

import { useEffect, useState, type ReactNode } from "react";
import { onQuickMode } from "../lib/api";
import { cx } from "../lib/cx";
import type { MockBackend } from "../lib/mock";
import type { QuickMode } from "../lib/types";
import "./mock-frame.css";

export function MockQuickFrame(props: { backend: MockBackend; children: ReactNode }) {
  const { backend } = props;
  const [mode, setMode] = useState<QuickMode>(backend.quickMode);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    onQuickMode(setMode)
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

  return (
    <div
      className="qm-desktop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) backend.quickBlur();
      }}
    >
      <div className="qm-menubar">
        <span className="qm-menubar__name">Mock desktop</span>
        <span className="qm-menubar__hint">Click the desktop to click outside Quick Chat.</span>
        <span className="spacer" />
        <span className="qm-menubar__mode">Mode: {mode}</span>
        <button type="button" className="qm-menubar__icon" onClick={() => backend.quickToggle()}>
          Menu bar icon
        </button>
      </div>
      <div className={cx("qm-window", `qm-window--${mode}`)}>{props.children}</div>
    </div>
  );
}
