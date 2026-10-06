// Setup step 7: summary and finish. OWNER: agent "ui-shell".

import { PartyPopper } from "lucide-react";
import { Button, Callout } from "../../components/ui";
import { useApp } from "../../lib/store";
import { CheckRow, engineCheckState, type CheckState, type EngineHandle } from "../overview/shared";
import { StepFrame } from "./StepFrame";

export default function StepDone(props: {
  engine: EngineHandle;
  onGoTo: (step: number) => void;
}) {
  const status = useApp((s) => s.status);
  const loading = useApp((s) => s.statusLoading);
  const check = (ok: boolean | undefined): CheckState => (loading ? "pending" : !status ? "unknown" : ok ? "ok" : "warn");

  const fm = check(status?.binaryFound);
  const model = check(status?.modelAvailable);
  const license = check(status?.licenseAgreed);
  const engine = engineCheckState(props.engine);
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
      title={allGood ? "You are all set" : "Almost there"}
      lead={
        allGood
          ? "fmGUI is ready. Here is a short summary. Click Finish setup to start."
          : "You can finish now, but some checks did not pass. Here is a short summary."
      }
    >
      <div className="group">
        <CheckRow state={fm} label="fm tool" value={status?.binaryPath} mono action={needsFix(fm) && fix(1)} />
        <CheckRow
          state={model}
          label="On-device model"
          value={status?.availabilityMessage}
          action={needsFix(model) && fix(2)}
        />
        <CheckRow
          state={license}
          label="Model license"
          value={status?.licenseMessage}
          action={needsFix(license) && fix(3)}
        />
        <CheckRow
          state={engine}
          label="Chat engine"
          hint="Optional now. It starts on its own when you chat."
          value={props.engine.status ? (props.engine.status.running ? "Running" : "Stopped") : undefined}
          action={needsFix(engine) && fix(4)}
        />
      </div>

      {!allGood && (
        <Callout tone="warning">
          Chat will not work until fm is found, the model is available and the license is agreed. You can come back
          to this guide any time from the sidebar (Setup Guide).
        </Callout>
      )}
    </StepFrame>
  );
}
