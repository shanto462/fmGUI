// Settings: private chat engine status and restart. OWNER: agent "ui-shell".

import { RefreshCw, Zap } from "lucide-react";
import { Button, Callout, Section, StatusDot } from "../../components/ui";
import { useApp } from "../../lib/store";
import { tildify, useEngine } from "../overview/shared";
import { SettingRow } from "./SettingRow";

export default function EngineSection() {
  const engine = useEngine();
  const home = useApp((s) => s.paths?.homeDir);
  const st = engine.status;

  let state = "Unknown";
  let tone: "green" | "red" | "gray" = "gray";
  if (engine.loading) state = "Checking…";
  else if (engine.restarting) state = "Starting…";
  else if (st?.running) [state, tone] = [`Running${st.pid ? `, process ${st.pid}` : ""}`, "green"];
  else if (st) [state, tone] = ["Stopped", st.lastError ? "red" : "gray"];

  return (
    <Section title="Chat engine">
      <div className="group">
        <SettingRow
          icon={<Zap />}
          color="green"
          label={
            <span className="row">
              <StatusDot tone={tone} pulse={engine.loading || engine.restarting} />
              {state}
            </span>
          }
          hint={
            st?.socketPath ? (
              <>
                A private fm serve for Chat. Socket:{" "}
                <span className="mono selectable settings-path">{tildify(st.socketPath, home)}</span>
              </>
            ) : (
              "A private fm serve for Chat. It starts on its own when you chat."
            )
          }
        >
          <Button size="sm" icon={<RefreshCw size={12} />} loading={engine.restarting} onClick={engine.restart}>
            {st?.running ? "Restart" : "Start"}
          </Button>
        </SettingRow>
      </div>
      {engine.error && (
        <div style={{ marginTop: 8 }}>
          <Callout tone="error">{engine.error}</Callout>
        </div>
      )}
      {st?.lastError && (
        <div style={{ marginTop: 8 }}>
          <Callout tone={st.running ? "warning" : "error"}>
            <span className="selectable">{st.lastError}</span>
          </Callout>
        </div>
      )}
    </Section>
  );
}
