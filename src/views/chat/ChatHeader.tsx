// Header of the open chat: editable title, instructions, tools chip and the
// context meter. OWNER: agent "ui-chat".

import { Pencil, ScrollText, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Callout, Field, Meter, Modal, TextArea, cx, formatNumber } from "../../components/ui";
import { useApp } from "../../lib/store";
import type { Chat } from "../../lib/types";
import type { ContextUse } from "./chatState";
import { pluralize } from "./utils";

function EditableTitle(props: { title: string; onSave: (title: string) => Promise<boolean>; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.title);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(props.title);
  }, [props.title, editing]);

  async function commit() {
    setEditing(false);
    if (cancelled.current) return;
    const title = draft.trim();
    if (!title || title === props.title) return;
    const ok = await props.onSave(title);
    if (!ok) setDraft(props.title);
  }

  if (editing) {
    return (
      <input
        className="input cv-title-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="cv-title"
      title="Rename chat"
      disabled={props.disabled}
      onClick={() => {
        cancelled.current = false;
        setEditing(true);
      }}
    >
      <span className="truncate">{props.title || "New chat"}</span>
      <Pencil size={12} className="cv-title__pencil" />
    </button>
  );
}

function InstructionsModal(props: {
  initial: string;
  onSave: (text: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const defaults = useApp((s) => s.config?.chatDefaults.instructions ?? "");
  const [text, setText] = useState(props.initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const err = await props.onSave(text);
    setSaving(false);
    if (err) setError(err);
    else props.onClose();
  }

  return (
    <Modal
      title="Instructions for this chat"
      onClose={props.onClose}
      footer={
        <>
          {defaults && text !== defaults && (
            <Button variant="plain" onClick={() => setText(defaults)}>
              Use default
            </Button>
          )}
          <div className="spacer" />
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save} disabled={text === props.initial}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field
          label="Instructions"
          hint="The model reads these before every message. Keep them short: they use part of the small context window."
        >
          <TextArea
            rows={9}
            value={text}
            spellCheck
            autoFocus
            placeholder="For example: You are a friendly assistant. Answer in short bullet points."
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) save();
            }}
          />
        </Field>
        {error && <Callout tone="error">{error}</Callout>}
      </div>
    </Modal>
  );
}

export function ContextMeter(props: { context: ContextUse | null }) {
  const c = props.context;
  if (!c || !c.size) {
    return (
      <div className="cv-context" title="Context use shows here after the first answer.">
        <div className="cv-context__bar">
          <Meter value={0} />
        </div>
        <span className="cv-context__pct">0%</span>
      </div>
    );
  }
  const ratio = c.used / c.size;
  const title =
    `Context: ${formatNumber(c.used)} of ${formatNumber(c.size)} tokens used. ` +
    "When it fills up, the oldest messages are left out of what the model sees.";
  return (
    <div className="cv-context" title={title}>
      <div className="cv-context__bar">
        <Meter value={ratio} />
      </div>
      <span className={cx("cv-context__pct", ratio >= 0.9 ? "cv-red" : ratio >= 0.75 && "cv-orange")}>
        {Math.round(ratio * 100)}%
      </span>
    </div>
  );
}

export function ChatHeader(props: {
  chat: Chat | null;
  context: ContextUse | null;
  toolsLabel: string;
  toolsOff: boolean;
  onRename: (title: string) => Promise<boolean>;
  onSaveInstructions: (text: string) => Promise<string | null>;
  onOpenTools: () => void;
}) {
  const [showInstructions, setShowInstructions] = useState(false);
  const chat = props.chat;
  const count = chat?.messages.length ?? 0;

  return (
    <header className="cv-header" data-tauri-drag-region>
      <div className="cv-header__titles" data-tauri-drag-region>
        {chat ? (
          <EditableTitle title={chat.title} onSave={props.onRename} />
        ) : (
          <div className="cv-title cv-title--static">New chat</div>
        )}
        <div className="cv-header__sub" data-tauri-drag-region>
          {chat ? (count === 0 ? "No messages yet" : pluralize(count, "message")) : "Ask anything. It runs on this Mac."}
        </div>
      </div>
      <div className="cv-header__actions">
        <ContextMeter context={props.context} />
        <button
          type="button"
          className={cx("cv-chip", props.toolsOff && "cv-chip--off")}
          onClick={props.onOpenTools}
          title="Choose the tools the model can use"
        >
          <Wrench size={13} />
          {props.toolsLabel}
        </button>
        <Button
          size="sm"
          icon={<ScrollText size={13} />}
          disabled={!chat}
          onClick={() => setShowInstructions(true)}
          title="Edit the instructions for this chat"
        >
          <span className="cv-wide-only">Instructions</span>
        </Button>
      </div>
      {showInstructions && chat && (
        <InstructionsModal
          initial={chat.instructions}
          onSave={props.onSaveInstructions}
          onClose={() => setShowInstructions(false)}
        />
      )}
    </header>
  );
}
