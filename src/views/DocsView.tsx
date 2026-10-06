// Docs: the collected fm documentation from docs/*.md, bundled at build time.
// Links between docs ([x](06-tools.md)) switch the doc in the app.

import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../components/Markdown";
import { Button, Empty, IconButton, Page } from "../components/ui";
import { errorMessage } from "../lib/api";
import { cx } from "../lib/cx";
import { useApp, useHandoff } from "../lib/store";
import { DOCS, findDoc, slugify, snippetAround, type Doc } from "./docs/loadDocs";
import "./docs/docs.css";
import "./playground/workbench.css";

const APPLE_DOCS = "https://developer.apple.com/documentation/foundationmodels";

// Remember the open doc between page switches.
let lastDocName: string | null = null;

/** Scrolls the reader to a heading id like "#use-a-schema". */
function scrollToAnchor(root: HTMLElement | null, anchor: string) {
  const id = decodeURIComponent(anchor.replace(/^#/, ""));
  const el = root?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function DocsView() {
  const toast = useApp((s) => s.toast);
  const handoff = useHandoff();
  // Another page can ask for a doc ("Learn more" links); otherwise open the last one.
  const [current, setCurrent] = useState<string | null>(
    () => (handoff.docName && findDoc(handoff.docName)?.name) || lastDocName || DOCS[0]?.name || null,
  );
  const [query, setQuery] = useState("");
  /** A #heading to scroll to once the next doc has rendered. */
  const pendingAnchor = useRef<string | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);

  const doc = (current && findDoc(current)) || DOCS[0];
  const index = doc ? DOCS.indexOf(doc) : -1;

  const open = (name: string, anchor: string | null = null) => {
    const d = findDoc(name);
    if (!d) {
      toast(`There is no doc named ${name}.`, "error");
      return;
    }
    if (d.name === doc?.name && anchor) {
      scrollToAnchor(readerRef.current, anchor);
      return;
    }
    pendingAnchor.current = anchor;
    setCurrent(d.name);
    if (!anchor) readerRef.current?.scrollTo({ top: 0 });
  };

  // Give rendered headings ids so #anchors and the outline can scroll to them,
  // then jump to a pending anchor.
  useEffect(() => {
    lastDocName = doc?.name ?? null;
    const root = readerRef.current;
    if (!root) return;
    const seen = new Map<string, number>();
    root.querySelectorAll<HTMLElement>(".md h1, .md h2, .md h3, .md h4").forEach((el) => {
      const base = slugify(el.textContent ?? "");
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      el.id = n ? `${base}-${n}` : base;
    });
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (anchor) scrollToAnchor(root, anchor);
  }, [doc?.name]);

  // Links inside a doc: other docs open here, #anchors scroll, web links go to the browser
  // (handled by <Markdown>). Capture phase so nothing else navigates the web view.
  const onClickCapture = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) return;
    e.preventDefault();
    e.stopPropagation();
    if (/^mailto:/i.test(href)) {
      openUrl(href).catch((err) => toast(errorMessage(err), "error"));
      return;
    }
    if (href.startsWith("#")) {
      scrollToAnchor(readerRef.current, href);
      return;
    }
    const [file, hash] = href.split("#");
    if (/\.md$/i.test(file)) {
      open(file, hash ? `#${hash}` : null);
      return;
    }
    toast("This link points to a file outside the docs.", "info");
  };

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return DOCS.map((d) => ({ doc: d, snippet: null as string | null }));
    return DOCS.filter((d) => d.title.toLowerCase().includes(q) || d.lower.includes(q)).map((d) => ({
      doc: d,
      snippet: d.title.toLowerCase().includes(q) ? null : snippetAround(d, q),
    }));
  }, [q]);

  const appleButton = (
    <Button
      size="sm"
      icon={<ExternalLink size={12} />}
      onClick={() => openUrl(APPLE_DOCS).catch((err) => toast(errorMessage(err), "error"))}
    >
      Apple docs
    </Button>
  );

  if (DOCS.length === 0) {
    return (
      <Page title="Docs" subtitle="The collected fm documentation." actions={appleButton}>
        <Empty icon={<BookOpen size={30} />} title="No docs yet" action={appleButton}>
          The app shows the Markdown files from the docs folder of the project. They are added when the app is built.
          The docs folder is empty right now, so there is nothing to show. Apple's Foundation Models documentation is
          online.
        </Empty>
      </Page>
    );
  }

  return (
    <Page title="Docs" subtitle={doc ? doc.title : "The collected fm documentation."} flush actions={appleButton}>
      <div className="wb">
        <aside className="wb__side dc-side">
          <div className="dc-search">
            <Search size={13} />
            <input
              className="dc-search__input"
              value={query}
              placeholder="Search docs"
              aria-label="Search docs"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                if (e.key === "Enter" && results[0]) open(results[0].doc.name);
              }}
              spellCheck={false}
            />
            {query && (
              <IconButton label="Clear search" onClick={() => setQuery("")} style={{ width: 20, height: 20 }}>
                <X size={12} />
              </IconButton>
            )}
          </div>
          <div className="wb__side-scroll dc-list">
            {results.length === 0 && <div className="dc-none">No doc matches "{query.trim()}".</div>}
            {results.map(({ doc: d, snippet }) => {
              const active = d.name === doc?.name;
              return (
                <div key={d.name}>
                  <button
                    type="button"
                    className={cx("dc-item", active && "dc-item--active")}
                    onClick={() => open(d.name)}
                    title={d.name}
                  >
                    <span className="dc-item__title">{d.title}</span>
                    {snippet && <span className="dc-item__snippet">{snippet}</span>}
                  </button>
                  {active && !q && <Outline doc={d} onPick={(slug) => scrollToAnchor(readerRef.current, slug)} />}
                </div>
              );
            })}
          </div>
          <div className="wb__side-footer xsmall muted">
            {DOCS.length} docs{q ? `, ${results.length} found` : ""}
          </div>
        </aside>
        <section className="wb__main">
          <div className="wb__scroll dc-reader" ref={readerRef} onClickCapture={onClickCapture}>
            {doc && (
              <article className="dc-article">
                <Markdown key={doc.name} text={doc.content} />
                <nav className="dc-pager">
                  {index > 0 ? (
                    <button type="button" className="dc-pager__btn" onClick={() => open(DOCS[index - 1].name)}>
                      <ArrowLeft size={14} />
                      <span>
                        <span className="dc-pager__label">Previous</span>
                        <span className="dc-pager__title">{DOCS[index - 1].title}</span>
                      </span>
                    </button>
                  ) : (
                    <span />
                  )}
                  {index >= 0 && index < DOCS.length - 1 && (
                    <button
                      type="button"
                      className="dc-pager__btn dc-pager__btn--next"
                      onClick={() => open(DOCS[index + 1].name)}
                    >
                      <span>
                        <span className="dc-pager__label">Next</span>
                        <span className="dc-pager__title">{DOCS[index + 1].title}</span>
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  )}
                </nav>
              </article>
            )}
          </div>
        </section>
      </div>
    </Page>
  );
}

/** "On this page": the H2 headings of the open doc. */
function Outline(props: { doc: Doc; onPick: (slug: string) => void }) {
  const seen = new Map<string, number>();
  const items = props.doc.headings
    .map((h) => {
      const n = seen.get(h.slug) ?? 0;
      seen.set(h.slug, n + 1);
      return { ...h, id: n ? `${h.slug}-${n}` : h.slug };
    })
    .filter((h) => h.level === 2);
  if (items.length < 2) return null;
  return (
    <div className="dc-outline">
      {items.map((h) => (
        <button key={h.id} type="button" className="dc-outline__item" onClick={() => props.onPick(h.id)}>
          {h.text}
        </button>
      ))}
    </div>
  );
}
