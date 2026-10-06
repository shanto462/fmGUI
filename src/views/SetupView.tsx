// Setup Guide: a step-by-step wizard for first launch. OWNER: agent "ui-shell".

import { ArrowLeft, ArrowRight, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Page, Steps } from "../components/ui";
import { useApp } from "../lib/store";
import { useEngine } from "./overview/shared";
import StepDone from "./setup/StepDone";
import StepEngine from "./setup/StepEngine";
import StepExtras from "./setup/StepExtras";
import StepFm from "./setup/StepFm";
import StepLicense from "./setup/StepLicense";
import StepModel from "./setup/StepModel";
import StepWelcome from "./setup/StepWelcome";
import "./SetupView.css";

const STEPS = ["Welcome", "fm tool", "Model", "License", "Engine", "Extras", "Done"];
const LAST = STEPS.length - 1;
// Steps whose status is re-checked when the window gets focus again
// (for example after the user ran `sudo fm license` in Terminal).
const RECHECK_ON_FOCUS = new Set([2, 3]);

export default function SetupView() {
  const status = useApp((s) => s.status);
  const navigate = useApp((s) => s.navigate);
  const updateConfig = useApp((s) => s.updateConfig);
  const refreshStatus = useApp((s) => s.refreshStatus);
  const toast = useApp((s) => s.toast);
  const engine = useEngine();

  const [current, setCurrent] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A check that must pass before "Continue" is enabled.
  const gates: Record<number, { ok: boolean; why: string }> = {
    1: { ok: !!status?.binaryFound, why: "fm must be found to continue." },
    2: { ok: !!status?.modelAvailable, why: "The model must be available to continue." },
    3: { ok: !!status?.licenseAgreed, why: "The license must be agreed to continue." },
  };
  const gate = gates[current];
  const blocked = !!gate && !gate.ok;

  const go = useCallback((step: number) => {
    const next = Math.max(0, Math.min(LAST, step));
    setCurrent(next);
    setFurthest((f) => Math.max(f, next));
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  // Re-check when the user comes back from Terminal or System Settings.
  useEffect(() => {
    if (!RECHECK_ON_FOCUS.has(current)) return;
    const onFocus = () => void refreshStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [current, refreshStatus]);

  const finish = async (route: "overview" | "chat") => {
    setFinishing(true);
    const saved = await updateConfig((c) => {
      c.setupCompleted = true;
    });
    setFinishing(false);
    if (!saved) return;
    toast("Setup is complete. Enjoy fmGUI.", "success");
    navigate(route);
  };

  let body;
  switch (current) {
    case 0:
      body = <StepWelcome />;
      break;
    case 1:
      body = <StepFm />;
      break;
    case 2:
      body = <StepModel />;
      break;
    case 3:
      body = <StepLicense />;
      break;
    case 4:
      body = <StepEngine engine={engine} />;
      break;
    case 5:
      body = <StepExtras />;
      break;
    default:
      body = <StepDone engine={engine} onGoTo={go} />;
  }

  return (
    <Page title="Setup Guide" subtitle={`Step ${current + 1} of ${STEPS.length}: ${STEPS[current]}`} flush>
      <div className="setup">
        <div className="setup-top" title="Click a step you have seen to go back to it">
          <div className="setup-top__inner">
            <Steps steps={STEPS} current={current} onSelect={go} maxReachable={furthest} />
          </div>
        </div>

        <div className="setup-scroll" ref={scrollRef}>
          <div key={current} className="setup-panel">
            {body}
          </div>
        </div>

        <footer className="setup-footer">
          <div className="setup-footer__inner">
            {current > 0 ? (
              <Button icon={<ArrowLeft size={14} />} onClick={() => go(current - 1)} disabled={finishing}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="spacer" />
            {blocked && <span className="setup-footer__why">{gate.why}</span>}
            {blocked && (
              <Button variant="plain" onClick={() => go(current + 1)}>
                Skip for now
              </Button>
            )}
            {current < LAST && (
              <Button variant="primary" disabled={blocked} onClick={() => go(current + 1)}>
                {current === 0 ? "Get started" : "Continue"}
                <ArrowRight size={14} />
              </Button>
            )}
            {current === LAST && (
              <>
                <Button icon={<MessageSquare size={14} />} disabled={finishing} onClick={() => finish("chat")}>
                  Finish and start a chat
                </Button>
                <Button variant="primary" loading={finishing} onClick={() => finish("overview")}>
                  Finish setup
                </Button>
              </>
            )}
          </div>
        </footer>
      </div>
    </Page>
  );
}
