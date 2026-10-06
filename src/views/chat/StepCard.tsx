// One tool call inside an assistant turn: a compact card that expands to show
// arguments and result, with an inline approval panel. OWNER: agent "ui-chat".

import { Ban, Check, ChevronRight, Hammer, Hand, Plug, Sparkles, TriangleAlert, Wrench, X } from "lucide-react";
import { memo, useState } from "react";
import { Button, CodeBlock, Spinner, cx, formatDuration } from "../../components/ui";
import type { AgentStep, ApprovalDecision, ToolSource } from "../../lib/types";
import { isEmptyArgs, prettyJson } from "./utils";

export const SOURCE_LABEL: Record<ToolSource, string> = {
  builtin: "Built-in",
  custom: "Custom",
  mcp: "MCP",
  skill: "Skill",
};

export function SourceIcon(props: { source: ToolSource; size?: number }) {
  const size = props.size ?? 13;
  const Icon = { builtin: Wrench, custom: Hammer, mcp: Plug, skill: Sparkles }[props.source] ?? Wrench;
  return (
    <span className={cx("cv-source", `cv-source--${props.source}`)} title={SOURCE_LABEL[props.source]}>
      <Icon size={size} />
    </span>
  );
}

function StatusIcon(props: { status: AgentStep["status"] }) {
  switch (props.status) {
    case "running":
      return <Spinner />;
    case "done":
      return <Check size={14} className="cv-status cv-status--done" aria-label="Done" />;
    case "error":
      return <X size={14} className="cv-status cv-status--error" aria-label="Failed" />;
    case "denied":
      return <Ban size={13} className="cv-status cv-status--denied" aria-label="Denied" />;
    case "pendingApproval":
      return <Hand size={13} className="cv-status cv-status--waiting" aria-label="Waiting for you" />;
  }
}

function formatResult(text: string): string {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[") ? prettyJson(t) : text;
}

export const StepCard = memo(function StepCard(props: {
  step: AgentStep;
  /** Set while the engine waits for the user to answer. */
  approvalId?: string;
  dangerous?: boolean;
  onRespond?: (approvalId: string, decision: ApprovalDecision) => Promise<boolean>;
}) {
  const { step, approvalId, dangerous } = props;
  const [open, setOpen] = useState(false);
  const [answering, setAnswering] = useState<ApprovalDecision | null>(null);
  const waiting = step.status === "pendingApproval" && !!approvalId;

  async function respond(decision: ApprovalDecision) {
    if (!approvalId || !props.onRespond) return;
    setAnswering(decision);
    const ok = await props.onRespond(approvalId, decision);
    // On success the engine sends a new step status; keep buttons disabled until then.
    if (!ok) setAnswering(null);
  }

  const statusText =
    step.status === "denied" ? "Denied" : step.status === "error" ? "Failed" : step.status === "pendingApproval" ? "Waiting" : "";

  return (
    <div
      className={cx(
        "cv-step",
        `cv-step--${step.status}`,
        waiting && "cv-step--approval",
        waiting && dangerous && "cv-step--danger",
      )}
    >
      <button
        type="button"
        className="cv-step__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={open ? "Hide details" : "Show details"}
      >
        <SourceIcon source={step.source} />
        <span className="cv-step__title truncate">{step.title || step.toolName}</span>
        {step.title && step.title !== step.toolName && (
          <span className="cv-step__name truncate">{step.toolName}</span>
        )}
        <span className="spacer" />
        {statusText && <span className="cv-step__state">{statusText}</span>}
        {step.durationMs != null && <span className="cv-step__dur">{formatDuration(step.durationMs)}</span>}
        <StatusIcon status={step.status} />
        <ChevronRight size={13} className={cx("cv-step__chevron", open && "cv-step__chevron--open")} />
      </button>

      {waiting && (
        <div className="cv-approval">
          {dangerous ? (
            <div className="cv-approval__warn">
              <TriangleAlert size={14} />
              <span>
                This tool can change files or run commands on your Mac. Check the arguments before you allow it.
              </span>
            </div>
          ) : (
            <div className="small muted">The model wants to use this tool. Do you allow it?</div>
          )}
          {!isEmptyArgs(step.arguments) && <CodeBlock code={prettyJson(step.arguments)} wrap maxHeight={200} />}
          <div className="row">
            <Button
              size="sm"
              variant="primary"
              loading={answering === "allow"}
              disabled={!!answering}
              onClick={() => respond("allow")}
            >
              Allow once
            </Button>
            <Button
              size="sm"
              loading={answering === "always"}
              disabled={!!answering}
              onClick={() => respond("always")}
              title="Do not ask again for this tool"
            >
              Always allow
            </Button>
            <div className="spacer" />
            <Button
              size="sm"
              variant="danger"
              loading={answering === "deny"}
              disabled={!!answering}
              onClick={() => respond("deny")}
            >
              Deny
            </Button>
          </div>
        </div>
      )}

      {open && (
        <div className="cv-step__body">
          {!waiting && (
            <>
              <div className="cv-step__label">Arguments</div>
              {isEmptyArgs(step.arguments) ? (
                <div className="xsmall muted">No arguments.</div>
              ) : (
                <CodeBlock code={prettyJson(step.arguments)} wrap maxHeight={220} />
              )}
            </>
          )}
          {step.result != null && step.result !== "" && (
            <>
              <div className="cv-step__label">Result</div>
              <CodeBlock code={formatResult(step.result)} wrap maxHeight={280} />
            </>
          )}
          {step.error && (
            <>
              <div className="cv-step__label">Error</div>
              <div className="cv-step__error selectable">{step.error}</div>
            </>
          )}
          {step.status === "running" && step.result == null && <div className="xsmall muted">Running…</div>}
          {step.status === "denied" && !step.error && (
            <div className="xsmall muted">You denied this call. The model was told it could not use the tool.</div>
          )}
        </div>
      )}
    </div>
  );
});
