// Safe Markdown rendering (marked + DOMPurify).
// Links open in the default browser; code blocks get a copy button on hover.

import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";
import { errorMessage } from "../lib/api";
import { useApp } from "../lib/store";

marked.setOptions({ gfm: true, breaks: false });

function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

export function Markdown(props: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(props.text), [props.text]);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Copy buttons on code blocks.
    root.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".md-copy")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon-btn md-copy";
      btn.title = "Copy";
      btn.setAttribute("aria-label", "Copy code");
      btn.textContent = "⧉";
      btn.style.cssText = "position:absolute;top:4px;right:4px;width:24px;height:24px;font-size:13px";
      btn.onclick = () => {
        navigator.clipboard
          .writeText(pre.querySelector("code")?.textContent ?? pre.textContent ?? "")
          .then(() => {
            btn.textContent = "✓";
            setTimeout(() => (btn.textContent = "⧉"), 1200);
          })
          .catch((err) => toast(`Could not copy. ${errorMessage(err)}`, "error"));
      };
      pre.appendChild(btn);
    });
  }, [html, toast]);

  return (
    <div
      ref={ref}
      className={`md ${props.className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        // Never let a link navigate the app window itself. Web links open in the
        // default browser. Relative links (e.g. "06-tools.md") are handled by the
        // page around this component (the Docs viewer listens in the capture phase).
        const a = (e.target as HTMLElement).closest("a");
        const href = a?.getAttribute("href");
        if (!a || !href || href.startsWith("#")) return;
        e.preventDefault();
        if (/^(https?|mailto):/i.test(href)) openUrl(href).catch((err) => toast(errorMessage(err), "error"));
      }}
    />
  );
}
