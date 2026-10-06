// "Try it": runs `fm respond --no-stream --schema <tmpfile>` with the generated
// schema and shows the JSON reply.

import { Play, Square } from "lucide-react";
import { useState } from "react";
import { Button, Callout, CodeBlock, CommandPreview, Field, TextArea } from "../../components/ui";
import { errorMessage, fmCancel, fmRun, newId, saveTempText } from "../../lib/api";
import { DEFAULT_FM_PATH, displayCommand, respondArgs } from "../../lib/fmArgs";
import { formatDuration, hashText, stripAnsi, tryPrettyJson } from "../../lib/format";
import { useTicker } from "../../lib/hooks";
import { joinPath } from "../../lib/paths";
import { useApp } from "../../lib/store";
import type { RunResult } from "../../lib/types";
import { useSchemaBuilder } from "./store";

export function TryIt(props: { json: string | null; rootName: string }) {
  const prompt = useSchemaBuilder((s) => s.tryPrompt);
  const setPrompt = useSchemaBuilder((s) => s.setTryPrompt);
  const paths = useApp((s) => s.paths);
  const config = useApp((s) => s.config);
  const fmPath = config?.fmPath || DEFAULT_FM_PATH;

  const [runId, setRunId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useTicker(!!runId, 100);

  const fileName = props.json ? `schema-try-${props.rootName || "Schema"}-${hashText(props.json)}.json` : "schema.json";
  const tmpPath = joinPath(paths?.tmpDir ?? "<tmp>", fileName);
  const args = (schemaPath: string) => respondArgs({ prompt, schema: schemaPath, stream: false });
  const command = displayCommand(args(tmpPath), fmPath);
  const canRun = !!props.json && !!prompt.trim() && !runId;

  const run = async () => {
    if (!props.json || !prompt.trim() || runId) return;
    const id = newId();
    setRunId(id);
    setStartedAt(Date.now());
    setResult(null);
    setError(null);
    try {
      const path = await saveTempText(fileName, props.json);
      const res = await fmRun(args(path), () => {}, id);
      setResult(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunId(null);
    }
  };

  const stop = () => {
    if (runId) fmCancel(runId).catch((err) => setError(errorMessage(err)));
  };

  const pretty = result ? tryPrettyJson(result.stdout) : null;
  const failed = result && !result.cancelled && result.exitCode !== 0;

  return (
    <div className="sb-try">
      <div className="row">
        <h3 className="section__title" style={{ margin: 0 }}>
          Try it
        </h3>
        <span className="xsmall muted">Ask the model to fill this schema.</span>
      </div>
      <Field>
        <TextArea
          rows={3}
          value={prompt}
          placeholder="Text for the model to turn into JSON…"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              run();
            }
          }}
          spellCheck
        />
      </Field>
      <div className="row">
        {runId ? (
          <Button variant="danger" icon={<Square size={11} fill="currentColor" />} onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" icon={<Play size={12} fill="currentColor" />} onClick={run} disabled={!canRun}>
            Run
          </Button>
        )}
        {runId ? (
          <span className="wb-running">
            <span className="spinner" /> Generating · {formatDuration(Math.max(0, now - startedAt))}
          </span>
        ) : (
          <span className="wb-kbd-hint">⌘↩ in the text box</span>
        )}
        <div className="spacer" />
        {result && !runId && (
          <span className="xsmall muted">
            exit {result.exitCode} · {formatDuration(result.durationMs)}
          </span>
        )}
      </div>
      <CommandPreview command={command} />
      {!props.json && (
        <div className="xsmall muted">Fix the schema first. The command runs once the JSON is ready.</div>
      )}
      {error && <Callout tone="error">{error}</Callout>}
      {failed && (
        <Callout tone="error">
          <strong>fm exited with code {result.exitCode}.</strong>{" "}
          {result.error ?? (stripAnsi(result.stderr).trim() || "No error message.")}
        </Callout>
      )}
      {result?.cancelled && <Callout>Stopped.</Callout>}
      {result && !failed && !result.cancelled && (
        <CodeBlock code={pretty ?? (result.stdout.trim() || "(No output)")} wrap maxHeight={360} />
      )}
    </div>
  );
}
