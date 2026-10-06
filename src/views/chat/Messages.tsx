// Message rendering shared by Chat and CLI Sessions: user bubbles on the right,
// assistant answers on the left without a bubble.

import { Sparkles } from "lucide-react";
import { memo, useState } from "react";
import { Markdown } from "../../components/Markdown";
import { Badge, Button, CopyButton, Modal, Spinner } from "../../components/ui";
import { cx } from "../../lib/cx";
import { formatDuration, formatNumber } from "../../lib/format";
import type { ApprovalDecision, ChatMessage } from "../../lib/types";
import { StepCard } from "./StepCard";

export function ImageThumbs(props: { images: string[]; align?: "left" | "right" }) {
  const [preview, setPreview] = useState<string | null>(null);
  if (props.images.length === 0) return null;
  return (
    <>
      <div className={cx("cv-thumbs", props.align === "right" && "cv-thumbs--right")}>
        {props.images.map((src, i) => (
          <button key={i} type="button" className="cv-thumb" title="Show image" onClick={() => setPreview(src)}>
            <img src={src} alt={`Image ${i + 1}`} />
          </button>
        ))}
      </div>
      {preview && (
        <Modal title="Image" wide onClose={() => setPreview(null)}>
          <div className="cv-lightbox">
            <img src={preview} alt="Attached image" />
          </div>
        </Modal>
      )}
    </>
  );
}

export const UserMessage = memo(function UserMessage(props: { text: string; images: string[]; pending?: boolean }) {
  return (
    <div className={cx("cv-msg cv-msg--user", props.pending && "cv-msg--pending")}>
      <ImageThumbs images={props.images} align="right" />
      {props.text.trim() && <div className="cv-bubble selectable">{props.text}</div>}
    </div>
  );
});

export function StatusLine(props: { text: string }) {
  return (
    <div className="cv-statusline" role="status">
      <Spinner />
      <span className="cv-shimmer">{props.text}</span>
    </div>
  );
}

/** Markdown answer; shows a soft caret while it streams. */
export function AnswerText(props: { text: string; streaming?: boolean }) {
  if (!props.text) return null;
  return <Markdown text={props.text} className={cx("cv-answer", props.streaming && "cv-answer--streaming")} />;
}

export function MessageError(props: { text: string; onRetry?: () => void }) {
  return (
    <div className="cv-error">
      <span className="selectable">{props.text}</span>
      {props.onRetry && (
        <Button size="sm" onClick={props.onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export const AssistantMessage = memo(function AssistantMessage(props: {
  message: ChatMessage;
  streaming: boolean;
  status: string | null;
  approvals: Record<string, string> | undefined;
  dangerousTools: Set<string>;
  onRespond: (approvalId: string, decision: ApprovalDecision) => Promise<boolean>;
  /** Shown on the saved error of the last message. */
  onRetry?: () => void;
}) {
  const { message, streaming } = props;
  const showStatus = streaming && !message.text;
  const waiting = !!props.approvals && Object.keys(props.approvals).length > 0;
  const tokens = message.usage?.totalTokens;
  const hasFooter =
    !streaming && (message.text || message.durationMs != null || tokens || message.skillsUsed.length > 0);

  return (
    <div className="cv-msg cv-msg--assistant">
      {message.steps.length > 0 && (
        <div className="cv-steps">
          {message.steps.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              approvalId={props.approvals?.[step.id]}
              dangerous={props.dangerousTools.has(step.toolId)}
              onRespond={props.onRespond}
            />
          ))}
        </div>
      )}
      {showStatus && <StatusLine text={waiting ? "Waiting for your answer…" : props.status || "Thinking…"} />}
      <AnswerText text={message.text} streaming={streaming} />
      {!streaming && !message.text && !message.error && message.steps.length === 0 && (
        <div className="small muted">No answer.</div>
      )}
      {message.error && <MessageError text={message.error} onRetry={props.onRetry} />}
      {hasFooter && (
        <div className="cv-msg__footer">
          {message.durationMs != null && <span>{formatDuration(message.durationMs)}</span>}
          {!!tokens && (
            <span
              title={`${formatNumber(message.usage!.promptTokens)} in, ${formatNumber(message.usage!.completionTokens)} out`}
            >
              {formatNumber(tokens)} tokens
            </span>
          )}
          {message.skillsUsed.map((s) => (
            <Badge key={s} tone="purple" title="Skill used in this answer">
              <Sparkles size={10} />
              {s}
            </Badge>
          ))}
          {message.text && (
            <span className="cv-msg__copy">
              <CopyButton text={message.text} label="Copy answer" />
            </span>
          )}
        </div>
      )}
    </div>
  );
});
