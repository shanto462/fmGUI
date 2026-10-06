// Shared UI primitives. Use these in every view so the app looks consistent.
// Styles live in src/styles/base.css.

import { AlertTriangle, Check, CheckCircle2, Copy, Info, X, XCircle } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { errorMessage } from "../lib/api";
import { cx } from "../lib/cx";
import { expandTilde, tildePath, tildeText } from "../lib/paths";
import { useApp } from "../lib/store";

// ---------- Page ----------
export function Page(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Flush body: no padding, no scroll (for split views and chat). */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <header className="page__header" data-tauri-drag-region>
        <div className="page__titles" data-tauri-drag-region>
          <div className="page__title">{props.title}</div>
          {props.subtitle && <div className="page__subtitle">{props.subtitle}</div>}
        </div>
        {props.actions && <div className="page__actions">{props.actions}</div>}
      </header>
      <div className={cx("page__body", props.flush && "page__body--flush")}>{props.children}</div>
    </div>
  );
}

export function Section(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      {(props.title || props.actions) && (
        <div className="row" style={{ marginBottom: 8 }}>
          {props.title && (
            <h3 className="section__title" style={{ margin: 0 }}>
              {props.title}
            </h3>
          )}
          <div className="spacer" />
          {props.actions}
        </div>
      )}
      {props.children}
    </section>
  );
}

// ---------- Buttons ----------
type ButtonVariant = "default" | "primary" | "danger" | "plain";

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: "sm" | "md" | "lg";
    icon?: ReactNode;
    loading?: boolean;
  },
) {
  const { variant = "default", size = "md", icon, loading, className, children, disabled, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx("btn", variant !== "default" && `btn--${variant}`, size !== "md" && `btn--${size}`, className)}
    >
      {loading ? <span className="spinner" /> : icon}
      {children}
    </button>
  );
}

export function IconButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode },
) {
  const { label, className, children, ...rest } = props;
  return (
    <button type="button" title={label} aria-label={label} {...rest} className={cx("icon-btn", className)}>
      {children}
    </button>
  );
}

export function CopyButton(props: { text: string; label?: string }) {
  const toast = useApp((s) => s.toast);
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={props.label ?? "Copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch (err) {
          toast(`Could not copy. ${errorMessage(err)}`, "error");
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </IconButton>
  );
}

// ---------- Forms ----------
export function Field(props: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      {props.label && <span className="field__label">{props.label}</span>}
      {props.children}
      {props.error ? (
        <span className="field__error">{props.error}</span>
      ) : (
        props.hint && <span className="field__hint">{props.hint}</span>
      )}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input spellCheck={false} {...props} className={cx("input", props.className)} />;
}

/**
 * A text field for a file or folder path. It shows the home folder as "~" and
 * hands back the full path, so "~/Documents" is saved as an absolute path.
 */
export function PathInput(
  props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
    value: string;
    onChange: (path: string) => void;
  },
) {
  const home = useApp((s) => s.paths?.homeDir);
  const { value, onChange, ...rest } = props;
  return (
    <TextInput {...rest} value={tildePath(value, home)} onChange={(e) => onChange(expandTilde(e.target.value, home))} />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea spellCheck={false} {...props} className={cx("textarea", props.className)} />;
}

export function Select<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  style?: React.CSSProperties;
}) {
  return (
    <select
      className="select"
      value={props.value}
      style={props.style}
      onChange={(e) => props.onChange(e.target.value as T)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      className={cx("toggle", props.checked && "toggle--on")}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="segmented" role="tablist">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === props.value}
          className={cx("segmented__item", o.value === props.value && "segmented__item--active")}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip(props: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" title={props.title} className={cx("chip", props.on && "chip--on")} onClick={props.onClick}>
      {props.on && <Check size={12} />}
      {props.children}
    </button>
  );
}

// ---------- Status ----------
export function Badge(props: {
  tone?: "accent" | "green" | "orange" | "red" | "purple";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={cx("badge", props.tone && `badge--${props.tone}`)} title={props.title}>
      {props.children}
    </span>
  );
}

export function StatusDot(props: { tone: "green" | "orange" | "red" | "gray"; pulse?: boolean }) {
  return <span className={cx("dot", props.tone !== "gray" && `dot--${props.tone}`, props.pulse && "dot--pulse")} />;
}

export function Spinner() {
  return <span className="spinner" />;
}

export function Callout(props: { tone?: "info" | "warning" | "error" | "success"; children: ReactNode }) {
  const tone = props.tone ?? "info";
  const Icon = { info: Info, warning: AlertTriangle, error: XCircle, success: CheckCircle2 }[tone];
  return (
    <div className={cx("callout", tone !== "info" && `callout--${tone}`)}>
      <Icon size={16} />
      <div style={{ minWidth: 0, flex: 1 }}>{props.children}</div>
    </div>
  );
}

export function Empty(props: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {props.icon}
      <div className="empty__title">{props.title}</div>
      {props.children && (
        <div className="small" style={{ maxWidth: 420 }}>
          {props.children}
        </div>
      )}
      {props.action && <div style={{ marginTop: 8 }}>{props.action}</div>}
    </div>
  );
}

/** 0..1 usage bar that turns orange at 75% and red at 90%. */
export function Meter(props: { value: number; title?: string }) {
  const v = Math.max(0, Math.min(1, props.value));
  return (
    <div className="meter" title={props.title}>
      <div
        className={cx("meter__fill", v >= 0.9 ? "meter__fill--danger" : v >= 0.75 && "meter__fill--warn")}
        style={{ width: `${v * 100}%` }}
      />
    </div>
  );
}

// ---------- Code ----------
/** The text with the home folder shown as "~", so the user name stays off screen. */
function useTilde(text: string): string {
  const home = useApp((s) => s.paths?.homeDir);
  return tildeText(text, home);
}

/** Code or output with a copy button. Shows "~" for the home folder; the copy button copies the real text. */
export function CodeBlock(props: { code: string; wrap?: boolean; maxHeight?: number; copy?: boolean }) {
  const shown = useTilde(props.code);
  return (
    <div className={cx("code", props.wrap && "code--wrap")}>
      <pre
        className="selectable"
        style={{ maxHeight: props.maxHeight, overflowY: props.maxHeight ? "auto" : undefined }}
      >
        {shown}
      </pre>
      {props.copy !== false && (
        <span className="code__copy">
          <CopyButton text={props.code} />
        </span>
      )}
    </div>
  );
}

/**
 * Shows the exact `fm ...` command with a copy button. The home folder shows
 * as "~"; the copy button copies the real command, so it runs as it is.
 */
export function CommandPreview(props: { command: string }) {
  const shown = useTilde(props.command);
  return (
    <div className="command" title="The exact command this runs">
      <span className="command__prompt">%</span>
      <span className="command__text">{shown}</span>
      <CopyButton text={props.command} label="Copy command" />
    </div>
  );
}

// ---------- Wizard steps ----------
export function Steps(props: {
  steps: string[];
  current: number;
  /** Makes steps clickable. Steps after `maxReachable` stay disabled. */
  onSelect?: (index: number) => void;
  maxReachable?: number;
}) {
  const { onSelect } = props;
  const reachable = (i: number) => !!onSelect && i <= (props.maxReachable ?? props.current);
  return (
    <div className="steps">
      {props.steps.map((s, i) => {
        const className = cx(
          "steps__item",
          i === props.current && "steps__item--active",
          i < props.current && "steps__item--done",
        );
        const content = (
          <>
            <span className="steps__num">{i < props.current ? <Check size={11} /> : i + 1}</span>
            {s}
          </>
        );
        return (
          <div key={s} style={{ display: "contents" }}>
            {i > 0 && <span className="steps__line" />}
            {onSelect && reachable(i) ? (
              <button
                type="button"
                className={cx(className, "steps__item--button")}
                aria-current={i === props.current ? "step" : undefined}
                onClick={() => onSelect(i)}
              >
                {content}
              </button>
            ) : (
              <span className={className} aria-current={i === props.current ? "step" : undefined}>
                {content}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Modal ----------
export function Modal(props: {
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  /** Set false for wizards, so Escape or a stray click does not lose a half-filled form. */
  dismissible?: boolean;
  children: ReactNode;
}) {
  const { onClose } = props;
  const dismissible = props.dismissible !== false;
  const titleId = useId();
  useEffect(() => {
    if (!dismissible) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dismissible]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => dismissible && e.target === e.currentTarget && onClose()}>
      <div className={cx("modal", props.wide && "modal--wide")} role="dialog" aria-modal aria-labelledby={titleId}>
        <div className="modal__header row">
          <h2 className="modal__title" id={titleId}>
            {props.title}
          </h2>
          <div className="spacer" />
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="modal__body">{props.children}</div>
        {props.footer && <div className="modal__footer">{props.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Toasts ----------
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  // Errors from the backend can name files; keep the user name off screen.
  const home = useApp((s) => s.paths?.homeDir);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx("toast", `toast--${t.kind}`)}
          title="Click to close"
          onClick={() => dismiss(t.id)}
        >
          {t.kind === "error" ? (
            <XCircle size={16} />
          ) : t.kind === "success" ? (
            <CheckCircle2 size={16} />
          ) : (
            <Info size={16} />
          )}
          <span className="selectable">{tildeText(t.text, home)}</span>
        </div>
      ))}
    </div>
  );
}
