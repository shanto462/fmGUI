// Skills page: SKILL.md skills, their modes, editor, import and the new skill wizard.
// OWNER: agent "ui-extend".

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Download, FolderOpen, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Markdown } from "../components/Markdown";
import {
  Badge,
  Button,
  Callout,
  Empty,
  IconButton,
  Meter,
  Page,
  Section,
  Segmented,
  Spinner,
  TextInput,
  cx,
  formatNumber,
} from "../components/ui";
import { errorMessage, skillDelete, skillTokenCount } from "../lib/api";
import { useApp } from "../lib/store";
import type { AppConfig, Skill, SkillMode } from "../lib/types";
import { ModeBadge, SkillEditorModal, SkillImportModal, SkillWizard, modeExplanation } from "./skills/parts";
import { LARGE_SKILL_TOKENS } from "./skills/templates";
import { ConfirmModal, ContextBudget, Tile, skillMode, useExtendData } from "./tools/shared";

export default function SkillsView() {
  const config = useApp((s) => s.config);
  if (!config) {
    return (
      <Page title="Skills">
        <Empty title="Loading…" />
      </Page>
    );
  }
  return <SkillsPage config={config} />;
}

function SkillsPage({ config }: { config: AppConfig }) {
  const updateConfig = useApp((s) => s.updateConfig);
  const toast = useApp((s) => s.toast);
  const takeHandoff = useApp((s) => s.takeHandoff);
  const { tools, skills, skillsError, reload } = useExtendData();

  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [wizard, setWizard] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [exact, setExact] = useState<Record<string, number>>({});
  const [counting, setCounting] = useState<string | null>(null);

  useEffect(() => {
    if (takeHandoff().openWizard) setWizard(true);
  }, [takeHandoff]);

  // Keep a valid selection.
  useEffect(() => {
    if (!skills) return;
    if (skills.length === 0) setSelected(null);
    else if (!selected || !skills.some((s) => s.name === selected)) setSelected(skills[0].name);
  }, [skills, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (skills ?? []).filter((s) => !q || s.name.includes(q) || s.description.toLowerCase().includes(q));
  }, [skills, query]);

  const current = skills?.find((s) => s.name === selected) ?? null;
  const takenNames = (except?: string) => (skills ?? []).map((s) => s.name).filter((n) => n !== except);

  const setMode = async (name: string, mode: SkillMode) => {
    await updateConfig((d) => {
      d.skills[name] = { mode };
    });
    reload();
  };

  const countExact = async (name: string) => {
    setCounting(name);
    try {
      const n = await skillTokenCount(name);
      setExact((e) => ({ ...e, [name]: n }));
    } catch (err) {
      toast(`Could not count tokens: ${errorMessage(err)}`, "error");
    } finally {
      setCounting(null);
    }
  };

  const remove = async (skill: Skill) => {
    try {
      await skillDelete(skill.name);
      await updateConfig((d) => {
        delete d.skills[skill.name];
      });
      toast(`Deleted "${skill.name}".`, "success");
      setDeleting(null);
      setSelected(null);
      reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const reveal = async (path: string) => {
    try {
      await revealItemInDir(path);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const afterSave = (skill: Skill) => {
    setExact((e) => {
      const next = { ...e };
      delete next[skill.name];
      return next;
    });
    setSelected(skill.name);
    reload();
  };

  return (
    <Page
      title="Skills"
      subtitle="Reusable instructions the model can follow (SKILL.md)"
      flush
      actions={
        <>
          <Button icon={<Download size={14} />} onClick={() => setImporting(true)}>
            Import
          </Button>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setWizard(true)}>
            New skill
          </Button>
        </>
      }
    >
      <div className="split">
        <div className="split__list ext-skill-list">
          <div className="ext-skill-list__search">
            <TextInput placeholder="Search skills" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="ext-skill-list__scroll">
            {skills === null ? (
              <div className="row small muted" style={{ padding: 14 }}>
                <Spinner /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="small muted" style={{ padding: 14 }}>
                {skills.length === 0 ? "No skills yet." : `No skill matches "${query}".`}
              </div>
            ) : (
              filtered.map((s) => (
                <div
                  key={s.name}
                  className={cx("list-row", s.name === selected && "list-row--active")}
                  onClick={() => setSelected(s.name)}
                >
                  <div className="row" style={{ gap: 6 }}>
                    <span className="list-row__title" style={{ flex: 1, minWidth: 0 }}>
                      {s.name}
                    </span>
                    <ModeBadge mode={skillMode(config, s.name)} />
                  </div>
                  <div className="list-row__meta">{s.description || "No description"}</div>
                </div>
              ))
            )}
          </div>
          <ContextBudget compact config={config} tools={tools} skills={skills} />
        </div>

        <div className="split__detail">
          <div className="ext-detail">
            <div className="ext-detail__inner">
              {skillsError && (
                <Section>
                  <Callout tone="error">
                    Could not load skills: {skillsError}{" "}
                    <button type="button" className="ext-link" onClick={() => reload()}>
                      Try again
                    </button>
                  </Callout>
                </Section>
              )}
              {skills !== null && skills.length === 0 ? (
                <Empty
                  icon={<Sparkles size={32} />}
                  title="No skills yet"
                  action={
                    <div className="row">
                      <Button icon={<Download size={14} />} onClick={() => setImporting(true)}>
                        Import
                      </Button>
                      <Button variant="primary" icon={<Plus size={14} />} onClick={() => setWizard(true)}>
                        New skill
                      </Button>
                    </div>
                  }
                >
                  A skill is a set of instructions in a SKILL.md file, like Claude Skills. It teaches the model one kind of
                  task, for example how to write your emails. Start from a template, or import skills you already have.
                </Empty>
              ) : current ? (
                <SkillDetail
                  skill={current}
                  mode={skillMode(config, current.name)}
                  contextSize={config.contextSize > 0 ? config.contextSize : 8192}
                  exact={exact[current.name]}
                  counting={counting === current.name}
                  onMode={(m) => setMode(current.name, m)}
                  onCount={() => countExact(current.name)}
                  onEdit={() => setEditing(current)}
                  onDelete={() => setDeleting(current)}
                  onReveal={() => reveal(current.path)}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {wizard && (
        <SkillWizard
          takenNames={takenNames()}
          onClose={() => setWizard(false)}
          onSaved={(s) => {
            setWizard(false);
            afterSave(s);
          }}
        />
      )}
      {editing && (
        <SkillEditorModal
          skill={editing}
          takenNames={takenNames(editing.name)}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            setEditing(null);
            afterSave(s);
          }}
        />
      )}
      {importing && (
        <SkillImportModal
          onClose={() => setImporting(false)}
          onImported={(s) => {
            setSelected(s.name);
            reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title={`Delete "${deleting.name}"?`}
          message={
            <>
              This deletes the skill folder from fmGUI, including <span className="mono">SKILL.md</span> and any other files
              in it. This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </Page>
  );
}

function SkillDetail(props: {
  skill: Skill;
  mode: SkillMode;
  contextSize: number;
  exact: number | undefined;
  counting: boolean;
  onMode: (m: SkillMode) => void;
  onCount: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReveal: () => void;
}) {
  const { skill, mode } = props;
  const tokens = props.exact ?? skill.tokenEstimate;
  const share = tokens / props.contextSize;
  return (
    <>
      <div className="row" style={{ alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
        <Tile tone="orange" size="lg">
          <Sparkles size={20} />
        </Tile>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <h2 className="mono" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              {skill.name}
            </h2>
            <ModeBadge mode={mode} />
          </div>
          <div className="muted selectable" style={{ marginTop: 4 }}>
            {skill.description || "No description. Add one so the model knows when to use this skill."}
          </div>
        </div>
        <div className="row">
          <Button icon={<Pencil size={13} />} onClick={props.onEdit}>
            Edit
          </Button>
          <IconButton label="Show in Finder" onClick={props.onReveal}>
            <FolderOpen size={15} />
          </IconButton>
          <IconButton label="Delete" onClick={props.onDelete}>
            <Trash2 size={15} />
          </IconButton>
        </div>
      </div>

      <Section title="How the model uses it">
        <div className="card stack">
          <div>
            <Segmented<SkillMode>
              value={mode}
              onChange={props.onMode}
              options={[
                { value: "off", label: "Off" },
                { value: "onDemand", label: "On demand" },
                { value: "always", label: "Always" },
              ]}
            />
          </div>
          <div className="small">{modeExplanation(mode, tokens)}</div>
          {mode === "always" && tokens > LARGE_SKILL_TOKENS && (
            <Callout tone="warning">
              This skill is big. As "Always" it takes {Math.round(share * 100)}% of the context in every chat. "On demand" is
              a better fit.
            </Callout>
          )}
        </div>
      </Section>

      <Section title="Size">
        <div className="group">
          <div className="group__row">
            <div className="group__label">
              <div className="row" style={{ gap: 6 }}>
                {props.exact !== undefined ? "" : "≈ "}
                {formatNumber(tokens)} tokens
                {props.exact !== undefined && (
                  <Badge tone="green" title="Counted with fm count-tokens">
                    exact
                  </Badge>
                )}
              </div>
              <div className="group__hint">
                {props.exact !== undefined
                  ? "Counted by the on-device model with fm count-tokens."
                  : "Estimate: about 4 characters per token. Count exactly with the real model."}
              </div>
            </div>
            <Button size="sm" loading={props.counting} onClick={props.onCount}>
              Count exactly
            </Button>
          </div>
          <div className="group__row">
            <div className="group__label">
              <Meter value={share} />
              <div className="group__hint" style={{ marginTop: 4 }}>
                {Math.round(share * 100)}% of the {formatNumber(props.contextSize)}-token context when loaded
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Instructions (SKILL.md)">
        <div className="card">
          {skill.body.trim() ? <Markdown text={skill.body} /> : <div className="small muted">This skill has no instructions yet.</div>}
        </div>
        <div className="xsmall muted" style={{ marginTop: 8 }}>
          <span className="mono selectable">{skill.path}</span>
          {skill.files.length > 0 && <> · Other files: {skill.files.join(", ")}</>}
        </div>
      </Section>
    </>
  );
}
