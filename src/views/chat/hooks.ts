// Hooks shared by Chat and CLI Sessions. OWNER: agent "ui-chat".

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isImagePath } from "./utils";

/**
 * Keeps a scroll view pinned to the bottom while content grows, unless the
 * user scrolled up. `resetKey` (e.g. the chat id) jumps back to the bottom.
 */
export function useAutoScroll(resetKey: string | null) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stick.current = bottom;
    setAtBottom(bottom);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    stick.current = true;
    setAtBottom(true);
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useLayoutEffect(() => {
    stick.current = true;
    setAtBottom(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [resetKey]);

  useEffect(() => {
    const content = contentRef.current;
    const scroller = scrollRef.current;
    if (!content || !scroller) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) scroller.scrollTop = scroller.scrollHeight;
    });
    ro.observe(content);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, []);

  return { scrollRef, contentRef, onScroll, atBottom, scrollToBottom };
}

/**
 * Image files dragged onto the window. Tauri handles file drops natively
 * (paths, not File objects), so this listens to the webview drag-drop events.
 * Returns true while image files hover over the window.
 */
export function useImageFileDrop(onPaths: (paths: string[]) => void, enabled = true): boolean {
  const [over, setOver] = useState(false);
  const cb = useRef(onPaths);
  cb.current = onPaths;

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter") setOver(p.paths.some(isImagePath));
        else if (p.type === "leave") setOver(false);
        else if (p.type === "drop") {
          setOver(false);
          const images = p.paths.filter(isImagePath);
          if (images.length) cb.current(images);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Not inside Tauri or events not allowed: HTML drag and drop still works.
      });
    return () => {
      disposed = true;
      unlisten?.();
      setOver(false);
    };
  }, [enabled]);

  return over;
}

/** Observes an element's height (used to pad the message list under the composer). */
export function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return { ref, height };
}
