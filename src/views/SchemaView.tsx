// Schema Builder: a visual front end for `fm schema object`. OWNER: agent "ui-build".
// Left: type name + property rows. Right: live JSON from fm, actions, and "Try it".

import { Braces, Copy, Save, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  CommandPreview,
  Empty,
  Field,
  Page,
  Select,
  Spinner,
  TextInput,
} from "../components/ui";
import { errorMessage, fmRun, writeTextFile } from "../lib/api";
import { displayCommand, schemaObjectArgs, validateSchema, type SchemaDefinition, type SchemaProperty } from "../lib/fmArgs";
import { useApp } from "../lib/store";
import { InspectorSection, Toolbar, Workbench, pickSavePath, stripAnsi, tryPrettyJson, useDebouncedValue } from "./playground/workbench";
import { PRESETS } from "./schema/presets";
import { PropertyList } from "./schema/PropertyList";
import { useSchemaBuilder } from "./schema/store";
import { TryIt } from "./schema/TryIt";
import "./schema/schema.css";

interface Generated {
  key: string;
  json: string | null;
  error: string | null;
}

export default function SchemaView() {
  const def = useSchemaBuilder((s) => s.def);
  const setDef = useSchemaBuilder((s) => s.setDef);
  const setTryPrompt = useSchemaBuilder((s) => s.setTryPrompt);
  const config = useApp((s) => s.config);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const fmPath = config?.fmPath || "/usr/bin/fm";

  const [focusId, setFocusId] = useState<string | null>(null);
  const [gen, setGen] = useState<Generated | null>(null);
  const [pending, setPending] = useState(false);
  const seq = useRef(0);

  const problems = validateSchema(def);
  const key = JSON.stringify(def);
  const debouncedKey = useDebouncedValue(key, 300);
  const command = displayCommand(schemaObjectArgs(def), fmPath);

  // Live JSON: run `fm schema object` (it takes a few ms) after a short pause.
  useEffect(() => {
    const d = JSON.parse(debouncedKey) as SchemaDefinition;
    if (validateSchema(d).length) {
      setPending(false);
      return;
    }
    const mine = ++seq.current;
    setPending(true);
    fmRun(schemaObjectArgs(d), () => {})
      .then((res) => {
        if (mine !== seq.current) return;
        if (res.exitCode === 0 && res.stdout.trim()) {
          const out = res.stdout.trim();
          setGen({ key: debouncedKey, json: tryPrettyJson(out) ?? out, error: null });
        } else {
          const msg = res.error || stripAnsi(res.stderr).trim() || `fm exited with code ${res.exitCode}.`;
          setGen({ key: debouncedKey, json: null, error: msg });
        }
      })
      .catch((err) => {
        if (mine === seq.current) setGen({ key: debouncedKey, json: null, error: errorMessage(err) });
      })
      .finally(() => {
        if (mine === seq.current) setPending(false);
      });
  }, [debouncedKey]);

  const upToDate = gen?.key === key && problems.length === 0;
  const json = upToDate ? gen?.json ?? null : null;
  const shownJson = gen?.json ?? null;

  const setProps = (properties: SchemaProperty[]) => setDef({ ...def, properties });

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setDef(preset.build());
    setTryPrompt(preset.samplePrompt);
    setFocusId(null);
  };

  const saveAs = async () => {
    if (!json) return;
    try {
      const path = await pickSavePath({
        title: "Save schema",
        defaultPath: `${def.rootName.trim() || "Schema"}.schema.json`,
        name: "JSON",
        extensions: ["json"],
      });
      if (!path) return;
      await writeTextFile(path, json + "\n");
      toast(`Saved ${path}`, "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const copy = async () => {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      toast("JSON copied.", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <Page
      title="Schema Builder"
      subtitle="Design a structured output schema with fm schema object."
      flush
      actions={
        <Select<string>
          value=""
          onChange={applyPreset}
          options={[{ value: "", label: "Start from a preset…" }, ...PRESETS.map((p) => ({ value: p.id, label: p.label }))]}
          style={{ width: 190 }}
        />
      }
    >
      <Workbench
        sideWidth={500}
        side={
          <>
            <InspectorSection title="Type">
              <Field label="Type name" hint="The schema title, like Person. One word.">
                <TextInput
                  className="wb-mono-input"
                  value={def.rootName}
                  placeholder="Person"
                  onChange={(e) => setDef({ ...def, rootName: e.target.value })}
                />
              </Field>
            </InspectorSection>
            <InspectorSection
              title="Properties"
              badge={<span className="badge">{def.properties.length}</span>}
            >
              <div className="xsmall muted">
                Use dot notation for nested objects: <span className="mono">address.street</span> and{" "}
                <span className="mono">address.city</span> become one <span className="mono">Address</span> object.
              </div>
              <PropertyList
                properties={def.properties}
                onChange={setProps}
                focusId={focusId}
                onAdd={(p) => {
                  setFocusId(p.id);
                  setProps([...def.properties, p]);
                }}
              />
            </InspectorSection>
          </>
        }
      >
        <Toolbar>
          <Button icon={<Copy size={13} />} onClick={copy} disabled={!json}>
            Copy JSON
          </Button>
          <Button icon={<Save size={13} />} onClick={saveAs} disabled={!json}>
            Save As…
          </Button>
          <Button
            variant="primary"
            icon={<TerminalSquare size={13} />}
            disabled={!json}
            onClick={() => json && navigate("playground", { playgroundSchema: json })}
          >
            Use in Playground
          </Button>
          <div className="spacer" />
          {pending ? (
            <span className="wb-running">
              <Spinner /> Generating
            </span>
          ) : problems.length ? (
            <Badge tone="orange">Needs fixes</Badge>
          ) : gen?.error && upToDate ? (
            <Badge tone="red">fm error</Badge>
          ) : json ? (
            <Badge tone="green">Up to date</Badge>
          ) : null}
        </Toolbar>
        <div className="wb__band">
          <CommandPreview command={command} />
          {problems.length > 0 && (
            <Callout tone="warning">
              <ul className="wb-problems">
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </Callout>
          )}
        </div>
        <div className="wb__scroll">
          <div className="sb-main">
            {gen?.error && upToDate && (
              <Callout tone="error">
                <strong>fm could not build this schema.</strong> {gen.error}
              </Callout>
            )}
            {shownJson ? (
              <div className={upToDate ? undefined : "sb-stale"}>
                <pre className="sb-json selectable">{shownJson}</pre>
              </div>
            ) : (
              !gen?.error && (
                <div className="sb-json-empty">
                  <Empty icon={<Braces size={28} />} title="No schema yet">
                    Add a type name and at least one property. The JSON from fm appears here.
                  </Empty>
                </div>
              )
            )}
            <Callout>
              Writing a schema by hand? fm needs <span className="mono">title</span>,{" "}
              <span className="mono">"additionalProperties": false</span> and <span className="mono">x-order</span> on every
              object. If one is missing, fm stops with a vague error: "The data couldn't be read because it is missing."
              This builder lets fm generate them for you.
            </Callout>
            <TryIt json={json} rootName={def.rootName.trim()} />
          </div>
        </div>
      </Workbench>
    </Page>
  );
}
