// Shared building blocks for the "workbench" pages (Playground, Schema Builder,
// Token Counter, API Server, Docs): a two-pane layout with an inspector on the
// left and output on the right, plus small helpers. OWNER: agent "ui-build".

import { open, save } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button, IconButton, cx } from "../../components/ui";
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

/** Shows a chosen path with Choose… and Clear buttons. */
export function FileField(props: {
  path: string;
  placeholder: string;
  onChoose: () => void;
  onClear: () => void;
  chooseLabel?: string;
}) {
  return (
    <div className="wb-file" title={props.path || undefined}>
      <span className={cx("wb-file__name", !props.path && "wb-file__name--empty")}>
        {props.path ? `‎${props.path}` : props.placeholder}
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

// ---------- Hooks ----------

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Re-renders every `ms` while `active` is true (live timers). */
export function useTicker(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

// ---------- File dialogs ----------

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "heic", "heif", "gif", "webp", "tif", "tiff", "bmp"];

/** Native open panel for one file. Returns null when the user cancels. */
export async function pickFile(opts: { title?: string; name?: string; extensions?: string[] } = {}): Promise<string | null> {
  const result = await open({
    title: opts.title,
    multiple: false,
    directory: false,
    filters: opts.extensions ? [{ name: opts.name ?? "Files", extensions: opts.extensions }] : undefined,
  });
  return typeof result === "string" ? result : null;
}

/** Native open panel for many files. Returns [] when the user cancels. */
export async function pickFiles(opts: { title?: string; name?: string; extensions?: string[] } = {}): Promise<string[]> {
  const result = await open({
    title: opts.title,
    multiple: true,
    directory: false,
    filters: opts.extensions ? [{ name: opts.name ?? "Files", extensions: opts.extensions }] : undefined,
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

/** Native save panel. Returns null when the user cancels. */
export async function pickSavePath(opts: { title?: string; defaultPath?: string; name?: string; extensions?: string[] }) {
  const result = await save({
    title: opts.title,
    defaultPath: opts.defaultPath,
    filters: opts.extensions ? [{ name: opts.name ?? "Files", extensions: opts.extensions }] : undefined,
  });
  return result ?? null;
}

// ---------- Text helpers ----------

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** The backend strips ANSI already; this is a cheap second guard for display. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Pretty JSON text, or null when `text` is not JSON. */
export function tryPrettyJson(text: string): string | null {
  const t = text.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

/** Parse error message for JSON text, or null when it parses. */
export function jsonError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/** Short stable hash (FNV-1a, 32 bit) for temp file names. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? dir + name : `${dir}/${name}`;
}

export function truncateText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** "1m 05s" style uptime. */
export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}
