// Property rows for the Schema Builder. OWNER: agent "ui-build".

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Chip, IconButton, Select, TextInput, cx } from "../../components/ui";
import type { SchemaProperty, SchemaPropertyType } from "../../lib/fmArgs";
import { newProperty } from "./presets";
import "./schema.css";

const TYPES: { value: SchemaPropertyType; label: string }[] = [
  { value: "string", label: "String" },
  { value: "integer", label: "Integer" },
  { value: "double", label: "Double" },
  { value: "boolean", label: "Boolean" },
];

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Problems for one row, so the row can be highlighted. */
function rowProblem(p: SchemaProperty, all: SchemaProperty[]): string | null {
  const name = p.name.trim();
  if (!name) return "Name is empty.";
  if (!NAME_RE.test(name)) return "Use letters, digits and _ only. Dots create nested objects.";
  if (all.filter((x) => x.name.trim() === name).length > 1) return "This name is used twice.";
  // "address" and "address.street" cannot both exist.
  const clash = all.find((x) => x.id !== p.id && x.name.trim().startsWith(`${name}.`));
  if (clash) return `"${name}" is also used as an object for "${clash.name.trim()}".`;
  return null;
}

export function PropertyList(props: {
  properties: SchemaProperty[];
  onChange: (next: SchemaProperty[]) => void;
  focusId: string | null;
  onAdd: (p: SchemaProperty) => void;
}) {
  const { properties, onChange } = props;
  const update = (id: string, patch: Partial<SchemaProperty>) =>
    onChange(properties.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= properties.length) return;
    const next = properties.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="sb-props">
      {properties.map((p, i) => {
        const problem = rowProblem(p, properties);
        return (
          <div key={p.id} className={cx("sb-prop", problem && p.name.trim() && "sb-prop--error")}>
            <div className="sb-prop__line">
              <span className="sb-prop__index">{i + 1}</span>
              <TextInput
                className="wb-mono-input sb-prop__name"
                value={p.name}
                placeholder="name or address.street"
                autoFocus={props.focusId === p.id}
                onChange={(e) => update(p.id, { name: e.target.value })}
                aria-label="Property name"
              />
              <Select<SchemaPropertyType>
                value={p.type}
                onChange={(type) => update(p.id, { type })}
                options={TYPES}
                style={{ width: 96 }}
              />
              <div className="sb-prop__tools">
                <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={13} />
                </IconButton>
                <IconButton label="Move down" disabled={i === properties.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={13} />
                </IconButton>
                <IconButton label="Delete property" onClick={() => onChange(properties.filter((x) => x.id !== p.id))}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            </div>
            <div className="sb-prop__line sb-prop__line--second">
              <TextInput
                className="sb-prop__desc"
                value={p.description}
                placeholder="Description (optional). It guides the model."
                onChange={(e) => update(p.id, { description: e.target.value })}
                aria-label="Description"
                spellCheck
              />
              <Chip on={p.isArray} onClick={() => update(p.id, { isArray: !p.isArray })} title="A list of values (--array)">
                Array
              </Chip>
              <Chip
                on={p.isOptional}
                onClick={() => update(p.id, { isOptional: !p.isOptional })}
                title="The model may leave it out (--optional)"
              >
                Optional
              </Chip>
            </div>
            {problem && p.name.trim() && <div className="field__error sb-prop__error">{problem}</div>}
          </div>
        );
      })}
      <Button
        variant="plain"
        size="sm"
        icon={<Plus size={13} />}
        onClick={() => props.onAdd(newProperty())}
        style={{ alignSelf: "flex-start" }}
      >
        Add property
      </Button>
    </div>
  );
}
