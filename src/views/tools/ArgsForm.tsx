// A form generated from a JSON schema (string, integer, number, boolean, enum),
// with a raw JSON fallback. Used by the tool "Test" modal and the wizard test step.

import { Play } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Badge, Button, Callout, CodeBlock, Field, Select, TextArea, TextInput, Toggle } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { formatDuration } from "../../lib/format";
import type { ToolTestResult } from "../../lib/types";

type Kind = "string" | "integer" | "number" | "boolean" | "enum" | "json";

interface FieldSpec {
  name: string;
  kind: Kind;
  description: string;
  required: boolean;
  enumValues: unknown[];
}

type Values = Record<string, string | boolean>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Fields for a JSON schema. null means "too complex for a form, use JSON". */
function fieldsFromSchema(schema: unknown): FieldSpec[] | null {
  if (schema == null) return [];
  if (!isObj(schema)) return null;
  if (schema.anyOf || schema.oneOf || schema.allOf) return null;
  const props = schema.properties;
  if (props == null) return schema.type === "object" || schema.type === undefined ? [] : null;
  if (!isObj(props)) return null;
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]).map(String) : [];
  const order = Array.isArray(schema["x-order"]) ? (schema["x-order"] as unknown[]).map(String) : [];
  const names = Object.keys(props).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  return names.map((name) => {
    const p = isObj(props[name]) ? (props[name] as Record<string, unknown>) : {};
    let type = p.type;
    if (Array.isArray(type)) type = type.find((t) => t !== "null");
    let kind: Kind = "json";
    if (Array.isArray(p.enum) && p.enum.length > 0) kind = "enum";
    else if (type === "string" || type === "integer" || type === "number" || type === "boolean") kind = type;
    return {
      name,
      kind,
      description: typeof p.description === "string" ? p.description : typeof p.title === "string" ? p.title : "",
      required: required.includes(name),
      enumValues: Array.isArray(p.enum) ? p.enum : [],
    };
  });
}

function initialValues(fields: FieldSpec[] | null): Values {
  const v: Values = {};
  for (const f of fields ?? []) {
    if (f.kind === "boolean") v[f.name] = false;
    else if (f.kind === "enum" && f.required) v[f.name] = String(f.enumValues[0]);
    else v[f.name] = "";
  }
  return v;
}

type Collected = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

function collect(fields: FieldSpec[], values: Values): Collected {
  const args: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.name];
    if (f.kind === "boolean") {
      args[f.name] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw : "";
    if (text.trim() === "") {
      if (f.required) return { ok: false, error: `"${f.name}" is required.` };
      continue;
    }
    if (f.kind === "string") args[f.name] = text;
    else if (f.kind === "integer") {
      const n = Number(text);
      if (!Number.isInteger(n)) return { ok: false, error: `"${f.name}" must be a whole number, for example 42.` };
      args[f.name] = n;
    } else if (f.kind === "number") {
      const n = Number(text);
      if (!Number.isFinite(n)) return { ok: false, error: `"${f.name}" must be a number, for example 3.5.` };
      args[f.name] = n;
    } else if (f.kind === "enum") {
      const match = f.enumValues.find((e) => String(e) === text);
      args[f.name] = match === undefined ? text : match;
    } else {
      try {
        args[f.name] = JSON.parse(text);
      } catch {
        return { ok: false, error: `"${f.name}" must be valid JSON, for example ["a", "b"] or {"key": 1}.` };
      }
    }
  }
  return { ok: true, args };
}

/** Returns the form UI and a function that reads the arguments. */
function useArgsForm(schema: unknown): { form: ReactNode; read: () => Collected } {
  const fields = useMemo(() => fieldsFromSchema(schema), [schema]);
  const [values, setValues] = useState<Values>(() => initialValues(fields));
  const [jsonMode, setJsonMode] = useState(fields === null);
  const [jsonText, setJsonText] = useState("{}");
  const [shownFields, setShownFields] = useState(fields);

  // The fields changed (in the wizard the user edits the parameters): keep the
  // values that still fit. Done during render, so there is no extra render.
  if (shownFields !== fields) {
    setShownFields(fields);
    setValues((prev) => {
      const next = initialValues(fields);
      for (const k of Object.keys(next)) if (k in prev && typeof prev[k] === typeof next[k]) next[k] = prev[k];
      return next;
    });
    if (fields === null) setJsonMode(true);
  }

  const set = (name: string, v: string | boolean) => setValues((prev) => ({ ...prev, [name]: v }));

  const read = (): Collected => {
    if (jsonMode || fields === null) {
      try {
        const parsed = JSON.parse(jsonText.trim() || "{}");
        if (!isObj(parsed))
          return { ok: false, error: 'Arguments must be a JSON object, for example {"city": "Paris"}.' };
        return { ok: true, args: parsed };
      } catch (err) {
        return { ok: false, error: `The JSON is not valid: ${errorMessage(err)}` };
      }
    }
    return collect(fields, values);
  };

  const switchToJson = () => {
    const c = fields ? collect(fields, values) : null;
    setJsonText(JSON.stringify(c && c.ok ? c.args : {}, null, 2));
    setJsonMode(true);
  };

  const switchToForm = () => {
    try {
      const parsed = JSON.parse(jsonText || "{}");
      if (isObj(parsed) && fields) {
        const next = initialValues(fields);
        for (const f of fields) {
          const v = parsed[f.name];
          if (v === undefined) continue;
          if (f.kind === "boolean") next[f.name] = v === true;
          else if (f.kind === "json") next[f.name] = JSON.stringify(v);
          else next[f.name] = String(v);
        }
        setValues(next);
      }
    } catch {
      // Keep the old form values when the JSON is broken.
    }
    setJsonMode(false);
  };

  let body: ReactNode;
  if (jsonMode || fields === null) {
    body = (
      <TextArea
        className="ext-mono-area"
        rows={6}
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        placeholder='{"city": "Paris"}'
      />
    );
  } else if (fields.length === 0) {
    body = <div className="small muted">This tool takes no arguments. Just click Run.</div>;
  } else {
    body = (
      <div className="stack">
        {fields.map((f) => {
          const label = (
            <span className="row" style={{ gap: 6 }}>
              <span className="mono">{f.name}</span>
              {f.required ? <Badge tone="accent">Required</Badge> : <span className="xsmall muted">optional</span>}
              <span className="xsmall muted">{kindLabel(f.kind)}</span>
            </span>
          );
          if (f.kind === "boolean") {
            return (
              <div key={f.name} className="row">
                <div style={{ flex: 1 }}>
                  <div className="field__label">{label}</div>
                  {f.description && <div className="field__hint">{f.description}</div>}
                </div>
                <Toggle checked={values[f.name] === true} onChange={(v) => set(f.name, v)} label={f.name} />
              </div>
            );
          }
          let control: ReactNode;
          if (f.kind === "enum") {
            const options = [
              ...(f.required ? [] : [{ value: "", label: "(not set)" }]),
              ...f.enumValues.map((e) => ({ value: String(e), label: String(e) })),
            ];
            control = (
              <Select value={String(values[f.name] ?? "")} onChange={(v) => set(f.name, v)} options={options} />
            );
          } else if (f.kind === "json") {
            control = (
              <TextArea
                className="ext-mono-area"
                rows={3}
                value={String(values[f.name] ?? "")}
                placeholder='["a", "b"]'
                onChange={(e) => set(f.name, e.target.value)}
              />
            );
          } else {
            control = (
              <TextInput
                value={String(values[f.name] ?? "")}
                inputMode={f.kind === "string" ? undefined : "decimal"}
                placeholder={f.kind === "integer" ? "42" : f.kind === "number" ? "3.5" : ""}
                onChange={(e) => set(f.name, e.target.value)}
              />
            );
          }
          return (
            <Field key={f.name} label={label} hint={f.description || undefined}>
              {control}
            </Field>
          );
        })}
      </div>
    );
  }

  const form = (
    <div className="stack">
      {body}
      {fields !== null && fields.length > 0 && (
        <div>
          <button type="button" className="ext-link small" onClick={jsonMode ? switchToForm : switchToJson}>
            {jsonMode ? "Use the form" : "Edit as JSON"}
          </button>
        </div>
      )}
    </div>
  );
  return { form, read };
}

function kindLabel(k: Kind): string {
  return {
    string: "text",
    integer: "whole number",
    number: "number",
    boolean: "yes / no",
    enum: "choice",
    json: "JSON",
  }[k];
}

/** Argument form + Run button + output. */
export function ToolTestPanel(props: {
  schema: unknown;
  dangerous?: boolean;
  run: (args: Record<string, unknown>) => Promise<ToolTestResult>;
}) {
  const { form, read } = useArgsForm(props.schema);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const c = read();
    if (!c.ok) {
      setError(c.error);
      setResult(null);
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await props.run(c.args));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="stack">
      {props.dangerous && (
        <Callout tone="warning">This tool can change things on your Mac. A test runs it for real.</Callout>
      )}
      <div className="ext-h" style={{ margin: 0 }}>
        Arguments
      </div>
      {form}
      <div className="row">
        <Button variant="primary" icon={<Play size={13} />} loading={running} onClick={run}>
          {running ? "Running…" : "Run"}
        </Button>
        {result && (
          <span className="row small">
            {result.ok ? <Badge tone="green">Worked</Badge> : <Badge tone="red">Failed</Badge>}
            <span className="muted">in {formatDuration(result.durationMs)}</span>
          </span>
        )}
      </div>
      {error && <Callout tone="error">{error}</Callout>}
      {result && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="ext-h" style={{ margin: 0 }}>
            Output
          </div>
          <CodeBlock code={result.output || "(no output)"} wrap maxHeight={280} />
          <div className="xsmall muted">This is the text the model would receive.</div>
        </div>
      )}
    </div>
  );
}
