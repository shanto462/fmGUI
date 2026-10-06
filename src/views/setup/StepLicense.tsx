// Setup step 4: the model license. The GUI never accepts it for the user.

import { FileText, RefreshCw, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Callout, CodeBlock, CommandPreview, Spinner } from "../../components/ui";
import { errorMessage, fmLicenseText, openInTerminal } from "../../lib/api";
import { displayCommand } from "../../lib/fmArgs";
import { useApp } from "../../lib/store";
import { CheckRow } from "../overview/shared";
import { HowTo, StepFrame } from "./StepFrame";
import { useRecheck } from "./useRecheck";

export default function StepLicense() {
  const status = useApp((s) => s.status);
  const config = useApp((s) => s.config);
  const toast = useApp((s) => s.toast);
  const { recheck, failed, loading } = useRecheck();
  const [terms, setTerms] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const agreed = !!status?.licenseAgreed;
  const command = "sudo " + displayCommand(["license"], config?.fmPath);

  useEffect(() => {
    let alive = true;
    fmLicenseText()
      .then((text) => alive && setTerms(text.trim()))
      .catch((err) => alive && setTermsError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, []);

  const openTerminal = async () => {
    setOpening(true);
    try {
      await openInTerminal(command);
      toast("Terminal is open. Follow the steps there, then come back here.", "info");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setOpening(false);
    }
  };

  return (
    <StepFrame
      icon={<FileText />}
      color="orange"
      title="Read and accept the license"
      lead="Apple asks you to agree to the model terms once. This is your choice, so fmGUI never accepts the terms for you."
    >
      <div className="group">
        <CheckRow
          state={loading ? "pending" : !status ? "unknown" : agreed ? "ok" : "warn"}
          label="Model license"
          hint={status ? (agreed ? "Agreed" : "Not agreed yet") : "Not checked yet"}
          value={status?.licenseMessage}
        />
      </div>

      {agreed && !loading && <Callout tone="success">You agreed to the license. Thank you.</Callout>}

      <div className="stack" style={{ gap: 8 }}>
        <div className="section__title">License terms</div>
        {terms != null ? (
          <CodeBlock code={terms || "fm returned no text."} wrap maxHeight={240} />
        ) : termsError ? (
          <Callout tone="warning">
            The terms could not be loaded here. You will see them in Terminal too.
            <div className="xsmall muted selectable" style={{ marginTop: 4 }}>
              {termsError}
            </div>
          </Callout>
        ) : (
          <div className="row muted small">
            <Spinner /> Loading the terms…
          </div>
        )}
      </div>

      {!agreed && (
        <div className="card stack">
          <div className="card__title">How to agree</div>
          <HowTo
            items={[
              { title: "Open Terminal with the button below", text: "It runs the license command for you." },
              {
                title: "Type your Mac password",
                text: "sudo asks for it in Terminal. fmGUI never sees your password.",
              },
              { title: "Read the terms and answer", text: "Type your answer in Terminal." },
              { title: "Come back and check again", text: "fmGUI also checks again when you return to this window." },
            ]}
          />
          <CommandPreview command={command} />
          <div className="row row--wrap">
            <Button variant="primary" icon={<SquareTerminal size={14} />} loading={opening} onClick={openTerminal}>
              Open Terminal and run sudo fm license
            </Button>
          </div>
        </div>
      )}

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
    </StepFrame>
  );
}
