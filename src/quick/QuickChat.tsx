// One Quick Chat conversation: the overlay (header, messages, composer) and the
// pill, both fed by the same chat state. The chat is created on the first send
// and saved like any other chat, so it shows up in the main Chat list.
// The parent remounts this component (a new key) to start an empty chat.

import { AppWindowMac, ArrowDown, ImagePlus, SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { IconButton, Toasts } from "../components/ui";
import {
  chatCancel,
  chatCreate,
  chatGet,
  errorMessage,
  onQuickReset,
  openMainWindow,
  quickClose,
  quickSetMode,
  toolsCatalog,
} from "../lib/api";
import { useApp } from "../lib/store";
import type { ApprovalDecision, ChatMessage, QuickMode, ToolInfo } from "../lib/types";
import { chatReducer, initialChatState } from "../views/chat/chatState";
import { Composer } from "../views/chat/Composer";
import { useAutoScroll, useImageFileDrop } from "../views/chat/hooks";
import { MessageList } from "../views/chat/MessageList";
import { answerApproval, lastUserInput, runTurn, takeLiveRetry, type TurnInput } from "../views/chat/turn";
import { useAttachments } from "../views/chat/useAttachments";
import { useModelReady } from "../views/chat/useModelReady";
import { imageFiles } from "../views/chat/utils";
import "../views/chat/chat.css";
import { pillText } from "./pill";
import { focusSoon, withHold } from "./quick";
import { QuickEmpty, QuickHeader, QuickPill } from "./QuickParts";

const NO_MESSAGES: ChatMessage[] = [];
/** Title of a chat the engine has not named yet (NEW_CHAT_TITLE in engine/chats.rs). */
const NEW_CHAT_TITLE = "New chat";

export function QuickChat(props: {
  mode: QuickMode;
  /** Changes every time the overlay opens: focus the composer. */
  opened: number;
  /** Start over with an empty chat (the parent remounts this component). */
  onReset: () => void;
}) {
  const { onReset } = props;
  const toast = useApp((s) => s.toast);
  const ready = useModelReady();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [chatId, setChatId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [stopping, setStopping] = useState(false);
  const [catalog, setCatalog] = useState<ToolInfo[] | null>(null);
  const {
    attachments,
    images: readyImages,
    addImagePaths,
    addFiles,
    pickImages,
    remove,
    clear,
  } = useAttachments({
    aroundPick: withHold,
  });

  // The latest state for async callbacks.
  const stateRef = useRef(state);
  const chatIdRef = useRef(chatId);
  useLayoutEffect(() => {
    stateRef.current = state;
    chatIdRef.current = chatId;
  });
  const creatingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const chat = chatId ? (state.chats[chatId] ?? null) : null;
  const run = chatId ? state.runs[chatId] : undefined;
  const running = !!run?.running;
  const messages = chat?.messages ?? NO_MESSAGES;
  const empty = messages.length === 0 && !running && !run?.error;

  const { scrollRef, contentRef, onScroll, atBottom, scrollToBottom } = useAutoScroll(chatId);
  const dropOver = useImageFileDrop(addImagePaths, props.mode !== "pip");

  // Focus the composer every time the overlay opens.
  useEffect(() => (props.opened > 0 ? focusSoon(textareaRef) : undefined), [props.opened]);

  // Tools that can change things get a warning on their approval card.
  useEffect(() => {
    toolsCatalog().then(setCatalog, () => undefined);
  }, [props.opened]);
  const dangerousTools = useMemo(() => new Set((catalog ?? []).filter((t) => t.dangerous).map((t) => t.id)), [catalog]);

  // ---------- reset ----------
  /** Stops a running turn, then starts an empty chat. */
  const reset = useCallback(async () => {
    const id = chatIdRef.current;
    if (id && stateRef.current.runs[id]?.running) await chatCancel(id).catch(() => undefined);
    onReset();
  }, [onReset]);

  // Closing the window (quick_close) resets the chat, so the next open starts empty.
  const onResetEvent = useEffectEvent(() => void reset());
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    onQuickReset(() => onResetEvent())
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ⌘N starts a new chat.
  const onNewKey = useEffectEvent(() => void reset());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNewKey();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- sending ----------
  const send = useCallback(
    async (input: TurnInput) => {
      let id = chatIdRef.current;
      if (!id) {
        if (creatingRef.current) return;
        creatingRef.current = true;
        setCreating(true);
        try {
          const created = await chatCreate();
          dispatch({ type: "setChat", chat: created });
          id = created.id;
          chatIdRef.current = id;
          setChatId(id);
        } catch (err) {
          toast(`Could not start a new chat. ${errorMessage(err)}`, "error");
          return;
        } finally {
          creatingRef.current = false;
          setCreating(false);
        }
      } else if (stateRef.current.runs[id]?.running) {
        return;
      }
      const chatIdNow = id;
      await runTurn(dispatch, chatIdNow, input, scrollToBottom);
      setStopping(false);
      // The engine may have given the chat a title.
      chatGet(chatIdNow)
        .then((saved) =>
          dispatch({ type: "patchChat", id: chatIdNow, patch: { title: saved.title, updatedAt: saved.updatedAt } }),
        )
        .catch(() => undefined);
    },
    [scrollToBottom, toast],
  );

  function submit() {
    const text = draft.trim();
    if (!text && readyImages.length === 0) return;
    setDraft("");
    clear();
    void send({ text, images: readyImages });
  }

  function retryLive() {
    if (!chatId || !run) return;
    void send(takeLiveRetry(dispatch, chatId, run));
  }

  function retrySaved() {
    const input = lastUserInput(messages);
    if (input) void send(input);
  }

  async function stop() {
    if (!chatId) return;
    setStopping(true);
    try {
      await chatCancel(chatId);
    } catch (err) {
      setStopping(false);
      toast(`Could not stop the answer. ${errorMessage(err)}`, "error");
    }
  }

  const respond = useCallback(async (approvalId: string, decision: ApprovalDecision) => {
    const ok = await answerApproval(approvalId, decision);
    if (ok && decision === "always") toolsCatalog().then(setCatalog, () => undefined);
    return ok;
  }, []);

  // ---------- window ----------
  const showError = (err: unknown) => toast(errorMessage(err), "error");
  const openInApp = () => openMainWindow(chatId).catch(showError);
  const close = () => quickClose().catch(showError);
  const expand = () => quickSetMode("overlay").catch(showError);

  const pill = pillText({
    messages,
    running,
    approvalPending: Object.keys(run?.approvals ?? {}).length > 0,
    error: run?.error,
  });
  const title = chat && chat.title !== NEW_CHAT_TITLE ? chat.title : null;

  return (
    <>
      <section
        className="qa-layer qa-overlay"
        aria-label="Quick Chat"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = imageFiles(e.dataTransfer.files);
          if (files.length) {
            e.preventDefault();
            addFiles(files);
          }
        }}
      >
        <QuickHeader title={title}>
          <IconButton label="New chat (⌘N)" onClick={() => void reset()} disabled={creating}>
            <SquarePen size={15} />
          </IconButton>
          <IconButton label="Open in fmGUI" onClick={openInApp}>
            <AppWindowMac size={15} />
          </IconButton>
          <IconButton label="Close" onClick={close}>
            <X size={16} />
          </IconButton>
        </QuickHeader>

        <div className="qa-body">
          <div className="qa-scroll" ref={scrollRef} onScroll={onScroll}>
            <div className={empty ? "qa-thread qa-thread--empty" : "qa-thread"} ref={contentRef}>
              {empty ? (
                <QuickEmpty onPick={(text) => void send({ text, images: [] })} disabled={!ready.ready || creating} />
              ) : (
                <MessageList
                  messages={messages}
                  run={run}
                  dangerousTools={dangerousTools}
                  onRespond={respond}
                  onRetrySaved={retrySaved}
                  onRetryLive={ready.ready ? retryLive : undefined}
                />
              )}
            </div>
          </div>
          {!atBottom && (
            <button
              type="button"
              className="cv-tobottom qa-tobottom"
              title="Scroll to the newest message"
              aria-label="Scroll to the newest message"
              onClick={() => scrollToBottom(true)}
            >
              <ArrowDown size={15} />
            </button>
          )}
        </div>

        <div className="qa-dock">
          <Composer
            textareaRef={textareaRef}
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            onStop={stop}
            running={running}
            stopping={stopping}
            ready={ready}
            blockedReason={creating ? "Starting a new chat…" : null}
            attachments={attachments}
            onRemoveAttachment={remove}
            onAttach={pickImages}
            onPasteFiles={addFiles}
            placeholder={messages.length > 0 ? "Reply" : "Ask anything"}
          />
        </div>

        {dropOver && (
          <div className="cv-drop">
            <ImagePlus size={26} />
            <div>Drop images to attach them</div>
          </div>
        )}
        <Toasts />
      </section>

      <QuickPill text={pill.text} tone={pill.tone} busy={running} onOpen={expand} />
    </>
  );
}
