// Shared building blocks for the "workbench" pages (Playground, Schema Builder,
// Token Counter, API Server, Docs): a two-pane layout with an inspector on the
// left and output on the right.

import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, IconButton } from "../../components/ui";
import { cx } from "../../lib/cx";
import { tildePath } from "../../lib/paths";
import { useApp } from "../../lib/store";
import "./workbench.css";

// ---------- Layout ----------

/** Two panes: inspector (left) and main output (right). */
export function Workbench(props: { side: ReactNode; children: ReactNode; sideWidth?: number; sideFooter?: ReactNode }) {
  return (
    <div className="wb">
      <aside className="wb__side" style={props.sideWidth ? { width: props.sideWidth } : undefined}>
        <div className="wb__side-scroll">{props.side}</div>
        {props.sideFooter && <div className="wb__side-footer">{props.sideFooter}</div>}
      </aside>
      <section className="wb__main">{props.children}</section>
    </div>
  );
}

/** Collapsible inspector group, like the Xcode / Finder inspector. */
export function InspectorSection(props: {
  title: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [isOpen, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <div className={cx("insp", !isOpen && "insp--closed")}>
      <div className="insp__head">
        <button type="button" className="insp__title" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {props.title}
        </button>
        {props.badge}
        <div className="spacer" />
        {isOpen && props.actions}
      </div>
      {isOpen && <div className="insp__body">{props.children}</div>}
    </div>
  );
}

/** A label + hint on the left and a control (toggle, select) on the right. */
export function InspectorRow(props: { label: ReactNode; hint?: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="insp-row">
      <div className="insp-row__text">
        <div className={cx("insp-row__label", props.mono && "mono")}>{props.label}</div>
        {props.hint && <div className="insp-row__hint">{props.hint}</div>}
      </div>
      {props.children}
    </div>
  );
}

/** Shows a chosen path (home folder as "~") with Choose… and Clear buttons. */
export function FileField(props: {
  path: string;
  placeholder: string;
  onChoose: () => void;
  onClear: () => void;
  chooseLabel?: string;
}) {
  const home = useApp((s) => s.paths?.homeDir);
  const shown = props.path ? tildePath(props.path, home) : "";
  return (
    <div className="wb-file" title={shown || undefined}>
      <span className={cx("wb-file__name", !props.path && "wb-file__name--empty")}>
        {/* The box is right-to-left, so a long path is cut at the start and the file name stays in view.
            The left-to-right mark keeps "~" and "/" in the right order. */}
        {shown ? `\u200e${shown}` : props.placeholder}
      </span>
      {props.path && (
        <IconButton label="Clear" onClick={props.onClear} style={{ width: 22, height: 22 }}>
          <X size={13} />
        </IconButton>
      )}
      <Button size="sm" onClick={props.onChoose}>
        {props.chooseLabel ?? "Choose…"}
      </Button>
    </div>
  );
}

export function Toolbar(props: { children: ReactNode; className?: string }) {
  return <div className={cx("wb__toolbar", props.className)}>{props.children}</div>;
}

/** Small "label: value" statistic used in output footers. */
export function Stat(props: { label: string; value: ReactNode; tone?: "red" | "green" | "orange"; title?: string }) {
  return (
    <span className={cx("wb-stat", props.tone && `wb-stat--${props.tone}`)} title={props.title}>
      {props.label} <strong>{props.value}</strong>
    </span>
  );
}
