// Setup step 7: a summary of every check, and the way out of the guide.

import { PartyPopper } from "lucide-react";
import { Button, Callout } from "../../components/ui";
import { tildePath } from "../../lib/paths";
import { useApp } from "../../lib/store";
import { engineCheckState, type EngineHandle } from "../overview/hooks";
import { CheckRow } from "../overview/shared";
import type { CheckState } from "../overview/status";
import { StepFrame } from "./StepFrame";
import { STEP_ENGINE, STEP_FM, STEP_LICENSE, STEP_MODEL } from "./steps";

export default function StepDone(props: { engine: EngineHandle; onGoTo: (step: number) => void }) {
  const status = useApp((s) => s.status);
  const loading = useApp((s) => s.statusLoading);
  const home = useApp((s) => s.paths?.homeDir);
  const check = (ok: boolean | undefined): CheckState =>
    loading ? "pending" : !status ? "unknown" : ok ? "ok" : "warn";
  const hint = (ok: boolean | undefined, yes: string, no: string) => (!status ? "Not checked yet" : ok ? yes : no);

  const fm = check(status?.binaryFound);
  const model = check(status?.modelAvailable);
  const license = check(status?.licenseAgreed);
  const engine = engineCheckState(props.engine);
  const engineStatus = props.engine.status;
  const allGood = [fm, model, license].every((s) => s === "ok");

  const needsFix = (s: CheckState) => s !== "ok" && s !== "pending";
  const fix = (step: number) => (
    <Button size="sm" variant="plain" onClick={() => props.onGoTo(step)}>
      Fix
    </Button>
  );

  return (
    <StepFrame
      icon={<PartyPopper />}
      color="pink"
      title={allGood ? "Everything is ready" : "Almost there"}
      lead={
        allGood
          ? "fm is found, the model is available and the license is agreed. You can start chatting now."
          : "Some checks did not pass yet. Click Fix next to a check to go to its step."
      }
    >
      <div className="group">
        <CheckRow
          state={fm}
          label="fm tool"
          hint={hint(status?.binaryFound, "Found", "Not found")}
          value={status?.binaryPath ? tildePath(status.binaryPath, home) : undefined}
          mono
          action={needsFix(fm) && fix(STEP_FM)}
        />
        <CheckRow
          state={model}
          label="On-device model"
          hint={hint(status?.modelAvailable, "Available", "Not available yet")}
          value={status?.availabilityMessage}
          action={needsFix(model) && fix(STEP_MODEL)}
        />
        <CheckRow
          state={license}
          label="Model license"
          hint={hint(status?.licenseAgreed, "Agreed", "Not agreed yet")}
          value={status?.licenseMessage}
          action={needsFix(license) && fix(STEP_LICENSE)}
        />
        <CheckRow
          state={engine}
          label="Chat engine"
          hint={
            engineStatus?.running ? "Private, no network port." : "Optional now. It starts on its own when you chat."
          }
          value={engineStatus ? (engineStatus.running ? "Running" : "Stopped") : undefined}
          action={needsFix(engine) && fix(STEP_ENGINE)}
        />
      </div>

      {allGood ? (
        <Callout tone="success">
          All pages are open now. You can come back to this guide any time from the sidebar (Setup Guide).
        </Callout>
      ) : (
        <Callout tone="warning">
          Chat and the other pages open when fm is found, the model is available and the license is agreed.
        </Callout>
      )}
    </StepFrame>
  );
}
