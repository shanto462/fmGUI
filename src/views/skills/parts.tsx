// Skill editing pieces: mode cards, body editor, editor modal, import modal, new skill wizard.

import { Download, FolderInput, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Markdown } from "../../components/Markdown";
import {
  Badge,
  Button,
  Callout,
  Field,
  Modal,
  Segmented,
  Spinner,
  Steps,
  TextArea,
  TextInput,
} from "../../components/ui";
import { errorMessage, skillImport, skillSave, skillsImportCandidates } from "../../lib/api";
import { pickFolder } from "../../lib/dialogs";
import { estimateTokens, formatNumber } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { Skill, SkillCandidate, SkillMode } from "../../lib/types";
import { ChoiceCard, Tile } from "../tools/shared";
import { LARGE_SKILL_TOKENS, SKILL_NAME_RE, SKILL_TEMPLATES, toSkillName } from "./templates";

const MODE_LABEL: Record<SkillMode, string> = { off: "Off", onDemand: "On demand", always: "Always" };

export function ModeBadge({ mode }: { mode: SkillMode }) {
  if (mode === "always") return <Badge tone="purple">Always</Badge>;
  if (mode === "onDemand") return <Badge tone="accent">On demand</Badge>;
  return <Badge>Off</Badge>;
}

/** One or two sentences on what the mode costs. */
export function ModeExplanation({ mode, tokens }: { mode: SkillMode; tokens: number }) {
  if (mode === "onDemand")
    return (
      <>
        The model sees only the name and description. When a request needs this skill, it loads the full text (about{" "}
        {formatNumber(tokens)} tokens) just for that turn. This saves context.
      </>
    );
  if (mode === "always")
    return (
      <>
        The full text is added to every chat, so the model always follows it. This costs about {formatNumber(tokens)}{" "}
        tokens on every request.
      </>
    );
  return <>The model never sees this skill. Nothing is added to the context.</>;
}

/** Three cards: On demand (recommended), Always, Off. */
function ModeChoice(props: { value: SkillMode; onChange: (m: SkillMode) => void; tokens: number }) {
  return (
    <div className="ext-choices" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
      <ChoiceCard
        title="On demand"
        badge={<Badge tone="green">Recommended</Badge>}
        selected={props.value === "onDemand"}
        onClick={() => props.onChange("onDemand")}
        description="The model sees the name and description, and loads the full skill only when it needs it. Saves context."
      />
      <ChoiceCard
        title="Always"
        selected={props.value === "always"}
        onClick={() => props.onChange("always")}
        description={`The full text is added to every chat. Costs about ${formatNumber(props.tokens)} tokens every time.`}
      />
      <ChoiceCard
        title="Off"
        selected={props.value === "off"}
        onClick={() => props.onChange("off")}
        description="Saved, but the model does not see it. Turn it on later."
      />
    </div>
  );
}

/** Markdown textarea with a live preview and a token estimate. */
function BodyEditor(props: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const tokens = estimateTokens(props.value);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="ext-editor-grid">
        <TextArea
          className="ext-mono-area"
          autoFocus={props.autoFocus}
          value={props.value}
          placeholder={
            "# My skill\n\nWrite clear rules here, for example:\n- Use short sentences.\n- End with a summary."
          }
          onChange={(e) => props.onChange(e.target.value)}
        />
        <div className="ext-preview">
          {props.value.trim() ? (
            <Markdown text={props.value} />
          ) : (
            <div className="small muted">The preview shows here.</div>
          )}
        </div>
      </div>
      <div className="row xsmall">
        <span className="muted">Markdown. Left: what you write. Right: how it looks.</span>
        <div className="spacer" />
        <span style={{ color: tokens > LARGE_SKILL_TOKENS ? "var(--orange)" : "var(--label-2)" }}>
          ≈ {formatNumber(tokens)} tokens
        </span>
      </div>
      {tokens > LARGE_SKILL_TOKENS && (
        <Callout tone="warning">
          This skill is long (about {formatNumber(tokens)} tokens). The on-device model has a small context, so a long
          skill leaves little room for the chat. Keep it short, or use it only On demand.
        </Callout>
      )}
    </div>
  );
}

function nameErrorFor(name: string, taken: string[]): string | null {
  if (!name) return "Enter a name.";
  if (!SKILL_NAME_RE.test(name)) return "Use lowercase letters, numbers and hyphens (-), up to 64 characters.";
  if (taken.includes(name)) return "Another skill already uses this name.";
  return null;
}

function NameFields(props: {
  name: string;
  description: string;
  taken: string[];
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  autoFocus?: boolean;
}) {
  const err = props.name ? nameErrorFor(props.name, props.taken) : null;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Field label="Name" error={err ?? undefined} hint="Lowercase letters, numbers and hyphens. Example: email-writer">
        <TextInput
          className="mono"
          autoFocus={props.autoFocus}
          value={props.name}
          placeholder="email-writer"
          onChange={(e) => props.onName(toSkillName(e.target.value))}
        />
      </Field>
      <Field label="Description" hint="Say when to use the skill. The model reads this to decide when to load it.">
        <TextArea
          rows={2}
          value={props.description}
          placeholder="Use when the user asks to write or reply to an email."
          onChange={(e) => props.onDescription(e.target.value)}
        />
      </Field>
    </div>
  );
}

// ---------- edit an existing skill ----------

export function SkillEditorModal(props: {
  skill: Skill;
  takenNames: string[];
  onClose: () => void;
  onSaved: (skill: Skill) => void;
}) {
  const updateConfig = useApp((s) => s.updateConfig);
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState(props.skill.name);
  const [description, setDescription] = useState(props.skill.description);
  const [body, setBody] = useState(props.skill.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = nameErrorFor(name, props.takenNames) ?? (description.trim() ? null : "Write a short description.");

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await skillSave({ originalName: props.skill.name, name, description: description.trim(), body });
      if (saved.name !== props.skill.name) {
        await updateConfig((d) => {
          const prefs = d.skills[props.skill.name];
          if (prefs) {
            d.skills[saved.name] = prefs;
            delete d.skills[props.skill.name];
          }
        });
      }
      toast(`Saved "${saved.name}".`, "success");
      props.onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      wide
      dismissible={false}
      title={`Edit "${props.skill.name}"`}
      onClose={props.onClose}
      footer={
        <>
          {invalid && (
            <span className="xsmall" style={{ color: "var(--red)" }}>
              {invalid}
            </span>
          )}
          <div className="spacer" />
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!!invalid} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <NameFields
          name={name}
          description={description}
          taken={props.takenNames}
          onName={setName}
          onDescription={setDescription}
        />
        <div className="ext-block">
          <div className="ext-block__label">Instructions</div>
          <BodyEditor value={body} onChange={setBody} />
        </div>
        {error && <Callout tone="error">{error}</Callout>}
      </div>
    </Modal>
  );
}

// ---------- new skill wizard ----------

const WIZARD_STEPS = ["Start", "Name", "Instructions", "Mode", "Save"];

export function SkillWizard(props: { takenNames: string[]; onClose: () => void; onSaved: (skill: Skill) => void }) {
  const updateConfig = useApp((s) => s.updateConfig);
  const toast = useApp((s) => s.toast);
  const [step, setStep] = useState(0);
  const [start, setStart] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<SkillMode>("onDemand");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unique = (base: string) => {
    if (!props.takenNames.includes(base)) return base;
    for (let i = 2; i < 100; i++) if (!props.takenNames.includes(`${base}-${i}`)) return `${base}-${i}`;
    return base;
  };

  const choose = (id: string) => {
    setStart(id);
    const t = SKILL_TEMPLATES.find((x) => x.id === id);
    if (t) {
      setName(unique(t.name));
      setDescription(t.description);
      setBody(t.body);
    } else {
      setName("");
      setDescription("");
      setBody("");
    }
  };

  const tokens = estimateTokens(body);
  const stepError = [
    start ? null : "Pick a starting point.",
    nameErrorFor(name, props.takenNames) ?? (description.trim() ? null : "Write a short description."),
    body.trim() ? null : "Write the instructions.",
    null,
    null,
  ][step];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await skillSave({ originalName: null, name, description: description.trim(), body });
      await updateConfig((d) => {
        d.skills[saved.name] = { mode };
      });
      toast(`Added the skill "${saved.name}".`, "success");
      props.onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  let content: ReactNode;
  if (step === 0) {
    content = (
      <div className="stack" style={{ gap: 16 }}>
        <Callout>
          <b>What is a skill?</b> A skill is a set of instructions saved as a <span className="mono">SKILL.md</span>{" "}
          file, like Claude Skills. It teaches the model how to do one kind of task, for example how you like your
          emails written.
        </Callout>
        <div className="ext-h" style={{ margin: 0 }}>
          Start from a template
        </div>
        <div className="ext-choices ext-choices--wide">
          {SKILL_TEMPLATES.map((t) => (
            <ChoiceCard
              key={t.id}
              icon={
                <Tile tone="orange">
                  <Sparkles size={15} />
                </Tile>
              }
              title={t.title}
              description={t.summary}
              selected={start === t.id}
              onClick={() => choose(t.id)}
            />
          ))}
          <ChoiceCard
            icon={
              <Tile tone="gray">
                <Sparkles size={15} />
              </Tile>
            }
            title="Blank skill"
            description="Write your own from scratch."
            selected={start === "blank"}
            onClick={() => choose("blank")}
          />
        </div>
      </div>
    );
  } else if (step === 1) {
    content = (
      <div className="stack" style={{ gap: 14 }}>
        <NameFields
          autoFocus
          name={name}
          description={description}
          taken={props.takenNames}
          onName={setName}
          onDescription={setDescription}
        />
        <Callout>
          A good description says <b>when</b> to use the skill. Example:{" "}
          <i>"Use when the user pastes meeting notes. Turns them into a summary and action items."</i>
        </Callout>
      </div>
    );
  } else if (step === 2) {
    content = (
      <div className="stack" style={{ gap: 10 }}>
        <div className="small muted">
          Write the rules the model should follow. Short lists work best. Use Markdown: # for headings, - for lists.
        </div>
        <BodyEditor value={body} onChange={setBody} autoFocus />
      </div>
    );
  } else if (step === 3) {
    content = (
      <div className="stack" style={{ gap: 14 }}>
        <div className="small muted">How should the model use this skill? You can change this later.</div>
        <ModeChoice value={mode} onChange={setMode} tokens={tokens} />
        <div className="small">
          <ModeExplanation mode={mode} tokens={tokens} />
        </div>
      </div>
    );
  } else {
    content = (
      <div className="stack" style={{ gap: 14 }}>
        <div className="card">
          <dl className="ext-summary" style={{ margin: 0 }}>
            <dt>Name</dt>
            <dd className="mono">{name}</dd>
            <dt>Description</dt>
            <dd>{description}</dd>
            <dt>Mode</dt>
            <dd>{MODE_LABEL[mode]}</dd>
            <dt>Size</dt>
            <dd>≈ {formatNumber(tokens)} tokens</dd>
          </dl>
        </div>
        <div className="small muted">
          fmGUI saves it as <span className="mono">{name}/SKILL.md</span> in its skills folder.
        </div>
        {error && <Callout tone="error">{error}</Callout>}
      </div>
    );
  }

  return (
    <Modal
      wide
      dismissible={false}
      title="New skill"
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <div className="spacer" />
          {stepError && step > 0 && (
            <span className="xsmall" style={{ color: "var(--red)" }}>
              {stepError}
            </span>
          )}
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {step < WIZARD_STEPS.length - 1 ? (
            <Button variant="primary" disabled={!!stepError} onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" loading={saving} onClick={save}>
              Save skill
            </Button>
          )}
        </>
      }
    >
      <div className="ext-wizard">
        <Steps steps={WIZARD_STEPS} current={step} />
        {content}
      </div>
    </Modal>
  );
}

// ---------- import ----------

export function SkillImportModal(props: { onClose: () => void; onImported: (skill: Skill) => void }) {
  const toast = useApp((s) => s.toast);
  const [list, setList] = useState<SkillCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "new">("all");

  useEffect(() => {
    skillsImportCandidates()
      .then((l) => setList(l))
      .catch((err) => {
        setError(errorMessage(err));
        setList([]);
      });
  }, []);

  const doImport = async (path: string) => {
    setBusy(path);
    try {
      const skill = await skillImport(path);
      setList((l) => (l ? l.map((c) => (c.path === path ? { ...c, alreadyImported: true } : c)) : l));
      toast(`Imported "${skill.name}". It is set to On demand.`, "success");
      props.onImported(skill);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const fromFolder = async () => {
    try {
      const path = await pickFolder("Choose a skill folder (it has a SKILL.md file)");
      if (path) await doImport(path);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const shown = (list ?? []).filter((c) => filter === "all" || !c.alreadyImported);

  return (
    <Modal
      wide
      title="Import skills"
      onClose={props.onClose}
      footer={
        <>
          <Button icon={<FolderInput size={14} />} disabled={busy !== null} onClick={fromFolder}>
            Import from folder…
          </Button>
          <div className="spacer" />
          <Button variant="primary" onClick={props.onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="small muted">
          fmGUI found these skills on your Mac, for example in <span className="mono">~/.claude/skills</span>. Importing
          copies the folder into fmGUI. The original stays where it is.
        </div>
        {error && <Callout tone="error">Could not look for skills: {error}</Callout>}
        {list === null ? (
          <div className="row small muted">
            <Spinner /> Looking for skills…
          </div>
        ) : list.length === 0 ? (
          <div className="card small muted">
            No skills found in the usual folders. Use "Import from folder…" to pick a folder that has a{" "}
            <span className="mono">SKILL.md</span> file.
          </div>
        ) : (
          <>
            <div>
              <Segmented<"all" | "new">
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: `All (${list.length})` },
                  { value: "new", label: `Not imported (${list.filter((c) => !c.alreadyImported).length})` },
                ]}
              />
            </div>
            <div className="group" style={{ maxHeight: 380, overflowY: "auto" }}>
              {shown.map((c) => {
                const large = c.tokenEstimate > LARGE_SKILL_TOKENS;
                return (
                  <div key={c.path} className="group__row ext-row">
                    <Tile tone="orange">
                      <Sparkles size={15} />
                    </Tile>
                    <div className="ext-row__main">
                      <div className="ext-row__title">
                        <span className="mono">{c.name}</span>
                        {c.alreadyImported && <Badge tone="green">Imported</Badge>}
                      </div>
                      {c.description && (
                        <div className="ext-row__desc" title={c.description}>
                          {c.description}
                        </div>
                      )}
                      <div className="ext-row__meta">
                        <span>{c.source}</span>
                        {large ? (
                          <Badge tone="orange" title="Big skills use a lot of the small context. Keep them On demand.">
                            Large: ≈ {formatNumber(c.tokenEstimate)} tokens
                          </Badge>
                        ) : (
                          <span>≈ {formatNumber(c.tokenEstimate)} tokens</span>
                        )}
                      </div>
                    </div>
                    <div className="ext-row__controls">
                      <Button
                        size="sm"
                        variant={c.alreadyImported ? "default" : "primary"}
                        icon={<Download size={12} />}
                        loading={busy === c.path}
                        disabled={c.alreadyImported || (busy !== null && busy !== c.path)}
                        onClick={() => doImport(c.path)}
                      >
                        {c.alreadyImported ? "Imported" : "Import"}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {shown.length === 0 && <div className="group__row small muted">Everything here is already imported.</div>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
