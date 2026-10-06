// "New CLI session" sheet: instructions + first message. The parent turns it
// into `fm respond -i … --save-transcript <new file> -- <prompt>`.

import { useMemo, useState } from "react";
import { Button, Callout, CommandPreview, Field, Modal, TextArea } from "../../components/ui";
import { displayCommand, respondArgs } from "../../lib/fmArgs";
import { type ModelReady } from "../chat/useModelReady";
import { type CliRunOptions } from "./options";

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s || "session";
}

export function NewSessionModal(props: {
  options: CliRunOptions;
  fmPath: string;
  /** Absolute ~/.fm/sessions folder, for the command preview. */
  sessionsDir: string | null;
  ready: ModelReady;
  /** Returns an error message, or null when the run started. */
  onStart: (instructions: string, prompt: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [instructions, setInstructions] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () =>
      displayCommand(
        respondArgs({
          instructions,
          prompt: prompt || "…",
          saveTranscriptPath: `${props.sessionsDir ?? "~/.fm/sessions"}/${slug(prompt)}.json`,
          tools: props.options.tools,
          greedy: props.options.greedy,
          useCase: props.options.useCase,
        }),
        props.fmPath,
      ),
    [instructions, prompt, props.options, props.fmPath, props.sessionsDir],
  );

  async function start() {
    setBusy(true);
    setError(null);
    const err = await props.onStart(instructions.trim(), prompt.trim());
    setBusy(false);
    if (err) setError(err);
  }

  const canStart = prompt.trim().length > 0 && props.ready.ready;

  return (
    <Modal
      title="New CLI session"
      onClose={props.onClose}
      footer={
        <>
          {!props.ready.ready && (
            <span className="xsmall" style={{ color: "var(--orange)" }}>
              {props.ready.hint}
            </span>
          )}
          <div className="spacer" />
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!canStart} onClick={start}>
            Start session
          </Button>
        </>
      }
    >
      <div className="stack">
        <Callout>
          The session is saved in ~/.fm/sessions, the same folder <span className="mono">fm chat</span> uses. You can
          keep talking here or open it in Terminal later.
        </Callout>
        <Field label="Instructions" hint="Optional. Tell the model how to behave for the whole session.">
          <TextArea
            rows={3}
            spellCheck
            value={instructions}
            placeholder="For example: You are a patient tutor. Keep answers short."
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
        <Field label="First message">
          <TextArea
            rows={4}
            spellCheck
            autoFocus
            value={prompt}
            placeholder="For example: Help me plan a three day trip to Lisbon."
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey && canStart) start();
            }}
          />
        </Field>
        <div className="field">
          <span className="field__label">Command</span>
          <CommandPreview command={preview} />
          <span className="field__hint">
            The file name comes from your first message. Options from the composer apply.
          </span>
        </div>
        {error && <Callout tone="error">{error}</Callout>}
      </div>
    </Modal>
  );
}
