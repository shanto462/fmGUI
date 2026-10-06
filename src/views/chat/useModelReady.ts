// Is the on-device model ready to answer? Used to block sending with a clear hint.

import { useApp } from "../../lib/store";

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
