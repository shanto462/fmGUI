// Rename and delete sheets for CLI sessions.

import { useState } from "react";
import { Button, Callout, Field, Modal, TextInput } from "../../components/ui";
import type { CliSession } from "../../lib/types";

/** Same rules as fm: not empty, not "." or "..", no "/" or "\". */
function sessionNameProblem(raw: string, existing: string[], current: string): string | null {
  const name = raw.trim();
  if (!name) return "Type a name.";
  if (name === "." || name === "..") return "This name is not allowed.";
  if (/[/\\\0]/.test(name)) return "A name cannot contain / or \\.";
  if (name !== current && existing.includes(name)) return "A session with this name already exists.";
  return null;
}

function cleanSessionName(raw: string): string {
  return raw.trim().replace(/\.json$/i, "");
}

export function RenameSessionModal(props: {
  session: CliSession;
  existing: string[];
  onRename: (to: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState(props.session.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = cleanSessionName(name);
  const problem = sessionNameProblem(clean, props.existing, props.session.name);
  const unchanged = clean === props.session.name;

  async function save() {
    if (problem || unchanged) return;
    setBusy(true);
    setError(null);
    const err = await props.onRename(clean);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Modal
      title="Rename session"
      onClose={props.onClose}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!!problem || unchanged} onClick={save}>
            Rename
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field
          label="Name"
          error={name !== props.session.name ? problem : null}
          hint={`You will resume it with: fm chat --resume ${clean || "name"}`}
        >
          <TextInput
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </Field>
        {error && <Callout tone="error">{error}</Callout>}
      </div>
    </Modal>
  );
}

export function DeleteSessionModal(props: {
  session: CliSession;
  onDelete: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const err = await props.onDelete();
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Modal
      title="Delete this session?"
      onClose={() => !busy && props.onClose()}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={remove}>
            Delete
          </Button>
        </>
      }
    >
      <div className="stack">
        <p style={{ margin: 0 }}>
          “{props.session.name}” will be deleted from ~/.fm/sessions. <span className="mono">fm chat</span> will not be
          able to resume it. You cannot undo this.
        </p>
        {error && <Callout tone="error">{error}</Callout>}
      </div>
    </Modal>
  );
}
