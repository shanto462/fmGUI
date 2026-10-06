// "New tool" / "Edit tool" wizard for custom tools. OWNER: agent "ui-extend".

import { Globe, Plus, RefreshCw, SquareTerminal, TriangleAlert, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Callout,
  Chip,
  CodeBlock,
  Field,
  IconButton,
  Modal,
  Select,
  Steps,
  TextArea,
  TextInput,
  Toggle,
  formatNumber,
} from "../../components/ui";
import { customToolTest, errorMessage, newId, shortcutsList } from "../../lib/api";
import { useApp } from "../../lib/store";
import type { CustomTool, ParamType } from "../../lib/types";
import { ToolTestPanel } from "./ArgsForm";
import {
  HTTP_METHODS,
  PARAM_NAME_RE,
  PARAM_TYPES,
  TOOL_NAME_RE,
  TOOL_TEMPLATES,
  draftFromTool,
  emptyDraft,
  envVarName,
  paramsSchema,
  placeholders,
  toToolName,
  toolFromDraft,
  uniqueName,
  type CustomKindType,
  type ToolDraft,
} from "./customTool";
import { ApprovalChoice, Block, ChoiceCard, FolderField, KeyValueEditor, Tile, toolTokenEstimate } from "./shared";

const STEPS = ["Type", "Name", "Parameters", "Configure", "Test", "Save"];

export const KIND_INFO: Record<CustomKindType, { title: string; icon: ReactNode; tone: string; label: string }> = {
  shell: { title: "Shell command", icon: <SquareTerminal size={16} />, tone: "dark", label: "Shell" },
  http: { title: "HTTP request", icon: <Globe size={16} />, tone: "blue", label: "HTTP" },
  shortcut: { title: "Apple Shortcut", icon: <Workflow size={16} />, tone: "pink", label: "Shortcut" },
};

export function CustomToolWizard(props: {
  /** The tool to edit, or null for a new tool. */
  editing: CustomTool | null;
  /** Names already used by other tools. */
  takenNames: string[];
  onClose: () => void;
  onSaved: (tool: CustomTool) => void;
}) {
  const updateConfig = useApp((s) => s.updateConfig);
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState<ToolDraft>(() => (props.editing ? draftFromTool(props.editing) : emptyDraft()));
  const [chosen, setChosen] = useState(props.editing !== null);
  const [step, setStep] = useState(props.editing ? 1 : 0);
  const [saving, setSaving] = useState(false);
  const [nameTouched, setNameTouched] = useState(props.editing !== null);

  const patch = (p: Partial<ToolDraft>) => setDraft((d) => ({ ...d, ...p }));
  const schema = useMemo(() => paramsSchema(draft.params), [draft.params]);
  const paramNames = draft.params.map((p) => p.name.trim()).filter(Boolean);

  // ---------- validation ----------
  const nameError = !draft.name
    ? "Enter a name."
    : !TOOL_NAME_RE.test(draft.name)
      ? "Use 2 to 48 characters: lowercase letters, numbers and _. Start with a letter."
      : props.takenNames.includes(draft.name)
        ? "Another tool already uses this name."
        : null;
  const descError = draft.description.trim() ? null : "Write a short description.";

  const paramErrors: string[] = [];
  draft.params.forEach((p, i) => {
    const n = p.name.trim();
    if (!n) paramErrors.push(`Parameter ${i + 1} needs a name.`);
    else if (!PARAM_NAME_RE.test(n)) paramErrors.push(`"${n}": use lowercase letters, numbers and _, starting with a letter.`);
    else if (paramNames.indexOf(n) !== i) paramErrors.push(`"${n}" is used twice.`);
  });

  const unknownPlaceholders = placeholders(draft).filter((p) => !paramNames.includes(p));
  const unknownEnv = useMemo(() => {
    const out = new Set<string>();
    for (const m of draft.shell.command.matchAll(/\$\{?FM_ARG_([A-Z0-9_]+)/g)) {
      if (!paramNames.some((p) => p.toUpperCase() === m[1])) out.add(`FM_ARG_${m[1]}`);
    }
    return [...out];
  }, [draft.shell.command, paramNames.join(",")]);

  const configError = (() => {
    if (draft.kind === "shell") {
      if (!draft.shell.command.trim()) return "Enter a command.";
    } else if (draft.kind === "http") {
      if (!/^https?:\/\/\S+$/.test(draft.http.url.trim())) return "Enter a URL that starts with https:// or http://.";
      if (unknownPlaceholders.length) return `Unknown placeholder: {{${unknownPlaceholders[0]}}}. Add it as a parameter or remove it.`;
    } else if (!draft.shortcut.shortcutName.trim()) return "Choose or type the name of a shortcut.";
    return null;
  })();

  const stepError = [
    chosen ? null : "Choose a type or a template.",
    nameError ?? descError,
    paramErrors[0] ?? null,
    configError,
    null,
    null,
  ][step];

  const save = async () => {
    setSaving(true);
    try {
      const id = props.editing?.id ?? newId();
      const tool = toolFromDraft(draft, id);
      const saved = await updateConfig((d) => {
        const i = d.customTools.findIndex((t) => t.id === id);
        if (i >= 0) d.customTools[i] = tool;
        else d.customTools.push(tool);
      });
      if (saved) {
        toast(props.editing ? `Saved "${tool.name}".` : `Added "${tool.name}". The model can use it in Chat now.`, "success");
        props.onSaved(tool);
      }
    } finally {
      setSaving(false);
    }
  };

  const chooseKind = (kind: CustomKindType) => {
    patch({ kind, approval: kind === "shell" ? "ask" : draft.approval });
    setChosen(true);
  };

  const applyTemplate = (build: () => ToolDraft) => {
    const d = build();
    d.name = uniqueName(d.name, props.takenNames);
    setDraft(d);
    setChosen(true);
    setNameTouched(true);
    setStep(1);
  };

  // ---------- steps ----------
  let body: ReactNode;
  if (step === 0) {
    body = (
      <div className="stack" style={{ gap: 18 }}>
        <p className="ext-lead" style={{ margin: 0 }}>
          A custom tool lets the model do something new on your Mac. First, pick how your tool works.
        </p>
        <div className="ext-choices ext-choices--wide" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <ChoiceCard
            icon={<Tile tone="dark">{KIND_INFO.shell.icon}</Tile>}
            title="Shell command"
            selected={chosen && draft.kind === "shell"}
            onClick={() => chooseKind("shell")}
            description="Runs a command on this Mac and returns what it prints."
            code="df -h /"
          />
          <ChoiceCard
            icon={<Tile tone="blue">{KIND_INFO.http.icon}</Tile>}
            title="HTTP request"
            selected={chosen && draft.kind === "http"}
            onClick={() => chooseKind("http")}
            description="Calls a web API and returns the reply."
            code="GET https://api.ipify.org"
          />
          <ChoiceCard
            icon={<Tile tone="pink">{KIND_INFO.shortcut.icon}</Tile>}
            title="Apple Shortcut"
            selected={chosen && draft.kind === "shortcut"}
            onClick={() => chooseKind("shortcut")}
            description="Runs a Shortcut from the Shortcuts app, for example one that adds a reminder."
            code='shortcuts run "Add Reminder"'
          />
        </div>
        <div>
          <div className="ext-h">Or start from a template</div>
          <div className="small muted" style={{ marginBottom: 10 }}>
            A template fills in every step for you. You can change anything before you save.
          </div>
          <div className="ext-choices">
            {TOOL_TEMPLATES.map((t) => (
              <ChoiceCard
                key={t.id}
                icon={<Tile tone={KIND_INFO[t.kind].tone}>{KIND_INFO[t.kind].icon}</Tile>}
                title={t.title}
                badge={<Badge>{KIND_INFO[t.kind].label}</Badge>}
                code={t.subtitle}
                onClick={() => applyTemplate(t.build)}
              />
            ))}
          </div>
        </div>
      </div>
    );
  } else if (step === 1) {
    body = (
      <div className="stack" style={{ gap: 16 }}>
        <Field
          label="Tool name"
          error={nameTouched && nameError ? nameError : undefined}
          hint="Lowercase letters, numbers and underscores. Example: get_weather"
        >
          <TextInput
            className="mono"
            autoFocus
            value={draft.name}
            placeholder="get_weather"
            onChange={(e) => {
              setNameTouched(true);
              patch({ name: toToolName(e.target.value) });
            }}
          />
        </Field>
        <Field label="Description" hint={`${formatNumber(Math.ceil(draft.description.length / 4))} tokens`}>
          <TextArea
            rows={3}
            value={draft.description}
            placeholder="Get the current weather for a city. Use this when the user asks about the weather."
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>
        <Callout>
          <b>The model reads this description to decide when to call your tool.</b> Say what the tool does and when to use
          it. A good example: <i>"Get the current weather for a city. Use this when the user asks about the weather, the
          temperature or rain."</i>
        </Callout>
        {draft.description.trim().length > 0 && draft.description.trim().length < 25 && (
          <div className="small muted">Tip: a longer description helps the model pick the right tool.</div>
        )}
      </div>
    );
  } else if (step === 2) {
    const setParam = (i: number, p: Partial<ToolDraft["params"][number]>) =>
      patch({ params: draft.params.map((x, j) => (j === i ? { ...x, ...p } : x)) });
    body = (
      <div className="stack" style={{ gap: 14 }}>
        <p className="ext-lead" style={{ margin: 0 }}>
          Parameters are the inputs the model fills in when it calls the tool. For example, a weather tool needs a{" "}
          <span className="mono">city</span>. Leave this empty if the tool needs no input.
        </p>
        {draft.params.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="ext-param">
              <span className="ext-param__head">Name</span>
              <span className="ext-param__head">Type</span>
              <span className="ext-param__head">Description (the model reads this)</span>
              <span className="ext-param__head">Required</span>
              <span />
            </div>
            {draft.params.map((p, i) => (
              <div key={i} className="ext-param">
                <TextInput
                  className="mono"
                  value={p.name}
                  placeholder="city"
                  onChange={(e) => setParam(i, { name: toToolName(e.target.value) })}
                />
                <Select<ParamType> value={p.type} onChange={(v) => setParam(i, { type: v })} options={PARAM_TYPES} />
                <TextInput
                  value={p.description}
                  placeholder="City name, for example Paris"
                  onChange={(e) => setParam(i, { description: e.target.value })}
                />
                <label className="ext-check">
                  <input type="checkbox" checked={p.required} onChange={(e) => setParam(i, { required: e.target.checked })} />
                  Required
                </label>
                <IconButton label="Remove parameter" onClick={() => patch({ params: draft.params.filter((_, j) => j !== i) })}>
                  <X size={14} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        <div>
          <Button
            icon={<Plus size={14} />}
            onClick={() =>
              patch({ params: [...draft.params, { name: "", type: "string", description: "", required: true }] })
            }
          >
            Add parameter
          </Button>
        </div>
        {paramErrors.length > 0 && <Callout tone="error">{paramErrors.join(" ")}</Callout>}
        {draft.params.length > 0 && (
          <div className="small muted">
            {draft.kind === "shell" && (
              <>
                Your command reads each one as an environment variable, for example{" "}
                <span className="mono">${envVarName(paramNames[0] ?? "city")}</span>.
              </>
            )}
            {draft.kind === "http" && (
              <>
                Use them in the URL, headers or body as <span className="mono">{`{{${paramNames[0] ?? "city"}}}`}</span>.
              </>
            )}
            {draft.kind === "shortcut" && (
              <>
                Tip: name a parameter <span className="mono">input</span>. The shortcut gets it as its input.
              </>
            )}
          </div>
        )}
      </div>
    );
  } else if (step === 3) {
    body = <ConfigureStep draft={draft} setDraft={setDraft} paramNames={paramNames} unknownPlaceholders={unknownPlaceholders} unknownEnv={unknownEnv} />;
  } else if (step === 4) {
    body = (
      <div className="stack">
        <p className="ext-lead" style={{ margin: 0 }}>
          Try your tool before you save it. Fill in example arguments, like the model would. This step is optional.
        </p>
        <ToolTestPanel
          schema={schema}
          dangerous={draft.kind === "shell"}
          run={(args) => customToolTest(toolFromDraft(draft, props.editing?.id ?? "test"), args)}
        />
      </div>
    );
  } else {
    const tokens = toolTokenEstimate(schema, draft.description, draft.name);
    body = (
      <div className="stack" style={{ gap: 16 }}>
        <div>
          <div className="ext-h">When the model wants to use this tool</div>
          <ApprovalChoice value={draft.approval} onChange={(approval) => patch({ approval })} recommendAsk={draft.kind === "shell"} />
        </div>
        {draft.kind === "shell" && draft.approval === "always" && (
          <Callout tone="warning">
            Shell commands can change or delete files. With "Always allow" the model runs this command without asking you.
          </Callout>
        )}
        <div className="group">
          <div className="group__row">
            <div className="group__label">
              <div>Turn on this tool</div>
              <div className="group__hint">When it is off, the model does not see it.</div>
            </div>
            <Toggle checked={draft.enabled} onChange={(enabled) => patch({ enabled })} label="Enabled" />
          </div>
        </div>
        <div className="card">
          <dl className="ext-summary" style={{ margin: 0 }}>
            <dt>Name</dt>
            <dd className="mono">{draft.name}</dd>
            <dt>Type</dt>
            <dd>{KIND_INFO[draft.kind].title}</dd>
            <dt>Parameters</dt>
            <dd>{paramNames.length ? paramNames.join(", ") : "None"}</dd>
            <dt>Context cost</dt>
            <dd>≈ {formatNumber(tokens)} tokens on every request while enabled</dd>
          </dl>
        </div>
      </div>
    );
  }

  return (
    <Modal
      wide
      title={props.editing ? `Edit tool "${props.editing.name}"` : "New tool"}
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <div className="spacer" />
          {stepError && step > 0 && <span className="xsmall" style={{ color: "var(--red)" }}>{stepError}</span>}
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              disabled={!!stepError}
              onClick={() => {
                if (step === 1) setNameTouched(true);
                setStep(step + 1);
              }}
            >
              {step === 4 ? "Next" : "Continue"}
            </Button>
          ) : (
            <Button variant="primary" loading={saving} onClick={save}>
              {props.editing ? "Save changes" : "Save tool"}
            </Button>
          )}
        </>
      }
    >
      <div className="ext-wizard">
        <Steps steps={STEPS} current={step} />
        {body}
      </div>
    </Modal>
  );
}

// ---------- step 4: configure ----------

function ConfigureStep(props: {
  draft: ToolDraft;
  setDraft: (fn: (d: ToolDraft) => ToolDraft) => void;
  paramNames: string[];
  unknownPlaceholders: string[];
  unknownEnv: string[];
}) {
  const { draft, paramNames } = props;
  const toast = useApp((s) => s.toast);
  const setShell = (p: Partial<ToolDraft["shell"]>) => props.setDraft((d) => ({ ...d, shell: { ...d.shell, ...p } }));
  const setHttp = (p: Partial<ToolDraft["http"]>) => props.setDraft((d) => ({ ...d, http: { ...d.http, ...p } }));
  const setShortcut = (p: Partial<ToolDraft["shortcut"]>) =>
    props.setDraft((d) => ({ ...d, shortcut: { ...d.shortcut, ...p } }));

  const timeoutField = (value: number, onChange: (n: number) => void) => (
    <Field label="Timeout" hint="Stop the tool if it runs longer than this. 1 to 600 seconds.">
      <div className="row">
        <TextInput
          type="number"
          min={1}
          max={600}
          style={{ width: 90 }}
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="small muted">seconds</span>
      </div>
    </Field>
  );

  if (draft.kind === "shell") {
    return (
      <div className="stack" style={{ gap: 16 }}>
        <Field label="Command" hint="Runs with /bin/zsh -c, like a line you type in Terminal.">
          <TextArea
            className="ext-mono-area"
            rows={4}
            autoFocus
            value={draft.shell.command}
            placeholder={'open -a "$FM_ARG_APP_NAME"'}
            onChange={(e) => setShell({ command: e.target.value })}
          />
        </Field>
        <Callout>
          <b>How arguments reach your command.</b> They are never pasted into the command text, so the model cannot
          inject extra commands. Read each one from an environment variable named{" "}
          <span className="mono">FM_ARG_&lt;NAME&gt;</span>. All arguments also arrive as one JSON object on standard input
          (stdin), for example for <span className="mono">jq</span>.
          {paramNames.length > 0 && (
            <div className="row row--wrap" style={{ marginTop: 8, gap: 6 }}>
              <span className="xsmall muted">Click to add:</span>
              {paramNames.map((p) => (
                <Chip key={p} on={false} onClick={() => setShell({ command: `${draft.shell.command}"$${envVarName(p)}"` })}>
                  <span className="mono">${envVarName(p)}</span>
                </Chip>
              ))}
            </div>
          )}
        </Callout>
        {props.unknownEnv.length > 0 && (
          <Callout tone="warning">
            The command uses {props.unknownEnv.map((v) => `$${v}`).join(", ")}, but there is no matching parameter. It will
            be empty.
          </Callout>
        )}
        <Callout tone="warning">
          Never paste passwords, API keys or tokens into a command. They are saved in plain text in the app's config file.
        </Callout>
        <Block label="Working folder" hint="Optional. The folder the command runs in. Leave empty for the default.">
          <FolderField
            value={draft.shell.cwd}
            onChange={(cwd) => setShell({ cwd })}
            title="Choose the working folder"
            onError={(m) => toast(m, "error")}
          />
        </Block>
        {timeoutField(draft.shell.timeoutSecs, (timeoutSecs) => setShell({ timeoutSecs }))}
      </div>
    );
  }

  if (draft.kind === "http") {
    const used = placeholders(draft);
    return (
      <div className="stack" style={{ gap: 16 }}>
        <Block
          label="Request"
          hint={
            <>
              Put parameters in the URL as <span className="mono">{"{{name}}"}</span>. They are URL-encoded for you.
            </>
          }
          error={props.unknownPlaceholders.length ? `Unknown: ${props.unknownPlaceholders.map((p) => `{{${p}}}`).join(", ")}. Add a parameter with that name or remove it.` : undefined}
        >
          <div className="ext-editor-row">
            <Select value={draft.http.method} onChange={(method) => setHttp({ method })} options={HTTP_METHODS} style={{ width: 100 }} />
            <TextInput
              className="mono"
              style={{ flex: 1 }}
              autoFocus
              value={draft.http.url}
              placeholder="https://wttr.in/{{city}}?format=3"
              onChange={(e) => setHttp({ url: e.target.value })}
            />
          </div>
        </Block>
        {paramNames.length > 0 && (
          <div className="row row--wrap" style={{ gap: 6 }}>
            <span className="xsmall muted">Parameters (click to add to the URL):</span>
            {paramNames.map((p) => (
              <Chip key={p} on={used.includes(p)} onClick={() => setHttp({ url: `${draft.http.url}{{${p}}}` })} title={used.includes(p) ? "Used" : "Not used yet"}>
                <span className="mono">{`{{${p}}}`}</span>
              </Chip>
            ))}
          </div>
        )}
        <Block label="Headers" hint="Optional. For example Accept: application/json. If an API needs a key, it is saved in plain text in the app's config file.">
          <KeyValueEditor
            rows={draft.http.headers}
            onChange={(headers) => setHttp({ headers })}
            keyPlaceholder="Accept"
            valuePlaceholder="application/json"
            addLabel="Add header"
            monoKeys
          />
        </Block>
        <Field
          label="Body"
          hint={
            <>
              Optional, usually empty for GET. For a JSON API: <span className="mono">{'{"city": "{{city}}"}'}</span>. Placeholders
              in a JSON body are escaped for you.
            </>
          }
        >
          <TextArea className="ext-mono-area" rows={4} value={draft.http.body} onChange={(e) => setHttp({ body: e.target.value })} />
        </Field>
        {timeoutField(draft.http.timeoutSecs, (timeoutSecs) => setHttp({ timeoutSecs }))}
      </div>
    );
  }

  return <ShortcutConfig draft={draft} setShortcut={setShortcut} paramNames={paramNames} timeoutField={timeoutField} />;
}

function ShortcutConfig(props: {
  draft: ToolDraft;
  setShortcut: (p: Partial<ToolDraft["shortcut"]>) => void;
  paramNames: string[];
  timeoutField: (value: number, onChange: (n: number) => void) => ReactNode;
}) {
  const { draft, setShortcut } = props;
  const [list, setList] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setList(await shortcutsList());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
      setList((l) => l ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const name = draft.shortcut.shortcutName;
  const q = name.trim().toLowerCase();
  const filtered = (list ?? []).filter((s) => !q || s.toLowerCase().includes(q) || s === name);
  const hasInput = props.paramNames.includes("input");

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Block label="Shortcut" hint="Pick one of your shortcuts, or type its exact name.">
        <div className="ext-editor-row">
          <TextInput
            style={{ flex: 1 }}
            autoFocus
            value={name}
            placeholder="Add Reminder"
            onChange={(e) => setShortcut({ shortcutName: e.target.value })}
          />
          <Button icon={<RefreshCw size={13} />} loading={loading} onClick={load}>
            Refresh
          </Button>
        </div>
      </Block>
      {error ? (
        <Callout tone="warning">Could not read your shortcuts: {error} You can still type the name.</Callout>
      ) : list && list.length === 0 && !loading ? (
        <div className="small muted">No shortcuts found. Make one in the Shortcuts app, then click Refresh.</div>
      ) : (
        <div className="ext-scroll-list">
          {filtered.map((s) => (
            <Chip key={s} on={s === name} onClick={() => setShortcut({ shortcutName: s })}>
              {s}
            </Chip>
          ))}
          {list && filtered.length === 0 && <span className="small muted">No shortcut matches "{name}".</span>}
        </div>
      )}
      <Callout>
        <b>How it works.</b> The tool runs <span className="mono">shortcuts run "{name || "Shortcut Name"}"</span>. The
        model's <span className="mono">input</span> argument is passed to the shortcut as its input. If there is no{" "}
        <span className="mono">input</span> parameter, all arguments are passed as JSON text. Whatever the shortcut
        outputs (for example with a "Stop and Output" action) goes back to the model.
      </Callout>
      {!hasInput && props.paramNames.length === 0 && (
        <div className="small muted">
          <TriangleAlert size={12} style={{ verticalAlign: -1 }} /> This tool has no parameters, so the shortcut gets no
          input. Go back to add one named <span className="mono">input</span> if your shortcut needs text.
        </div>
      )}
      <CodeBlock code={`shortcuts run ${JSON.stringify(name || "Shortcut Name")} --input-path <file with the input>`} copy={false} />
      {props.timeoutField(draft.shortcut.timeoutSecs, (timeoutSecs) => setShortcut({ timeoutSecs }))}
    </div>
  );
}
