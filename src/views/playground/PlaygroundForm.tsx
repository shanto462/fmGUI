// Left inspector of the Playground: every `fm respond` option.

import { Braces, ImageIcon, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { Button, Chip, Field, IconButton, Segmented, Select, TextArea, TextInput, Toggle } from "../../components/ui";
import { errorMessage, newId, readImageDataUrl } from "../../lib/api";
import { IMAGE_EXTENSIONS, pickFile, pickFiles, pickSavePath } from "../../lib/dialogs";
import type { BuiltinCliTool, Guardrails, UseCase } from "../../lib/fmArgs";
import { jsonError } from "../../lib/format";
import { baseName, tildePath } from "../../lib/paths";
import { useApp } from "../../lib/store";
import { usePlayground, type PgForm, type SchemaMode } from "./store";
import { TranscriptPreview } from "./TranscriptPreview";
import { FileField, InspectorRow, InspectorSection } from "./workbench";

const TOOLS: { id: BuiltinCliTool; label: string; hint: string }[] = [
  { id: "ocr", label: "OCR", hint: "Reads text in attached images" },
  { id: "barcode", label: "Barcode", hint: "Reads barcodes and QR codes in attached images" },
];

export function PlaygroundForm() {
  const form = usePlayground((s) => s.form);
  const setForm = usePlayground((s) => s.setForm);
  const toast = useApp((s) => s.toast);
  const navigate = useApp((s) => s.navigate);

  const fail = (err: unknown) => toast(errorMessage(err), "error");

  return (
    <>
      <InspectorSection title="Prompt">
        <TextArea
          rows={7}
          value={form.prompt}
          placeholder="Ask the on-device model anything…"
          onChange={(e) => setForm({ prompt: e.target.value })}
          style={{ minHeight: 120 }}
          spellCheck
        />
      </InspectorSection>

      <InspectorSection title="Instructions" badge={form.instructions.trim() ? <span className="pg-dot" /> : null}>
        <TextArea
          rows={3}
          value={form.instructions}
          placeholder="Optional. For example: Answer in one short paragraph."
          onChange={(e) => setForm({ instructions: e.target.value })}
          spellCheck
        />
      </InspectorSection>

      <TextSegments form={form} setForm={setForm} />
      <Images form={form} setForm={setForm} onError={fail} />

      <InspectorSection title="CLI tools" defaultOpen={form.tools.length > 0}>
        <div className="row row--wrap">
          {TOOLS.map((t) => {
            const on = form.tools.includes(t.id);
            return (
              <Chip
                key={t.id}
                on={on}
                title={t.hint}
                onClick={() => setForm({ tools: on ? form.tools.filter((x) => x !== t.id) : [...form.tools, t.id] })}
              >
                {t.label}
              </Chip>
            );
          })}
        </div>
        <div className="xsmall muted">
          Built-in tools the model can call on attached images. Turning one on also lets you name each image.
        </div>
      </InspectorSection>

      <InspectorSection title="Structured output" defaultOpen={form.schemaMode !== "none"}>
        <Segmented<SchemaMode>
          value={form.schemaMode}
          onChange={(schemaMode) => setForm({ schemaMode })}
          options={[
            { value: "none", label: "None" },
            { value: "file", label: "Schema file" },
            { value: "paste", label: "Paste JSON" },
          ]}
        />
        {form.schemaMode === "file" && (
          <FileField
            path={form.schemaFile}
            placeholder="No schema file"
            onClear={() => setForm({ schemaFile: "" })}
            onChoose={() =>
              pickFile({ title: "Choose a schema file", name: "JSON", extensions: ["json"] })
                .then((p) => p && setForm({ schemaFile: p }))
                .catch(fail)
            }
          />
        )}
        {form.schemaMode === "paste" && (
          <Field error={form.schemaText.trim() ? jsonError(form.schemaText) : null}>
            <TextArea
              rows={7}
              className="wb-mono-input"
              value={form.schemaText}
              placeholder='{"title": "Mood", "type": "object", ...}'
              onChange={(e) => setForm({ schemaText: e.target.value })}
            />
          </Field>
        )}
        {form.schemaMode !== "none" && (
          <div className="row">
            <span className="xsmall muted" style={{ flex: 1 }}>
              The reply is JSON that matches the schema.
            </span>
            <Button size="sm" variant="plain" icon={<Braces size={13} />} onClick={() => navigate("schema")}>
              Schema Builder
            </Button>
          </div>
        )}
      </InspectorSection>

      <InspectorSection title="Model">
        <Field label="Use case">
          <Select<UseCase>
            value={form.useCase}
            onChange={(useCase) => setForm({ useCase })}
            options={[
              { value: "general", label: "General" },
              { value: "content-tagging", label: "Content tagging" },
            ]}
          />
        </Field>
        <Field label="Guardrails">
          <Select<Guardrails>
            value={form.guardrails}
            onChange={(guardrails) => setForm({ guardrails })}
            options={[
              { value: "default", label: "Default" },
              { value: "permissive-content-transformations", label: "Permissive content transformations" },
            ]}
          />
        </Field>
        <InspectorRow label="Stream" hint="Show text as it is generated">
          <Toggle label="Stream" checked={form.stream} onChange={(stream) => setForm({ stream })} />
        </InspectorRow>
        <InspectorRow label="Greedy sampling" hint="Same prompt, same answer">
          <Toggle label="Greedy" checked={form.greedy} onChange={(greedy) => setForm({ greedy })} />
        </InspectorRow>
        <InspectorRow label="Verbose" hint="Extra details on stderr">
          <Toggle label="Verbose" checked={form.verbose} onChange={(verbose) => setForm({ verbose })} />
        </InspectorRow>
      </InspectorSection>

      <InspectorSection title="Transcript" defaultOpen={!!(form.resumePath || form.saveTranscriptPath)}>
        <Field label="Resume from" hint="Continue a saved conversation.">
          <FileField
            path={form.resumePath}
            placeholder="New conversation"
            onClear={() => setForm({ resumePath: "" })}
            onChoose={() =>
              pickFile({ title: "Choose a transcript", name: "Transcript", extensions: ["json"] })
                .then((p) => p && setForm({ resumePath: p }))
                .catch(fail)
            }
          />
        </Field>
        {form.resumePath && <TranscriptPreview path={form.resumePath} />}
        <Field label="Save transcript to" hint="Writes the whole conversation after the reply.">
          <FileField
            path={form.saveTranscriptPath}
            placeholder="Do not save"
            chooseLabel="Save As…"
            onClear={() => setForm({ saveTranscriptPath: "" })}
            onChoose={() =>
              pickSavePath({
                title: "Save transcript",
                defaultPath: form.resumePath || "transcript.json",
                name: "Transcript",
                extensions: ["json"],
              })
                .then((p) => p && setForm({ saveTranscriptPath: p }))
                .catch(fail)
            }
          />
        </Field>
        {form.resumePath && form.saveTranscriptPath !== form.resumePath && (
          <Button size="sm" variant="plain" onClick={() => setForm({ saveTranscriptPath: form.resumePath })}>
            Save back to the resumed file
          </Button>
        )}
      </InspectorSection>
    </>
  );
}

function TextSegments(props: { form: PgForm; setForm: (p: Partial<PgForm>) => void }) {
  const { form, setForm } = props;
  const segs = form.textSegments;
  const set = (i: number, v: string) => setForm({ textSegments: segs.map((s, j) => (j === i ? v : s)) });
  return (
    <InspectorSection
      title="Text segments"
      defaultOpen={segs.length > 0}
      badge={segs.length ? <span className="badge">{segs.length}</span> : null}
      actions={
        <IconButton label="Add text segment" onClick={() => setForm({ textSegments: [...segs, ""] })}>
          <Plus size={14} />
        </IconButton>
      }
    >
      {segs.length === 0 && (
        <div className="xsmall muted">Extra text added to the prompt with --text. Useful for long documents.</div>
      )}
      {segs.map((s, i) => (
        <div key={i} className="wb-item">
          <TextArea
            rows={2}
            value={s}
            placeholder={`Text segment ${i + 1}`}
            onChange={(e) => set(i, e.target.value)}
            spellCheck
          />
          <IconButton label="Remove" onClick={() => setForm({ textSegments: segs.filter((_, j) => j !== i) })}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}
      {segs.length > 0 && (
        <Button
          size="sm"
          variant="plain"
          icon={<Plus size={13} />}
          onClick={() => setForm({ textSegments: [...segs, ""] })}
        >
          Add segment
        </Button>
      )}
    </InspectorSection>
  );
}

function Images(props: { form: PgForm; setForm: (p: Partial<PgForm>) => void; onError: (err: unknown) => void }) {
  const { form, setForm, onError } = props;
  const thumbs = usePlayground((s) => s.thumbs);
  const setThumb = usePlayground((s) => s.setThumb);
  const toolsOn = form.tools.length > 0;
  const home = useApp((s) => s.paths?.homeDir);

  // Load thumbnails for new images.
  useEffect(() => {
    for (const img of form.images) {
      if (img.path in usePlayground.getState().thumbs) continue;
      setThumb(img.path, null);
      readImageDataUrl(img.path)
        .then((url) => setThumb(img.path, url))
        .catch(() => setThumb(img.path, null));
    }
  }, [form.images, setThumb]);

  const add = () =>
    pickFiles({ title: "Add images", name: "Images", extensions: IMAGE_EXTENSIONS })
      .then((paths) => {
        if (!paths.length) return;
        const current = usePlayground.getState().form.images;
        setForm({ images: [...current, ...paths.map((path) => ({ id: newId(), path, label: "" }))] });
      })
      .catch(onError);

  return (
    <InspectorSection
      title="Images"
      defaultOpen={form.images.length > 0}
      badge={form.images.length ? <span className="badge">{form.images.length}</span> : null}
      actions={
        <IconButton label="Add images" onClick={add}>
          <ImagePlus size={14} />
        </IconButton>
      }
    >
      {form.images.length === 0 ? (
        <button type="button" className="drop-zone pg-add-images" onClick={add}>
          <ImagePlus size={16} />
          Add images (PNG, JPEG, HEIC…)
        </button>
      ) : (
        form.images.map((img, i) => (
          <div key={img.id} className="wb-image">
            {thumbs[img.path] ? (
              <img className="thumb" src={thumbs[img.path] ?? undefined} alt="" />
            ) : (
              <div className="wb-image__placeholder">
                <ImageIcon size={18} />
              </div>
            )}
            <div className="wb-image__meta">
              <div className="small truncate" title={tildePath(img.path, home)}>
                {baseName(img.path)}
              </div>
              <TextInput
                value={img.label}
                disabled={!toolsOn}
                placeholder={toolsOn ? `Label (default image_${i})` : "Label needs OCR or Barcode"}
                onChange={(e) =>
                  setForm({ images: form.images.map((x) => (x.id === img.id ? { ...x, label: e.target.value } : x)) })
                }
                style={{ minHeight: 24, padding: "2px 7px" }}
              />
            </div>
            <IconButton
              label="Remove image"
              onClick={() => setForm({ images: form.images.filter((x) => x.id !== img.id) })}
            >
              <X size={14} />
            </IconButton>
          </div>
        ))
      )}
      {toolsOn && form.images.some((i) => i.label.trim()) && (
        <div className="xsmall muted">
          fm pairs labels with images by order, so empty labels get the default name image_N.
        </div>
      )}
    </InspectorSection>
  );
}
