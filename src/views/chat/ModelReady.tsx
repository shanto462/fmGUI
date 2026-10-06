// Is the on-device model ready to answer? Used to block sending with a clear hint.
// OWNER: agent "ui-chat".

import { useApp } from "../../lib/store";
import { Button } from "../../components/ui";

export interface ModelReady {
  ready: boolean;
  hint: string | null;
  /** What the hint button should do. */
  fix: "setup" | "recheck" | null;
}

export function useModelReady(): ModelReady {
  const status = useApp((s) => s.status);
  const loading = useApp((s) => s.statusLoading);
  if (!status) {
    return loading
      ? { ready: false, hint: "Checking the on-device model…", fix: null }
      : { ready: false, hint: "Could not check the on-device model.", fix: "recheck" };
  }
  if (!status.binaryFound) {
    return { ready: false, hint: "The fm command was not found on this Mac.", fix: "setup" };
  }
  if (!status.licenseAgreed) {
    return { ready: false, hint: "Agree to the fm license before you chat.", fix: "setup" };
  }
  if (!status.modelAvailable) {
    return {
      ready: false,
      hint: status.availabilityMessage || "The on-device model is not available right now.",
      fix: "recheck",
    };
  }
  return { ready: true, hint: null, fix: null };
}

/** One line under the composer that explains why sending is blocked. */
export function ModelReadyHint(props: { ready: ModelReady }) {
  const navigate = useApp((s) => s.navigate);
  const refreshStatus = useApp((s) => s.refreshStatus);
  const loading = useApp((s) => s.statusLoading);
  const { hint, fix } = props.ready;
  if (!hint) return null;
  return (
    <div className="cv-ready-hint">
      <span className="truncate">{hint}</span>
      {fix === "setup" && (
        <Button size="sm" variant="plain" onClick={() => navigate("setup")}>
          Open Setup Guide
        </Button>
      )}
      {fix === "recheck" && (
        <Button size="sm" variant="plain" loading={loading} onClick={() => refreshStatus()}>
          Check again
        </Button>
      )}
    </div>
  );
}
