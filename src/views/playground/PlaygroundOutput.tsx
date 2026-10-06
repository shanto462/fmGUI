// Right pane of the Playground: command preview, Run / Stop, streamed output,
// stderr, stats and the run history menu.

import { ChevronRight, Clock, Play, Square, TerminalSquare, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import {
  Badge,
  Button,
  Callout,
  CommandPreview,
  CopyButton,
  Empty,
  IconButton,
  Segmented,
  Spinner,
} from "../../components/ui";
import { cx } from "../../lib/cx";
import { DEFAULT_FM_PATH } from "../../lib/fmArgs";
import { formatDuration, formatNumber, formatTime, stripAnsi, truncateText, tryPrettyJson } from "../../lib/format";
import { useTicker } from "../../lib/hooks";
import { tildeText } from "../../lib/paths";
import { useApp } from "../../lib/store";
import { formProblems, previewCommand, startRun, stopRun, usePlayground, type OutputMode, type PgRun } from "./store";
import { Stat, Toolbar } from "./workbench";

export function PlaygroundOutput() {
  const form = usePlayground((s) => s.form);
  const current = usePlayground((s) => s.current);
  const running = usePlayground((s) => s.running);
  const outputMode = usePlayground((s) => s.outputMode);
  const setOutputMode = usePlayground((s) => s.setOutputMode);
  const config = useApp((s) => s.config);
  const paths = useApp((s) => s.paths);
  const home = paths?.homeDir;
  const toast = useApp((s) => s.toast);
  const navigate = useApp((s) => s.navigate);

  const tmpDir = paths?.tmpDir ?? null;
  const fmPath = config?.fmPath || DEFAULT_FM_PATH;
  const command = previewCommand(form, tmpDir, fmPath);
  const problems = formProblems(form, tmpDir);
  const now = useTicker(running, 100);

  const stdout = current?.stdout ?? "";
  const pretty = current?.schemaUsed ? tryPrettyJson(stdout) : null;
  const shownText = outputMode === "rendered" && pretty ? pretty : stdout;

  const run = () => startRun(tmpDir, fmPath);
  const stop = async () => {
    const err = await stopRun();
    if (err) toast(err, "error");
  };

  // Keep the output scrolled to the end while it streams, unless the user scrolled up.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current && running) el.scrollTop = el.scrollHeight;
  }, [stdout, running]);
  useEffect(() => {
    stick.current = true;
  }, [current?.id]);

  return (
    <>
      <Toolbar>
        {running ? (
          <Button variant="danger" icon={<Square size={12} fill="currentColor" />} onClick={stop} title="Stop (⌘.)">
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={<Play size={13} fill="currentColor" />}
            onClick={run}
            disabled={problems.length > 0}
            title="Run (⌘↩)"
          >
            Run
          </Button>
        )}
        <span className="wb-kbd-hint">{running ? "⌘." : "⌘↩"}</span>
        {running && current && (
          <span className="wb-running">
            <Spinner />
            {current.stdout ? "Generating" : "Waiting for the model"} ·{" "}
            {formatDuration(Math.max(0, now - current.startedAt))}
          </span>
        )}
        <div className="spacer" />
        {current && (
          <Segmented<OutputMode>
            value={outputMode}
            onChange={setOutputMode}
            options={[
              { value: "rendered", label: current.schemaUsed ? "JSON" : "Markdown" },
              { value: "raw", label: "Raw" },
            ]}
          />
        )}
        <HistoryMenu />
        {current && <CopyButton text={shownText} label="Copy output" />}
      </Toolbar>

      <div className="wb__band">
        <CommandPreview command={command} />
        {problems.length > 0 && (
          <Callout tone="warning">
            {problems.length === 1 ? (
              problems[0]
            ) : (
              <ul className="wb-problems">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </Callout>
        )}
      </div>

      <div
        className="wb__scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!current ? (
          <Empty icon={<TerminalSquare size={30} />} title="Run a prompt">
            Fill in the options on the left, then press Run or ⌘↩. The reply streams here, and the exact fm command is
            shown above.
          </Empty>
        ) : (
          <RunOutput
            run={current}
            running={running}
            mode={outputMode}
            pretty={pretty}
            onSetup={() => navigate("setup")}
          />
        )}
      </div>

      {current && current.stderr.trim() && (
        <details key={current.id} className="wb-stderr" open={!!current.result && current.result.exitCode !== 0}>
          <summary>
            <ChevronRight size={12} />
            stderr · {current.stderr.trim().split("\n").length} lines
          </summary>
          <pre>{tildeText(stripAnsi(current.stderr).trim(), home)}</pre>
        </details>
      )}

      {current && <RunStats run={current} />}
    </>
  );
}

function RunOutput(props: {
  run: PgRun;
  running: boolean;
  mode: OutputMode;
  pretty: string | null;
  onSetup: () => void;
}) {
  const { run, running, mode, pretty } = props;
  const home = useApp((s) => s.paths?.homeDir);
  const res = run.result;
  const failed = res && !res.cancelled && res.exitCode !== 0;
  const caret = running ? <span className="wb-caret" /> : null;

  return (
    <>
      {run.error && (
        <div className="wb__pad">
          <Callout tone="error">
            <strong>Could not run fm.</strong> {tildeText(run.error, home)}
          </Callout>
        </div>
      )}
      {failed && (
        <div className="wb__pad">
          <Callout tone="error">
            <div className="stack" style={{ gap: 6 }}>
              <div>
                <strong>fm exited with code {res.exitCode}.</strong> {tildeText(res.error ?? "", home)}
              </div>
              {res.exitCode === 69 && (
                <div>
                  <Button size="sm" onClick={props.onSetup}>
                    Open the Setup Guide
                  </Button>
                </div>
              )}
            </div>
          </Callout>
        </div>
      )}
      {res?.cancelled && (
        <div className="wb__pad">
          <Callout>Stopped. The output below is what fm wrote before it was stopped.</Callout>
        </div>
      )}

      {!run.stdout && running ? (
        <div className="wb-output muted">
          {run.form.stream
            ? "Waiting for the first token…"
            : "Streaming is off. The reply appears when it is complete."}
          {caret}
        </div>
      ) : !run.stdout ? (
        !run.error && !failed && <div className="wb-output muted">(No output)</div>
      ) : mode === "raw" ? (
        <pre className="wb-output">
          {run.stdout}
          {caret}
        </pre>
      ) : pretty ? (
        <pre className="pg-json">{pretty}</pre>
      ) : run.schemaUsed ? (
        <pre className="wb-output">
          {run.stdout}
          {caret}
        </pre>
      ) : (
        <div className="wb-output-md">
          <Markdown text={run.stdout} />
          {caret}
        </div>
      )}
    </>
  );
}

function RunStats(props: { run: PgRun }) {
  const res = props.run.result;
  if (!res) {
    return (
      <div className="wb-stats">
        <Stat label="Characters" value={formatNumber(props.run.stdout.length)} />
      </div>
    );
  }
  const tone = res.cancelled ? "orange" : res.exitCode === 0 ? "green" : "red";
  return (
    <div className="wb-stats">
      <Stat label="Exit code" value={res.cancelled ? `${res.exitCode} (stopped)` : res.exitCode} tone={tone} />
      <Stat label="Duration" value={formatDuration(res.durationMs)} />
      <Stat
        label="First output"
        value={res.firstOutputMs != null ? formatDuration(res.firstOutputMs) : "n/a"}
        title="Time until fm wrote the first byte of the reply"
      />
      <Stat label="Characters" value={formatNumber(res.stdout.length || props.run.stdout.length)} />
      <div className="spacer" />
      <span>{formatTime(props.run.startedAt)}</span>
    </div>
  );
}

function runTitle(run: PgRun): string {
  const f = run.form;
  const text = f.prompt.trim() || f.textSegments.find((t) => t.trim()) || "";
  if (text) return truncateText(text, 60);
  if (f.images.length) return `${f.images.length} image(s)`;
  return "(empty prompt)";
}

function HistoryMenu() {
  const history = usePlayground((s) => s.history);
  const current = usePlayground((s) => s.current);
  const restore = usePlayground((s) => s.restore);
  const clear = usePlayground((s) => s.clearHistory);
  const running = usePlayground((s) => s.running);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ display: "contents" }}>
      <IconButton label={`History (${history.length})`} onClick={() => setOpen(!open)} className={cx(open && "pg-on")}>
        <Clock size={15} />
      </IconButton>
      {open && (
        <div className="wb-popover" role="menu">
          <div className="pg-history-title">
            Last {history.length || ""} runs
            <div className="spacer" />
            {history.length > 0 && (
              <IconButton label="Clear history" onClick={clear} style={{ width: 22, height: 22 }}>
                <Trash2 size={13} />
              </IconButton>
            )}
          </div>
          {history.length === 0 && (
            <div className="xsmall muted" style={{ padding: "4px 9px 8px" }}>
              No runs yet. The last 10 runs stay here until you quit the app.
            </div>
          )}
          {history.map((h) => {
            const res = h.result;
            const tone = h.error
              ? "red"
              : !res
                ? undefined
                : res.cancelled
                  ? "orange"
                  : res.exitCode === 0
                    ? "green"
                    : "red";
            return (
              <button
                key={h.id}
                type="button"
                className={cx("wb-menu-item", current?.id === h.id && "wb-menu-item--active")}
                disabled={running}
                title={running ? "Stop the current run first" : "Restore the options and output of this run"}
                onClick={() => {
                  restore(h);
                  setOpen(false);
                }}
              >
                <div className="wb-menu-item__main">
                  <div className="small truncate">{runTitle(h)}</div>
                  <div className="xsmall muted truncate">
                    {formatTime(h.startedAt)}
                    {res ? ` · ${formatDuration(res.durationMs)}` : ""}
                    {h.schemaUsed ? " · JSON" : ""}
                    {h.form.images.length ? ` · ${h.form.images.length} image(s)` : ""}
                  </div>
                </div>
                {tone && (
                  <Badge tone={tone}>{h.error ? "error" : res?.cancelled ? "stopped" : `exit ${res?.exitCode}`}</Badge>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
