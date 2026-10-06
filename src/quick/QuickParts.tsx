// Small parts of the Quick Chat window: the glyph, the header, the pill and the
// empty state. The two layers (overlay and pill) are both rendered; quick.css
// shows the one that fits the window size.

import { Calculator, ChevronRight, Clock, GripVertical, MessageCircle, PenLine } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import type { PillTone } from "./pill";

/** The conversation glyph; a spinner while a turn runs. */
export function Glyph(props: { size: "sm" | "lg"; busy?: boolean }) {
  return (
    <span className={cx("qa-glyph", `qa-glyph--${props.size}`, props.busy && "qa-glyph--busy")} aria-hidden>
      {props.busy ? <span className="qa-spin" /> : <MessageCircle size={props.size === "lg" ? 18 : 13} />}
    </span>
  );
}

/** The top bar of the overlay. Empty space and the titles drag the window. */
export function QuickHeader(props: { title?: string | null; children?: ReactNode }) {
  return (
    <header className="qa-head" data-tauri-drag-region>
      <span className="qa-head__glyph" data-tauri-drag-region>
        <Glyph size="sm" />
      </span>
      <span className="qa-head__name" data-tauri-drag-region>
        Quick Chat
      </span>
      {props.title && (
        <>
          <ChevronRight size={12} className="qa-head__sep" aria-hidden />
          <span className="qa-head__title" data-tauri-drag-region title={props.title}>
            {props.title}
          </span>
        </>
      )}
      <span className="spacer" data-tauri-drag-region />
      <div className="qa-head__actions">{props.children}</div>
    </header>
  );
}

/**
 * The pill (picture in picture). A click anywhere except the grip opens the
 * overlay again; the grip drags the window.
 */
export function QuickPill(props: { text: string; tone: PillTone; busy?: boolean; onOpen: () => void }) {
  return (
    <div
      className="qa-layer qa-pill"
      role="button"
      tabIndex={0}
      title={props.text}
      aria-label={`Open Quick Chat: ${props.text}`}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        props.onOpen();
      }}
    >
      <Glyph size="lg" busy={props.busy} />
      <span className={cx("qa-pill__text", `qa-pill__text--${props.tone}`)}>{props.text}</span>
      <span
        className="qa-pill__grip"
        data-tauri-drag-region
        title="Drag to move"
        aria-hidden
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={15} />
      </span>
    </div>
  );
}

const SUGGESTIONS: { text: string; icon: ReactNode }[] = [
  { text: "What time is it?", icon: <Clock size={13} /> },
  { text: "What is 18% of 2,450?", icon: <Calculator size={13} /> },
  { text: "Write a short thank-you note to a friend", icon: <PenLine size={13} /> },
];

/** Empty conversation: a short line and three suggestions that send right away. */
export function QuickEmpty(props: { onPick: (text: string) => void; disabled?: boolean }) {
  return (
    <div className="qa-empty">
      <Glyph size="lg" />
      <div className="qa-empty__title">Ask anything</div>
      <div className="qa-empty__text">The model runs on this Mac, so your chat stays private.</div>
      <div className="qa-chips">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            type="button"
            className="qa-chip"
            disabled={props.disabled}
            onClick={() => props.onPick(s.text)}
          >
            {s.icon}
            <span className="truncate">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
