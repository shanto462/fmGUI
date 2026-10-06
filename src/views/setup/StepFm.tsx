// Setup step 2: find the fm binary. OWNER: agent "ui-shell".

import { RefreshCw, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Callout, Field, TextInput } from "../../components/ui";
import { useApp } from "../../lib/store";
import { CheckRow, isOldMacos, macosLabel, useSaveConfig } from "../overview/shared";
import { StepFrame } from "./StepFrame";
import { useRecheck } from "./useRecheck";

const DEFAULT_PATH = "/usr/bin/fm";

export default function StepFm() {
  const status = useApp((s) => s.status);
  const config = useApp((s) => s.config);
  const save = useSaveConfig();
  const { recheck, failed, loading } = useRecheck();
  const [path, setPath] = useState(config?.fmPath ?? DEFAULT_PATH);
  const [showPath, setShowPath] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setPath(config?.fmPath ?? DEFAULT_PATH), [config?.fmPath]);

  const oldMac = isOldMacos(status);
  const notFound = !!status && !status.binaryFound;
  const pathOpen = notFound || showPath;

  const applyPath = async () => {
    const next = path.trim();
    if (!next) return;
    setSaving(true);
    const saved = await save((c) => {
      c.fmPath = next;
    });
    setSaving(false);
    if (saved) await recheck();
  };

  return (
    <StepFrame
      icon={<Terminal />}
      color="gray"
      title="Find the fm tool"
      lead={
        <>
          fmGUI is a friendly face for <code>fm</code>, Apple's command line tool for the on-device model. Let's
          make sure it is on this Mac.
        </>
      }
    >
      <div className="group">
        <CheckRow
          state={loading ? "pending" : !status ? "unknown" : status.binaryFound ? "ok" : "bad"}
          label="fm tool"
          hint={status ? (status.binaryFound ? "Found" : "Not found") : "Not checked yet"}
          value={status?.binaryPath || config?.fmPath}
          mono
        />
        <CheckRow
          state={loading ? "pending" : !status?.macosVersion ? "unknown" : oldMac ? "bad" : "ok"}
          label="macOS"
          hint="fm needs macOS 27 or later"
          value={macosLabel(status)}
        />
      </div>

      <div className="row">
        <Button icon={<RefreshCw size={14} />} loading={loading} onClick={recheck}>
          Check again
        </Button>
        <div className="spacer" />
        {!notFound && (
          <Button variant="plain" size="sm" onClick={() => setShowPath((v) => !v)}>
            {showPath ? "Hide custom path" : "Use a different fm path"}
          </Button>
        )}
      </div>

      {failed && !loading && (
        <Callout tone="error">
          The check did not finish. The error message is in the corner. Wait a moment and try again.
        </Callout>
      )}

      {status?.binaryFound && !loading && <Callout tone="success">Found fm. You are good to go.</Callout>}

      {notFound && (
        <Callout tone="warning">
          <strong>fm was not found.</strong> It ships with macOS 27 and lives at <code>/usr/bin/fm</code>.
          {oldMac && <> This Mac runs macOS {status?.macosVersion}. Update to macOS 27 or later first.</>} If fm
          is in a different place on your Mac, enter its full path below.
        </Callout>
      )}

      {pathOpen && (
        <div className="card stack">
          <Field label="Path to fm" hint="You can change this later in Settings, under fm tool.">
            <TextInput
              className="mono"
              value={path}
              placeholder={DEFAULT_PATH}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyPath()}
            />
          </Field>
          <div className="row">
            <Button variant="primary" loading={saving} disabled={!path.trim()} onClick={applyPath}>
              Use this path
            </Button>
            {path.trim() !== DEFAULT_PATH && (
              <Button variant="plain" onClick={() => setPath(DEFAULT_PATH)}>
                Reset to default
              </Button>
            )}
          </div>
        </div>
      )}
    </StepFrame>
  );
}
