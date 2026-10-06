// Live token counting with `fm count-tokens --quiet` (about 40 ms per call).
// OWNER: agent "ui-build".

import { create } from "zustand";
import { useEffect, useRef, useState } from "react";
import { errorMessage, fmCancel, fmRun, newId } from "../../lib/api";
import { countTokensArgs, type CountTokensOptions } from "../../lib/fmArgs";
import { stripAnsi, useDebouncedValue } from "../playground/workbench";

export interface TokenInputs {
  prompt: string;
  instructions: string;
  textSegments: string[];
  transcriptPath: string;
}

interface TokenStore {
  inputs: TokenInputs;
  set: (patch: Partial<TokenInputs>) => void;
}

/** Inputs live outside the component so they survive page switches. */
export const useTokenInputs = create<TokenStore>((set) => ({
  inputs: { prompt: "", instructions: "", textSegments: [], transcriptPath: "" },
  set: (patch) => set((s) => ({ inputs: { ...s.inputs, ...patch } })),
}));

export interface TokenPart {
  label: string;
  hint: string;
  count: number | null;
  error: string | null;
}

export interface TokenCount {
  total: number | null;
  error: string | null;
  parts: TokenPart[];
  pending: boolean;
  /** Inputs the numbers belong to (JSON key), to tell when they are stale. */
  key: string | null;
}

export const toCountOptions = (i: TokenInputs): CountTokensOptions => ({
  prompt: i.prompt,
  instructions: i.instructions,
  textSegments: i.textSegments,
  transcriptPath: i.transcriptPath || undefined,
});

export function isEmpty(i: TokenInputs): boolean {
  return !i.prompt.trim() && !i.instructions.trim() && !i.textSegments.some((t) => t.trim()) && !i.transcriptPath;
}

const TIMEOUT_MS = 20000;

/** One `fm count-tokens` call. Stops fm and fails when it takes too long. */
async function countOnce(opts: CountTokensOptions, runId: string): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      fmCancel(runId).catch(() => {});
      reject(new Error("fm count-tokens did not answer within 20 seconds. The model service may be busy. Edit the text to try again."));
    }, TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([fmRun(countTokensArgs(opts), () => {}, runId), timeout]);
    if (res.cancelled) throw new Error("Stopped.");
    if (res.exitCode !== 0) {
      throw new Error(res.error || stripAnsi(res.stderr).trim() || `fm exited with code ${res.exitCode}.`);
    }
    const n = Number.parseInt(res.stdout.trim().replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(n)) throw new Error(`Unexpected output from fm: ${res.stdout.trim() || "(empty)"}`);
    return n;
  } finally {
    clearTimeout(timer);
  }
}

export function useTokenCount(inputs: TokenInputs): TokenCount {
  const key = JSON.stringify(inputs);
  const debounced = useDebouncedValue(key, 200);
  const seq = useRef(0);
  // Run ids still going. A new count stops them so fm processes never pile up.
  const inflight = useRef(new Set<string>());
  const stopAll = () => {
    for (const id of inflight.current) fmCancel(id).catch(() => {});
    inflight.current.clear();
  };
  const [state, setState] = useState<TokenCount>({ total: null, error: null, parts: [], pending: false, key: null });

  useEffect(() => {
    const i = JSON.parse(debounced) as TokenInputs;
    const mine = ++seq.current;
    stopAll();
    if (isEmpty(i)) {
      setState({ total: 0, error: null, parts: [], pending: false, key: debounced });
      return;
    }
    setState((s) => ({ ...s, pending: true }));

    const hasContent = !!i.prompt.trim() || i.textSegments.some((t) => t.trim());
    const hasInstr = !!i.instructions.trim();
    const hasTranscript = !!i.transcriptPath;
    const partJobs: { label: string; hint: string; opts: CountTokensOptions }[] = [];
    // A breakdown only helps when more than one part is present.
    if ([hasContent, hasInstr, hasTranscript].filter(Boolean).length > 1) {
      if (hasContent) {
        partJobs.push({
          label: "Prompt and text segments",
          hint: "Raw content, no framing",
          opts: { prompt: i.prompt, textSegments: i.textSegments },
        });
      }
      if (hasInstr) partJobs.push({ label: "Instructions", hint: "Framed request", opts: { instructions: i.instructions } });
      if (hasTranscript) {
        partJobs.push({ label: "Transcript", hint: "Framed conversation", opts: { transcriptPath: i.transcriptPath } });
      }
    }

    const run = (opts: CountTokensOptions) => {
      const runId = newId();
      inflight.current.add(runId);
      return countOnce(opts, runId).finally(() => inflight.current.delete(runId));
    };

    // Total first (shown right away), then the parts one by one, so only one
    // fm process runs at a time.
    (async () => {
      let total: number | null = null;
      let error: string | null = null;
      try {
        total = await run(toCountOptions(i));
      } catch (err) {
        error = errorMessage(err);
      }
      if (mine !== seq.current) return;
      setState({ total, error, parts: [], pending: partJobs.length > 0 && !error, key: debounced });
      if (error || partJobs.length === 0) return;

      const parts: TokenPart[] = [];
      for (const j of partJobs) {
        let count: number | null = null;
        let partError: string | null = null;
        try {
          count = await run(j.opts);
        } catch (err) {
          partError = errorMessage(err);
        }
        if (mine !== seq.current) return;
        parts.push({ label: j.label, hint: j.hint, count, error: partError });
      }
      setState({ total, error, parts, pending: false, key: debounced });
    })();
  }, [debounced]);

  // Stop running counts when the page closes.
  useEffect(() => stopAll, []);

  return state;
}
