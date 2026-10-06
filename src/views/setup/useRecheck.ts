// Re-runs the fm status check and remembers if it failed.

import { useCallback, useState } from "react";
import { useApp } from "../../lib/store";

export function useRecheck() {
  const refreshStatus = useApp((s) => s.refreshStatus);
  const loading = useApp((s) => s.statusLoading);
  const [failed, setFailed] = useState(false);

  const recheck = useCallback(async () => {
    const next = await refreshStatus();
    setFailed(!next);
    return next;
  }, [refreshStatus]);

  return { recheck, failed, loading };
}
