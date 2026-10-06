// Options popover for continuing a CLI session: OCR/Barcode tools, greedy
// sampling and use case.

import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Chip, Select, Toggle } from "../../components/ui";
import { cx } from "../../lib/cx";
import type { BuiltinCliTool, UseCase } from "../../lib/fmArgs";
import { countChanged, type CliRunOptions } from "./options";

function OptionsFields(props: { value: CliRunOptions; onChange: (v: CliRunOptions) => void }) {
  const o = props.value;
  const toggleTool = (t: BuiltinCliTool) =>
    props.onChange({ ...o, tools: o.tools.includes(t) ? o.tools.filter((x) => x !== t) : [...o.tools, t] });
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="field">
        <span className="field__label">CLI tools</span>
        <div className="row">
          <Chip on={o.tools.includes("ocr")} onClick={() => toggleTool("ocr")} title="--tool ocr">
            OCR
          </Chip>
          <Chip on={o.tools.includes("barcode")} onClick={() => toggleTool("barcode")} title="--tool barcode">
            Barcode
          </Chip>
        </div>
        <span className="field__hint">Let the model read text or barcodes in attached images.</span>
      </div>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div className="field__label">Greedy</div>
          <div className="field__hint">Always pick the most likely word, so the same input gives the same answer.</div>
        </div>
        <Toggle checked={o.greedy} onChange={(greedy) => props.onChange({ ...o, greedy })} label="Greedy" />
      </div>
      <div className="field">
        <span className="field__label">Use case</span>
        <Select<UseCase>
          value={o.useCase}
          onChange={(useCase) => props.onChange({ ...o, useCase })}
          options={[
            { value: "general", label: "General" },
            { value: "content-tagging", label: "Content tagging" },
          ]}
        />
      </div>
    </div>
  );
}

export function RunOptionsButton(props: {
  value: CliRunOptions;
  onChange: (v: CliRunOptions) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const changed = countChanged(props.value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="sv-options" ref={ref}>
      <button
        type="button"
        className={cx("cv-chip sv-options__btn", changed > 0 && "sv-options__btn--on")}
        disabled={props.disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Options for the fm command"
      >
        <SlidersHorizontal size={13} />
        Options
        {changed > 0 && <span className="sv-options__count">{changed}</span>}
      </button>
      {open && (
        <div className="sv-popover" role="dialog" aria-label="Options">
          <OptionsFields value={props.value} onChange={props.onChange} />
        </div>
      )}
    </div>
  );
}
