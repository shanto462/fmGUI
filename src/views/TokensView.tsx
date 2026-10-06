// Token Counter: live `fm count-tokens` while you type. OWNER: agent "ui-build".

import { Gauge, Plus, Trash2 } from "lucide-react";
import { Callout, CommandPreview, Empty, IconButton, Meter, Page, Spinner, TextArea, cx, formatNumber } from "../components/ui";
import { errorMessage } from "../lib/api";
import { countTokensArgs, displayCommand } from "../lib/fmArgs";
import { useApp } from "../lib/store";
import { TranscriptPreview } from "./playground/TranscriptPreview";
import { FileField, InspectorSection, Toolbar, Workbench, pickFile } from "./playground/workbench";
import { isEmpty, toCountOptions, useTokenCount, useTokenInputs } from "./tokens/useTokenCount";
import "./tokens/tokens.css";

export default function TokensView() {
  const inputs = useTokenInputs((s) => s.inputs);
  const set = useTokenInputs((s) => s.set);
  const config = useApp((s) => s.config);
  const status = useApp((s) => s.status);
  const toast = useApp((s) => s.toast);
  const count = useTokenCount(inputs);

  const fmPath = config?.fmPath || "/usr/bin/fm";
  const contextSize = config?.contextSize || status?.contextSize || 4096;
  const command = displayCommand(countTokensArgs(toCountOptions(inputs)), fmPath);
  const empty = isEmpty(inputs);
  const stale = count.key !== JSON.stringify(inputs);

  const total = count.total ?? 0;
  const ratio = total / contextSize;
  const chars =
    inputs.prompt.trim().length +
    inputs.instructions.trim().length +
    inputs.textSegments.reduce((n, t) => n + t.trim().length, 0);
  const charsPerToken = !inputs.transcriptPath && total > 0 ? chars / total : null;
  const framed = !!inputs.instructions.trim() || !!inputs.transcriptPath;
  const segs = inputs.textSegments;

  return (
    <Page title="Token Counter" subtitle="Count tokens with fm count-tokens and see how much of the context is used." flush>
      <Workbench
        sideWidth={400}
        side={
          <>
            <InspectorSection title="Prompt">
              <TextArea
                rows={10}
                value={inputs.prompt}
                placeholder="Type or paste text to count…"
                onChange={(e) => set({ prompt: e.target.value })}
                style={{ minHeight: 160 }}
                spellCheck
              />
            </InspectorSection>
            <InspectorSection title="Instructions">
              <TextArea
                rows={3}
                value={inputs.instructions}
                placeholder="Optional. Counted as a framed request."
                onChange={(e) => set({ instructions: e.target.value })}
                spellCheck
              />
            </InspectorSection>
            <InspectorSection
              title="Text segments"
              defaultOpen={segs.length > 0}
              badge={segs.length ? <span className="badge">{segs.length}</span> : null}
              actions={
                <IconButton label="Add text segment" onClick={() => set({ textSegments: [...segs, ""] })}>
                  <Plus size={14} />
                </IconButton>
              }
            >
              {segs.length === 0 && <div className="xsmall muted">Extra text added with --text.</div>}
              {segs.map((s, i) => (
                <div key={i} className="wb-item">
                  <TextArea
                    rows={2}
                    value={s}
                    placeholder={`Text segment ${i + 1}`}
                    onChange={(e) => set({ textSegments: segs.map((x, j) => (j === i ? e.target.value : x)) })}
                    spellCheck
                  />
                  <IconButton label="Remove" onClick={() => set({ textSegments: segs.filter((_, j) => j !== i) })}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              ))}
            </InspectorSection>
            <InspectorSection title="Transcript" defaultOpen={!!inputs.transcriptPath}>
              <FileField
                path={inputs.transcriptPath}
                placeholder="No transcript"
                onClear={() => set({ transcriptPath: "" })}
                onChoose={() =>
                  pickFile({ title: "Choose a transcript", name: "Transcript", extensions: ["json"] })
                    .then((p) => p && set({ transcriptPath: p }))
                    .catch((err) => toast(errorMessage(err), "error"))
                }
              />
              {inputs.transcriptPath && <TranscriptPreview path={inputs.transcriptPath} maxMessages={2} />}
              <div className="xsmall muted">Counts a saved conversation, for example one from fm chat or the Playground.</div>
            </InspectorSection>
            <InspectorSection title="Images" defaultOpen={false}>
              <div className="xsmall muted">
                Images are not offered here. On macOS 27.0.1, <span className="mono">fm count-tokens --image</span> fails with
                ModelManagerError 1001.
              </div>
            </InspectorSection>
          </>
        }
      >
        <Toolbar>
          <span className="small muted">Live count</span>
          {(count.pending || (stale && !empty)) && <Spinner />}
          <div className="spacer" />
          <span className="xsmall muted">Context window: {formatNumber(contextSize)} tokens</span>
        </Toolbar>
        <div className="wb__band">
          <CommandPreview command={command} />
        </div>
        <div className="wb__scroll">
          {empty ? (
            <Empty icon={<Gauge size={30} />} title="Type to count">
              Type a prompt, add instructions or pick a transcript. The count updates as you type.
            </Empty>
          ) : (
            <div className="tk-main">
              {count.error ? (
                <Callout tone="error">
                  <strong>Could not count tokens.</strong> {count.error}
                </Callout>
              ) : (
                <div className={cx("tk-hero", stale && "tk-hero--stale")}>
                  <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
                    <span className="wb-big">{count.total == null ? "…" : formatNumber(total)}</span>
                    <span className="tk-unit">tokens</span>
                  </div>
                  <Meter value={ratio} title={`${(ratio * 100).toFixed(1)}% of ${formatNumber(contextSize)}`} />
                  <div className="tk-hero__meta">
                    <span>
                      {(ratio * 100).toFixed(1)}% of the {formatNumber(contextSize)} token context window
                    </span>
                    <span>
                      {total <= contextSize
                        ? `${formatNumber(contextSize - total)} tokens left for the reply`
                        : `${formatNumber(total - contextSize)} tokens over the limit`}
                    </span>
                  </div>
                </div>
              )}

              {total > contextSize && (
                <Callout tone="error">
                  This is larger than the context window. fm will fail with "The session's transcript exceeded the model's
                  context size."
                </Callout>
              )}

              <div className="tk-stats">
                <div className="tk-stat">
                  <div className="tk-stat__label">Characters</div>
                  <div className="tk-stat__value">{formatNumber(chars)}</div>
                  <div className="tk-stat__hint">{inputs.transcriptPath ? "Typed text only" : "Prompt, instructions, text"}</div>
                </div>
                <div className="tk-stat">
                  <div className="tk-stat__label">Characters per token</div>
                  <div className="tk-stat__value">{charsPerToken == null ? "n/a" : charsPerToken.toFixed(2)}</div>
                  <div className="tk-stat__hint">
                    {inputs.transcriptPath ? "Not shown with a transcript" : "English is often about 3 to 4"}
                  </div>
                </div>
                <div className="tk-stat">
                  <div className="tk-stat__label">Counted as</div>
                  <div className="tk-stat__value tk-stat__value--text">{framed ? "Framed request" : "Raw content"}</div>
                  <div className="tk-stat__hint">{framed ? "Includes chat template markers" : "Just the text tokens"}</div>
                </div>
              </div>

              {count.parts.length > 0 && (
                <div className="tk-card">
                  <div className="section__title">Each part counted alone</div>
                  <table className="wb-table">
                    <tbody>
                      {count.parts.map((p) => (
                        <tr key={p.label}>
                          <td>
                            {p.label}
                            <div className="xsmall muted">{p.hint}</div>
                          </td>
                          <td className="wb-num">
                            {p.count != null ? formatNumber(p.count) : <span className="field__error" title={p.error ?? ""}>error</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="xsmall muted" style={{ marginTop: 6 }}>
                    The parts do not add up to the total. Each framed part pays for its own template markers.
                  </div>
                </div>
              )}

              <Callout>
                <div className="stack" style={{ gap: 6 }}>
                  <div>
                    <strong>Why the number jumps.</strong> A bare prompt counts only its raw content. When you add
                    instructions or a transcript, fm counts the full framed request, including the chat template markers
                    around each turn. So one short instruction can add about 50 tokens.
                  </div>
                  <div>
                    The context window holds the instructions, the whole conversation and the reply together. Keep room for
                    the reply.
                  </div>
                </div>
              </Callout>
            </div>
          )}
        </div>
      </Workbench>
    </Page>
  );
}
