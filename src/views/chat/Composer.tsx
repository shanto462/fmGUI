// The message composer: a glass card with an auto-growing text field,
// image attachments and a Send / Stop button. Shared by Chat and CLI Sessions.

import { ArrowUp, ImagePlus, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { IconButton, Spinner } from "../../components/ui";
import { cx } from "../../lib/cx";
import { ModelReadyHint } from "./ModelReady";
import { type ModelReady } from "./useModelReady";
import { imageFiles } from "./utils";

/** Grows the text field with its content, up to 220 px. */
function fitHeight(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
}

export interface ComposerAttachment {
  id: string;
  /** Image source for the thumbnail (data URL). Null while loading or when no preview exists. */
  src: string | null;
  name: string;
  loading?: boolean;
}

export function Composer(props: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  running: boolean;
  stopping?: boolean;
  ready: ModelReady;
  /** Another reason sending is blocked right now (shown as the button tooltip). */
  blockedReason?: string | null;
  attachments: ComposerAttachment[];
  onRemoveAttachment: (id: string) => void;
  onAttach: () => void;
  onPasteFiles: (files: File[]) => void;
  placeholder?: string;
  /** Extra controls in the bottom row, after the attach button. */
  toolbar?: ReactNode;
  /** Content above the card, e.g. a command preview. */
  top?: ReactNode;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = props.textareaRef ?? localRef;
  const hasContent = props.value.trim().length > 0 || props.attachments.length > 0;
  const attachmentsLoading = props.attachments.some((a) => a.loading);
  const canSend = props.ready.ready && !props.running && hasContent && !attachmentsLoading && !props.blockedReason;

  useLayoutEffect(() => fitHeight(ref.current), [props.value, ref]);

  // Line wrapping changes when the window gets wider or narrower.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      fitHeight(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  const sendTitle = !props.ready.ready
    ? (props.ready.hint ?? "The model is not ready")
    : props.blockedReason
      ? props.blockedReason
      : attachmentsLoading
        ? "Images are still loading"
        : !hasContent
          ? "Type a message first"
          : "Send (Enter)";

  return (
    <div className="cv-composer-wrap">
      {props.top}
      <div
        className="cv-composer card--glass"
        onMouseDown={(e) => {
          // Clicking empty card space focuses the text field.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            ref.current?.focus();
          }
        }}
      >
        {props.attachments.length > 0 && (
          <div className="cv-attachments">
            {props.attachments.map((a) => (
              <div key={a.id} className="cv-attachment" title={a.name}>
                {a.loading ? (
                  <div className="cv-attachment__placeholder">
                    <Spinner />
                  </div>
                ) : a.src ? (
                  <img src={a.src} alt={a.name} />
                ) : (
                  <div className="cv-attachment__placeholder xsmall">{a.name.split(".").pop()?.toUpperCase()}</div>
                )}
                <button
                  type="button"
                  className="cv-attachment__remove"
                  aria-label={`Remove ${a.name}`}
                  title="Remove"
                  onClick={() => props.onRemoveAttachment(a.id)}
                >
                  <X size={10} strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          className="cv-composer__input"
          rows={1}
          value={props.value}
          placeholder={props.placeholder ?? "Message"}
          spellCheck
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) props.onSubmit();
            }
          }}
          onPaste={(e) => {
            const files = imageFiles(e.clipboardData?.files);
            if (files.length === 0) return;
            if (!e.clipboardData.getData("text/plain")) e.preventDefault();
            props.onPasteFiles(files);
          }}
        />
        <div className="cv-composer__bar">
          <IconButton label="Attach images" onClick={props.onAttach} disabled={props.running}>
            <ImagePlus size={17} />
          </IconButton>
          {props.toolbar}
          <div className="spacer" />
          {props.running ? (
            <button
              type="button"
              className="cv-send cv-send--stop"
              title="Stop"
              aria-label="Stop"
              disabled={!props.onStop || props.stopping}
              onClick={props.onStop}
            >
              {props.stopping ? <Spinner /> : <Square size={11} fill="currentColor" strokeWidth={0} />}
            </button>
          ) : (
            <button
              type="button"
              className={cx("cv-send", canSend && "cv-send--ready")}
              title={sendTitle}
              aria-label="Send"
              disabled={!canSend}
              onClick={props.onSubmit}
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
      {props.ready.ready ? (
        <div className="cv-composer-foot">
          <span className="kbd">Enter</span> to send <span className="kbd">Shift</span>+
          <span className="kbd">Enter</span> for a new line
        </div>
      ) : (
        <ModelReadyHint ready={props.ready} />
      )}
    </div>
  );
}
