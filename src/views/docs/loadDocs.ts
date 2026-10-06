// Docs are bundled at build time from the repo's docs/ folder.

export interface DocHeading {
  level: number;
  text: string;
  slug: string;
}

export interface Doc {
  /** File name, like "06-tools.md". */
  name: string;
  title: string;
  content: string;
  lower: string;
  headings: DocHeading[];
}

const RAW = import.meta.glob("/docs/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** GitHub-style heading slug: "Use a schema!" → "use-a-schema". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function headingsOf(content: string): DocHeading[] {
  const out: DocHeading[] = [];
  let inFence = false;
  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const text = m[2].replace(/[`*_]/g, "");
      out.push({ level: m[1].length, text, slug: slugify(text) });
    }
  }
  return out;
}

function titleOf(name: string, headings: DocHeading[]): string {
  const h1 = headings.find((h) => h.level === 1);
  if (h1) return h1.text;
  return name
    .replace(/\.md$/i, "")
    .replace(/^\d+[-_ ]*/, "")
    .replace(/[-_]+/g, " ");
}

export const DOCS: Doc[] = Object.entries(RAW)
  .map(([path, content]) => {
    const name = path.split("/").pop() ?? path;
    const text = typeof content === "string" ? content : "";
    const headings = headingsOf(text);
    return { name, title: titleOf(name, headings), content: text, lower: text.toLowerCase(), headings };
  })
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

export function findDoc(name: string): Doc | undefined {
  const base = name.split("/").pop()?.toLowerCase() ?? "";
  return DOCS.find((d) => d.name.toLowerCase() === base);
}

/** A short piece of text around the first match, for search results. */
export function snippetAround(doc: Doc, query: string, size = 90): string | null {
  const i = doc.lower.indexOf(query);
  if (i < 0) return null;
  const start = Math.max(0, i - 30);
  const raw = doc.content
    .slice(start, start + size)
    .replace(/[#*`>_|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${raw}…`;
}
