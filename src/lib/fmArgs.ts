// CONTRACT FILE (owned by the lead). Builds `fm` argument lists from UI state.
// Every flag here was tested against /usr/bin/fm on macOS 27.0.1.

export type UseCase = "general" | "content-tagging";
export type Guardrails = "default" | "permissive-content-transformations";
export type BuiltinCliTool = "ocr" | "barcode";

export interface ImageInput {
  path: string;
  /** Only valid when a CLI tool (ocr/barcode) is enabled. */
  label?: string;
}

export interface RespondOptions {
  prompt: string;
  instructions?: string;
  textSegments?: string[];
  images?: ImageInput[];
  tools?: BuiltinCliTool[];
  /** Path to a schema file, or inline JSON. */
  schema?: string;
  resumePath?: string;
  saveTranscriptPath?: string;
  stream?: boolean; // default true
  greedy?: boolean;
  verbose?: boolean;
  useCase?: UseCase;
  guardrails?: Guardrails;
}

/** Returns a list of problems that `fm` would reject. Empty = OK. */
export function validateRespond(o: RespondOptions): string[] {
  const problems: string[] = [];
  const hasPrompt = o.prompt.trim().length > 0;
  const hasText = (o.textSegments ?? []).some((t) => t.trim());
  const hasImage = (o.images ?? []).length > 0;
  if (!hasPrompt && !hasText && !hasImage) {
    problems.push("Add a prompt, a text segment, or an image.");
  }
  if (o.resumePath && o.instructions?.trim()) {
    problems.push("A resumed transcript already has its instructions. Clear the instructions or the resume file.");
  }
  if ((o.images ?? []).some((i) => i.label?.trim()) && !(o.tools ?? []).length) {
    problems.push("Image labels need the OCR or Barcode tool.");
  }
  return problems;
}

export function respondArgs(o: RespondOptions): string[] {
  const args = ["respond"];
  if (o.instructions?.trim()) args.push("-i", o.instructions);
  if (o.schema?.trim()) args.push("--schema", o.schema);
  for (const t of o.textSegments ?? []) if (t.trim()) args.push("--text", t);
  // fm pairs the Nth --label with the Nth --image (not with the image just
  // before it). So once any image has a label, every image gets one, with
  // fm's own default name (image_<index>) for the empty ones.
  const images = o.images ?? [];
  const useLabels = (o.tools ?? []).length > 0 && images.some((i) => i.label?.trim());
  images.forEach((img, i) => {
    args.push("--image", img.path);
    if (useLabels) args.push("--label", img.label?.trim() || `image_${i}`);
  });
  for (const tool of o.tools ?? []) args.push("--tool", tool);
  if (o.resumePath) args.push("--resume", o.resumePath);
  if (o.saveTranscriptPath) args.push("--save-transcript", o.saveTranscriptPath);
  if (o.stream === false) args.push("--no-stream");
  if (o.greedy) args.push("--greedy");
  if (o.verbose) args.push("--verbose");
  if (o.useCase && o.useCase !== "general") args.push("--use-case", o.useCase);
  if (o.guardrails && o.guardrails !== "default") args.push("--guardrails", o.guardrails);
  // `--` so a prompt that starts with "-" is not read as a flag.
  if (o.prompt.trim()) args.push("--", o.prompt);
  return args;
}

export interface CountTokensOptions {
  prompt?: string;
  instructions?: string;
  textSegments?: string[];
  images?: string[];
  transcriptPath?: string;
}

export function countTokensArgs(o: CountTokensOptions): string[] {
  const args = ["count-tokens", "--quiet"];
  if (o.instructions?.trim()) args.push("-i", o.instructions);
  for (const t of o.textSegments ?? []) if (t.trim()) args.push("--text", t);
  for (const img of o.images ?? []) args.push("--image", img);
  if (o.transcriptPath) args.push("--transcript", o.transcriptPath);
  if (o.prompt?.trim()) args.push("--", o.prompt);
  return args;
}

export type SchemaPropertyType = "string" | "integer" | "double" | "boolean";

export interface SchemaProperty {
  id: string;
  /** Dot notation creates nested objects: "address.street". */
  name: string;
  type: SchemaPropertyType;
  isArray: boolean;
  isOptional: boolean;
  description: string;
}

export interface SchemaDefinition {
  rootName: string;
  properties: SchemaProperty[];
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export function validateSchema(def: SchemaDefinition): string[] {
  const problems: string[] = [];
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(def.rootName.trim())) {
    problems.push("Type name must be one word, like Person.");
  }
  if (def.properties.length === 0) problems.push("Add at least one property.");
  const names = def.properties.map((p) => p.name.trim());
  const seen = new Set<string>();
  for (const name of names) {
    if (!NAME_RE.test(name)) problems.push(`"${name || "(empty)"}" is not a valid property name.`);
    else if (seen.has(name)) problems.push(`"${name}" is used twice.`);
    seen.add(name);
  }
  // "address" cannot be both a value and the parent of "address.street".
  for (const name of seen) {
    if (names.some((other) => other.startsWith(`${name}.`))) {
      problems.push(`"${name}" is used as a value and as an object (${name}.…). Rename one of them.`);
    }
  }
  return problems;
}

export function schemaObjectArgs(def: SchemaDefinition): string[] {
  const args = ["schema", "object", "--name", def.rootName.trim()];
  for (const p of def.properties) {
    args.push(`--${p.type}`, p.name.trim());
    if (p.description.trim()) args.push("--description", p.description.trim());
    if (p.isOptional) args.push("--optional");
    if (p.isArray) args.push("--array");
  }
  return args;
}

export interface ServeOptions {
  mode: "tcp" | "socket";
  host?: string;
  port?: number;
  socketPath?: string;
}

export function serveArgs(o: ServeOptions): string[] {
  if (o.mode === "socket") return ["serve", "--socket", o.socketPath ?? ""];
  const args = ["serve"];
  if (o.host) args.push("--host", o.host);
  if (o.port) args.push("--port", String(o.port));
  return args;
}

const SAFE = /^[A-Za-z0-9\-_./=:,+@%]+$/;

/** POSIX shell quoting, same rules as the Rust `display_command`. */
export function shellQuote(arg: string): string {
  if (arg === "") return "''";
  // A leading "=" is expanded by zsh (=cmd → path of cmd), so quote it.
  if (SAFE.test(arg) && !arg.startsWith("=")) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function displayCommand(args: string[], fmPath = "/usr/bin/fm"): string {
  const exe = fmPath === "/usr/bin/fm" ? "fm" : fmPath;
  return [exe, ...args].map(shellQuote).join(" ");
}
