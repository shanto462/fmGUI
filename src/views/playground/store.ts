// Playground state lives outside the component so a running `fm respond`, the
// form, and the run history survive switching pages. OWNER: agent "ui-build".

import { create } from "zustand";
import { errorMessage, fmCancel, fmRun, newId, saveTempText } from "../../lib/api";
import {
  displayCommand,
  respondArgs,
  validateRespond,
  type BuiltinCliTool,
  type Guardrails,
  type RespondOptions,
  type UseCase,
} from "../../lib/fmArgs";
import type { RunResult } from "../../lib/types";
import { hashText, joinPath, jsonError } from "./workbench";

export type SchemaMode = "none" | "file" | "paste";

export interface PgImage {
  id: string;
  path: string;
  label: string;
}

export interface PgForm {
  prompt: string;
  instructions: string;
  textSegments: string[];
  images: PgImage[];
  tools: BuiltinCliTool[];
  schemaMode: SchemaMode;
  schemaFile: string;
  schemaText: string;
  useCase: UseCase;
  guardrails: Guardrails;
  stream: boolean;
  greedy: boolean;
  verbose: boolean;
  resumePath: string;
  saveTranscriptPath: string;
}

export const emptyForm = (): PgForm => ({
  prompt: "",
  instructions: "",
  textSegments: [],
  images: [],
  tools: [],
  schemaMode: "none",
  schemaFile: "",
  schemaText: "",
  useCase: "general",
  guardrails: "default",
  stream: true,
  greedy: false,
  verbose: false,
  resumePath: "",
  saveTranscriptPath: "",
});

export interface PgRun {
  id: string;
  startedAt: number;
  form: PgForm;
  command: string;
  stdout: string;
  stderr: string;
  result: RunResult | null;
  /** Error thrown by the backend (not a non-zero exit). */
  error: string | null;
  schemaUsed: boolean;
}

export type OutputMode = "rendered" | "raw";

interface PgStore {
  form: PgForm;
  current: PgRun | null;
  running: boolean;
  runId: string | null;
  history: PgRun[];
  outputMode: OutputMode;
  thumbs: Record<string, string | null>;
  setForm: (patch: Partial<PgForm>) => void;
  setOutputMode: (m: OutputMode) => void;
  setThumb: (path: string, dataUrl: string | null) => void;
  restore: (run: PgRun) => void;
  clearHistory: () => void;
  reset: () => void;
}

export const usePlayground = create<PgStore>((set) => ({
  form: emptyForm(),
  current: null,
  running: false,
  runId: null,
  history: [],
  outputMode: "rendered",
  thumbs: {},
  setForm: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),
  setOutputMode: (outputMode) => set({ outputMode }),
  setThumb: (path, dataUrl) => set((s) => ({ thumbs: { ...s.thumbs, [path]: dataUrl } })),
  restore: (run) => set({ form: structuredClone(run.form), current: run }),
  clearHistory: () => set({ history: [] }),
  reset: () => set({ form: emptyForm() }),
}));

const HISTORY_LIMIT = 10;

/** Deterministic temp path for pasted schema JSON (save_temp_text writes `<tmpDir>/<name>`). */
export function pastedSchemaName(text: string): string {
  return `schema-${hashText(text.trim())}.json`;
}

/**
 * Turns the form into RespondOptions. `schemaPath` is the path used for pasted
 * JSON (known before saving because the temp name is deterministic).
 */
export function toRespondOptions(f: PgForm, tmpDir: string | null): RespondOptions {
  const toolsOn = f.tools.length > 0;
  const anyLabel = toolsOn && f.images.some((i) => i.label.trim());
  let schema: string | undefined;
  if (f.schemaMode === "file" && f.schemaFile) schema = f.schemaFile;
  if (f.schemaMode === "paste" && f.schemaText.trim()) {
    schema = joinPath(tmpDir ?? "<tmp>", pastedSchemaName(f.schemaText));
  }
  return {
    prompt: f.prompt,
    instructions: f.instructions,
    textSegments: f.textSegments,
    // fm pairs --label with --image by order, not by position. When some images
    // have a label, give the others fm's default name so every label lands on
    // the right image. Labels are only sent when a CLI tool is on.
    images: f.images.map((img, i) => ({
      path: img.path,
      label: anyLabel ? img.label.trim() || `image_${i}` : undefined,
    })),
    tools: f.tools,
    schema,
    resumePath: f.resumePath || undefined,
    saveTranscriptPath: f.saveTranscriptPath || undefined,
    stream: f.stream,
    greedy: f.greedy,
    verbose: f.verbose,
    useCase: f.useCase,
    guardrails: f.guardrails,
  };
}

/** validateRespond plus the checks only the GUI knows about. */
export function formProblems(f: PgForm, tmpDir: string | null): string[] {
  const problems = validateRespond(toRespondOptions(f, tmpDir));
  if (f.schemaMode === "file" && !f.schemaFile) problems.push("Choose a schema file, or set Structured output to None.");
  if (f.schemaMode === "paste") {
    if (!f.schemaText.trim()) problems.push("Paste a JSON schema, or set Structured output to None.");
    else {
      const err = jsonError(f.schemaText);
      if (err) problems.push(`The pasted schema is not valid JSON: ${err}`);
    }
  }
  return problems;
}

export function previewCommand(f: PgForm, tmpDir: string | null, fmPath: string): string {
  return displayCommand(respondArgs(toRespondOptions(f, tmpDir)), fmPath);
}

/** Starts `fm respond`. Safe to call from anywhere; never throws. */
export async function startRun(tmpDir: string | null, fmPath: string): Promise<void> {
  const { running, form } = usePlayground.getState();
  if (running) return;
  if (formProblems(form, tmpDir).length) return;

  const snapshot = structuredClone(form);
  const runId = newId();
  const run: PgRun = {
    id: runId,
    startedAt: Date.now(),
    form: snapshot,
    command: previewCommand(snapshot, tmpDir, fmPath),
    stdout: "",
    stderr: "",
    result: null,
    error: null,
    schemaUsed: snapshot.schemaMode !== "none",
  };
  usePlayground.setState({ running: true, runId, current: run });

  const update = (patch: Partial<PgRun>) => {
    const cur = usePlayground.getState().current;
    if (cur?.id !== runId) return; // the user restored another run meanwhile
    usePlayground.setState({ current: { ...cur, ...patch } });
  };

  let final: PgRun = run;
  try {
    // Pasted schema: write it to the temp folder so fm can read it.
    let opts = toRespondOptions(snapshot, tmpDir);
    if (snapshot.schemaMode === "paste") {
      const path = await saveTempText(pastedSchemaName(snapshot.schemaText), snapshot.schemaText);
      opts = { ...opts, schema: path };
    }
    const args = respondArgs(opts);
    update({ command: displayCommand(args, fmPath) });

    let stdout = "";
    let stderr = "";
    const result = await fmRun(
      args,
      (e) => {
        if (e.kind === "stdout") {
          stdout += e.text;
          update({ stdout });
        } else if (e.kind === "stderr") {
          stderr += e.text;
          update({ stderr });
        } else if (e.kind === "started" && e.command) {
          update({ command: e.command });
        }
      },
      runId,
    );
    final = {
      ...run,
      command: result.command || displayCommand(args, fmPath),
      stdout: result.stdout || stdout,
      stderr: result.stderr || stderr,
      result,
    };
  } catch (err) {
    const cur = usePlayground.getState().current;
    final = { ...(cur?.id === runId ? cur : run), error: errorMessage(err) };
  }

  const s = usePlayground.getState();
  usePlayground.setState({
    running: false,
    runId: null,
    current: s.current?.id === runId ? final : s.current,
    history: [final, ...s.history.filter((h) => h.id !== runId)].slice(0, HISTORY_LIMIT),
  });
}

/** Stops the running `fm respond`. Returns an error message or null. */
export async function stopRun(): Promise<string | null> {
  const { runId } = usePlayground.getState();
  if (!runId) return null;
  try {
    await fmCancel(runId);
    return null;
  } catch (err) {
    return errorMessage(err);
  }
}
