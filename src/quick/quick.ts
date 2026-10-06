// Hooks and helpers for the Quick Chat window (Rust side: src-tauri/src/quick.rs).

import { useEffect, useState, type RefObject } from "react";
import { onQuickMode, quickHold, quickMode } from "../lib/api";
import type { QuickMode } from "../lib/types";

/**
 * The window mode, from `quick_mode` at start and the "quick-mode" events after.
 * `opened` counts how often the overlay opened, so effects can run on each open.
 */
export function useQuickMode(): { mode: QuickMode; opened: number } {
  const [mode, setMode] = useState<QuickMode>("hidden");
  const [opened, setOpened] = useState(0);

  useEffect(() => {
    let disposed = false;
    let heard = false;
    let unlisten: (() => void) | null = null;
    const apply = (next: QuickMode) => {
      setMode(next);
      if (next === "overlay") setOpened((n) => n + 1);
    };
    onQuickMode((next) => {
      heard = true;
      apply(next);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    // An event is newer than this answer, so it wins.
    quickMode()
      .then((now) => {
        if (!disposed && !heard) apply(now);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return { mode, opened };
}

/** Runs `work` (a file panel) while the overlay stays open when it loses the focus. */
export async function withHold<T>(work: () => Promise<T>): Promise<T> {
  await quickHold(true).catch(() => undefined);
  try {
    return await work();
  } finally {
    await quickHold(false).catch(() => undefined);
  }
}

/**
 * Focuses the element now and again over the next moments until it has the
 * focus: Rust shows the window and sends the mode right away, and the page may
 * get its new size a little later. Returns a cleanup function.
 */
export function focusSoon(ref: RefObject<HTMLElement | null>): () => void {
  let done = false;
  const timers = [0, 40, 120, 300].map((ms) =>
    setTimeout(() => {
      const el = ref.current;
      if (done || !el) return;
      if (document.activeElement !== el) el.focus();
      done = document.activeElement === el;
    }, ms),
  );
  return () => timers.forEach(clearTimeout);
}
