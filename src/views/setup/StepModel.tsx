// Setup step 3: Apple Intelligence and the on-device model. OWNER: agent "ui-shell".

import { BrainCircuit, RefreshCw } from "lucide-react";
import { Button, Callout } from "../../components/ui";
import { useApp } from "../../lib/store";
import { CheckRow } from "../overview/shared";
import { HowTo, StepFrame } from "./StepFrame";
import { useRecheck } from "./useRecheck";

export default function StepModel() {
  const status = useApp((s) => s.status);
  const { recheck, failed, loading } = useRecheck();
  const ok = !!status?.modelAvailable;

  return (
    <StepFrame
      icon={<BrainCircuit />}
      color="purple"
      title="Apple Intelligence and the model"
      lead="The model is part of Apple Intelligence. It runs on your Mac, so it must be turned on and downloaded first."
    >
      <div className="group">
        <CheckRow
          state={loading ? "pending" : !status ? "unknown" : ok ? "ok" : "warn"}
          label="On-device model"
          hint={status ? (ok ? "Available" : "Not available yet") : "Not checked yet"}
          value={status?.availabilityMessage}
        />
      </div>

      <div className="row">
        <Button icon={<RefreshCw size={14} />} loading={loading} onClick={recheck}>
          Check again
        </Button>
      </div>

      {failed && !loading && (
        <Callout tone="error">
          The check did not finish. The error message is in the corner. Wait a moment and try again.
        </Callout>
      )}

      {ok && !loading && <Callout tone="success">The on-device model is ready.</Callout>}

      {status && !ok && (
        <div className="card">
          <div className="card__title" style={{ marginBottom: 12 }}>
            How to turn it on
          </div>
          <HowTo
            items={[
              {
                title: "Use a Mac with Apple silicon",
                text: "M1 or later. Macs with an Intel chip cannot run the model.",
              },
              {
                title: "Turn on Apple Intelligence",
                text: (
                  <>
                    Open <strong>System Settings → Apple Intelligence &amp; Siri</strong> and switch on Apple
                    Intelligence.
                  </>
                ),
              },
              {
                title: "Wait for the model to download",
                text: "It is about 7 GB. Keep your Mac on Wi-Fi and power. This can take a while.",
              },
              { title: "Come back and check again", text: "Click Check again when the download is done." },
            ]}
          />
        </div>
      )}

      {status && !ok && (
        <Callout>
          Apple Intelligence needs a supported language and region. If you cannot find the switch, check{" "}
          <strong>System Settings → General → Language &amp; Region</strong>.
        </Callout>
      )}
    </StepFrame>
  );
}
