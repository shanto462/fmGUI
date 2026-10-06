// Setup step 5: start the private chat engine and test the model.

import { Hand, Lock, Play, RefreshCw, Sparkles, Square, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, Callout, CommandPreview, Spinner } from "../../components/ui";
import { errorMessage, fmCancel, fmRun, newId } from "../../lib/api";
import { displayCommand } from "../../lib/fmArgs";
import { formatDuration } from "../../lib/format";
import { tildePath } from "../../lib/paths";
import { useApp } from "../../lib/store";
import type { RunResult } from "../../lib/types";
import { engineCheckState, type EngineHandle } from "../overview/hooks";
import { CheckRow, IconTile } from "../overview/shared";
import { StepFrame } from "./StepFrame";

const HELLO_ARGS = ["respond", "--no-stream", "--", "Say hello in one short sentence."];

interface HelloResult {
  ok: boolean;
  text: string;
  ms: number;
}

function runError(r: RunResult): string {
  if (r.exitCode === 69) return "The license is not agreed yet. Go back to the License step.";
  return r.error || r.stderr.trim() || `fm stopped with exit code ${r.exitCode}.`;
}

export default function StepEngine(props: { engine: EngineHandle }) {
  const { engine } = props;
  const config = useApp((s) => s.config);
  const home = useApp((s) => s.paths?.homeDir);
  const toast = useApp((s) => s.toast);
  const [hello, setHello] = useState<HelloResult | null>(null);
  const [live, setLive] = useState("");
  const [running, setRunning] = useState(false);
  const runId = useRef<string | null>(null);

  const st = engine.status;
  const state = engineCheckState(engine);

  const sayHello = async () => {
    const id = newId();
    runId.current = id;
    setRunning(true);
    setHello(null);
    setLive("");
    try {
      const r = await fmRun(HELLO_ARGS, (e) => e.kind === "stdout" && setLive((t) => t + e.text), id);
      if (r.cancelled) setHello({ ok: false, text: "Stopped.", ms: r.durationMs });
      else if (r.exitCode === 0 && !r.error) setHello({ ok: true, text: r.stdout.trim(), ms: r.durationMs });
      else setHello({ ok: false, text: runError(r), ms: r.durationMs });
    } catch (err) {
      setHello({ ok: false, text: errorMessage(err), ms: 0 });
    } finally {
      setRunning(false);
      runId.current = null;
    }
  };

  const stop = () => {
    if (runId.current)
      fmCancel(runId.current).catch((err) => toast(`Could not stop fm. ${errorMessage(err)}`, "error"));
  };

  return (
    <StepFrame
      icon={<Zap />}
      color="green"
      title="Start the chat engine"
      lead="Chat uses a private copy of fm serve that only fmGUI can reach. It starts on its own when you chat. Start it now to test it."
    >
      <div className="card setup-privacy">
        <IconTile color="teal" size="md">
          <Lock />
        </IconTile>
        <div>
          <div className="card__title">Private, no open port</div>
          <p className="card__desc">
            The engine talks over a socket file in the app data folder, not a network port. Other apps and other
            computers cannot reach it.
          </p>
        </div>
      </div>

      <div className="group">
        <CheckRow
          state={state}
          label="Chat engine"
          hint={
            engine.loading
              ? "Checking…"
              : engine.restarting
                ? "Starting…"
                : st?.running
                  ? `Running${st.pid ? `, process ${st.pid}` : ""}`
                  : st
                    ? "Stopped"
                    : "Status unknown"
          }
          value={st?.socketPath ? tildePath(st.socketPath, home) : undefined}
          mono
        />
      </div>

      {engine.error && <Callout tone="error">{engine.error}</Callout>}
      {st?.lastError && !st.running && <Callout tone="error">{st.lastError}</Callout>}

      <div className="row">
        <Button
          variant={st?.running ? "default" : "primary"}
          icon={st?.running ? <RefreshCw size={14} /> : <Play size={14} />}
          loading={engine.restarting}
          onClick={engine.restart}
        >
          {st?.running ? "Restart engine" : "Start engine"}
        </Button>
      </div>

      <div className="card stack">
        <div>
          <div className="card__title">Test the model</div>
          <p className="card__desc">Send one short prompt with the fm tool and see the reply.</p>
        </div>
        <CommandPreview command={displayCommand(HELLO_ARGS, config?.fmPath)} />
        <div className="row">
          {running ? (
            <Button icon={<Square size={12} />} onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" icon={<Hand size={14} />} onClick={sayHello}>
              Say hello
            </Button>
          )}
          {running && (
            <span className="row small muted">
              <Spinner /> The model is thinking…
            </span>
          )}
        </div>

        {running && live && <div className="setup-reply selectable">{live}</div>}

        {hello?.ok && (
          <div className="setup-reply">
            <Sparkles size={14} className="setup-reply__icon" />
            <div className="selectable setup-reply__text">{hello.text || "(The model sent an empty reply.)"}</div>
            <Badge tone="green" title="Total time for this run">
              {formatDuration(hello.ms)}
            </Badge>
          </div>
        )}
        {hello && !hello.ok && (
          <Callout tone="error">
            <span className="selectable">{hello.text}</span>
          </Callout>
        )}
      </div>
    </StepFrame>
  );
}
