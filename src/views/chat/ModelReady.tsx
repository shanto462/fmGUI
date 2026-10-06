// The hint under the composer that explains why sending is blocked.

import { Button } from "../../components/ui";
import { useApp } from "../../lib/store";
import type { ModelReady } from "./useModelReady";

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
