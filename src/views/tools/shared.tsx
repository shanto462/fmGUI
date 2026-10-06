// Shared pieces for the Tools, MCP Servers and Skills pages.

import { FolderOpen, Plus, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Callout, IconButton, Meter, Modal, PathInput, TextInput } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { cx } from "../../lib/cx";
import { pickFolder } from "../../lib/dialogs";
import { formatNumber } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { AppConfig, Approval, KeyValue, Skill, ToolInfo } from "../../lib/types";
import { computeBudget } from "./helpers";
import "./extend.css";

// ---------- context budget ----------

/** "Context used by tools and skills" meter with advice above 25%. */
export function ContextBudget(props: {
  config: AppConfig;
  tools: ToolInfo[] | null;
  skills: Skill[] | null;
  compact?: boolean;
}) {
  const b = useMemo(
    () => computeBudget(props.config, props.tools, props.skills),
    [props.config, props.tools, props.skills],
  );
  const pct = Math.round(b.ratio * 100);
  const loading = props.tools === null || props.skills === null;
  const advice =
    b.ratio >= 0.25 ? (
      <Callout tone={b.ratio >= 0.5 ? "error" : "warning"}>
        Tools and skills take {pct}% of the model's context. That leaves less room for your messages and the answer.
        Turn off tools you do not need, or set big skills to <b>On demand</b>.
      </Callout>
    ) : null;

  if (props.compact) {
    return (
      <div className="ext-budget ext-budget--compact">
        <div className="row xsmall">
          <span className="muted">Context used by tools and skills</span>
          <div className="spacer" />
          <b>{loading ? "…" : `${pct}%`}</b>
        </div>
        <Meter value={b.ratio} title={`${formatNumber(b.total)} of ${formatNumber(b.contextSize)} tokens`} />
        <div className="xsmall muted">
          {formatNumber(b.total)} of {formatNumber(b.contextSize)} tokens
          {b.ratio >= 0.25 && <span style={{ color: "var(--orange)" }}> · high, use On demand</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="card ext-budget">
      <div className="row">
        <div className="card__title" style={{ margin: 0 }}>
          Context used by tools and skills
        </div>
        <div className="spacer" />
        <span className="small muted">{loading ? "Loading…" : `${pct}% of the context`}</span>
      </div>
      <div className="ext-budget__numbers">
        <span className="ext-budget__big">{formatNumber(b.total)}</span>
        <span className="muted small">of {formatNumber(b.contextSize)} tokens, on every request</span>
      </div>
      <Meter value={b.ratio} />
      <div className="xsmall muted">
        {b.toolsOff
          ? "Tools are turned off for chats in Settings, so they use no context."
          : `${b.toolCount} enabled ${b.toolCount === 1 ? "tool" : "tools"}: ${formatNumber(b.toolTokens)} tokens.`}{" "}
        {b.alwaysSkills} always-on {b.alwaysSkills === 1 ? "skill" : "skills"}: {formatNumber(b.skillTokens)} tokens.
        The on-device model has a small context window, so keep this under 25%.
      </div>
      {advice}
    </div>
  );
}

// ---------- layout bits ----------

export function Tile(props: { tone?: string; size?: "lg"; children: ReactNode }) {
  return (
    <span className={cx("ext-tile", props.tone && `ext-tile--${props.tone}`, props.size === "lg" && "ext-tile--lg")}>
      {props.children}
    </span>
  );
}

/** Like Field, but a div (safe for groups of controls). */
export function Block(props: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <div className="ext-block">
      {props.label && <div className="ext-block__label">{props.label}</div>}
      {props.children}
      {props.error ? (
        <div className="field__error">{props.error}</div>
      ) : (
        props.hint && <div className="ext-block__hint">{props.hint}</div>
      )}
    </div>
  );
}

export function ChoiceCard(props: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  code?: string;
  selected?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx("ext-choice", props.selected && "ext-choice--selected")}
      onClick={props.onClick}
      aria-pressed={props.selected}
    >
      <div className="ext-choice__head">
        {props.icon}
        <span className="ext-choice__title">{props.title}</span>
        {props.badge}
      </div>
      {props.description && <div className="ext-choice__desc">{props.description}</div>}
      {props.code && (
        <div className="ext-choice__code" title={props.code}>
          {props.code}
        </div>
      )}
      {props.children}
    </button>
  );
}

/** Two big cards to choose the approval policy. */
export function ApprovalChoice(props: { value: Approval; onChange: (v: Approval) => void; recommendAsk?: boolean }) {
  return (
    <div className="ext-choices ext-choices--wide">
      <ChoiceCard
        title="Ask every time"
        selected={props.value === "ask"}
        onClick={() => props.onChange("ask")}
        badge={props.recommendAsk ? <span className="badge badge--green">Recommended</span> : undefined}
        description="The chat stops and shows you the call. Nothing runs until you click Allow."
      />
      <ChoiceCard
        title="Always allow"
        selected={props.value === "always"}
        onClick={() => props.onChange("always")}
        description="Runs right away without asking. Good for safe, read-only tools like weather or time."
      />
    </div>
  );
}

// ---------- editors ----------

export function KeyValueEditor(props: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  monoKeys?: boolean;
}) {
  const set = (i: number, patch: Partial<KeyValue>) =>
    props.onChange(props.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {props.rows.map((r, i) => (
        <div key={i} className="ext-editor-row">
          <TextInput
            className={props.monoKeys ? "mono" : undefined}
            style={{ flex: 1 }}
            value={r.key}
            placeholder={props.keyPlaceholder ?? "Name"}
            onChange={(e) => set(i, { key: e.target.value })}
          />
          <TextInput
            style={{ flex: 2 }}
            value={r.value}
            placeholder={props.valuePlaceholder ?? "Value"}
            onChange={(e) => set(i, { value: e.target.value })}
          />
          <IconButton label="Remove" onClick={() => props.onChange(props.rows.filter((_, j) => j !== i))}>
            <X size={14} />
          </IconButton>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          icon={<Plus size={13} />}
          onClick={() => props.onChange([...props.rows, { key: "", value: "" }])}
        >
          {props.addLabel ?? "Add"}
        </Button>
      </div>
    </div>
  );
}

export function StringListEditor(props: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  /** Show a folder picker button on each row. */
  folderPicker?: boolean;
  onError?: (message: string) => void;
}) {
  const set = (i: number, v: string) => props.onChange(props.items.map((x, j) => (j === i ? v : x)));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {props.items.map((item, i) => (
        <div key={i} className="ext-editor-row">
          <span className="xsmall muted" style={{ width: 16, textAlign: "right" }}>
            {i + 1}
          </span>
          {props.folderPicker ? (
            <PathInput
              className="mono"
              style={{ flex: 1 }}
              value={item}
              placeholder={props.placeholder}
              onChange={(v) => set(i, v)}
            />
          ) : (
            <TextInput
              className="mono"
              style={{ flex: 1 }}
              value={item}
              placeholder={props.placeholder}
              onChange={(e) => set(i, e.target.value)}
            />
          )}
          {props.folderPicker && (
            <IconButton
              label="Choose a folder"
              onClick={async () => {
                try {
                  const p = await pickFolder("Choose a folder");
                  if (p) set(i, p);
                } catch (err) {
                  props.onError?.(errorMessage(err));
                }
              }}
            >
              <FolderOpen size={14} />
            </IconButton>
          )}
          <IconButton label="Remove" onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}>
            <X size={14} />
          </IconButton>
        </div>
      ))}
      <div>
        <Button size="sm" icon={<Plus size={13} />} onClick={() => props.onChange([...props.items, ""])}>
          {props.addLabel ?? "Add"}
        </Button>
      </div>
    </div>
  );
}

/** Text input + "Choose…" folder button + clear. */
export function FolderField(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  title?: string;
  onError?: (message: string) => void;
}) {
  return (
    <div className="ext-editor-row">
      <PathInput
        className="mono"
        style={{ flex: 1 }}
        value={props.value}
        placeholder={props.placeholder ?? "~/Documents"}
        onChange={props.onChange}
      />
      <Button
        icon={<FolderOpen size={14} />}
        onClick={async () => {
          try {
            const p = await pickFolder(props.title ?? "Choose a folder", props.value);
            if (p) props.onChange(p);
          } catch (err) {
            props.onError?.(errorMessage(err));
          }
        }}
      >
        Choose…
      </Button>
      {props.value && (
        <IconButton label="Clear" onClick={() => props.onChange("")}>
          <X size={14} />
        </IconButton>
      )}
    </div>
  );
}

// ---------- confirm ----------

export function ConfirmModal(props: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={props.danger ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onConfirm();
              } catch (err) {
                toast(errorMessage(err), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            {props.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="small">{props.message}</div>
    </Modal>
  );
}
