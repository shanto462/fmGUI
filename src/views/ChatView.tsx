// Agent chat with tools, MCP and skills.
// Pieces live in ./chat/: list, header, messages, step cards, composer, state.

import { ArrowDown, ImagePlus } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button, Callout, Modal, Spinner } from "../components/ui";
import {
  approvalRespond,
  chatCancel,
  chatCreate,
  chatDelete,
  chatGet,
  chatRename,
  chatSend,
  chatSetInstructions,
  chatsList,
  errorMessage,
  getConfig,
  newId,
  readImageDataUrl,
  toolsCatalog,
} from "../lib/api";
import { pluralize } from "../lib/format";
import { baseName } from "../lib/paths";
import { useApp, useHandoff } from "../lib/store";
import type { AgentEvent, ApprovalDecision, Chat, ChatMessage, ChatSummary, ToolInfo } from "../lib/types";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatList } from "./chat/ChatList";
import { chatReducer, initialChatState, type ContextUse } from "./chat/chatState";
import { Composer, type ComposerAttachment } from "./chat/Composer";
import { useAutoScroll, useElementHeight, useImageFileDrop } from "./chat/hooks";
import { AssistantMessage, MessageError, StatusLine, UserMessage } from "./chat/Messages";
import { ToolsModal } from "./chat/ToolsModal";
import { useModelReady } from "./chat/useModelReady";
import { blankMessage, imageFiles, isTempId, pickImagePaths, readFileAsDataUrl } from "./chat/utils";
import { Welcome } from "./chat/Welcome";
import "./chat/chat.css";

const NEW_KEY = "__new";
const NO_MESSAGES: ChatMessage[] = [];

function summaryOf(chat: Chat): ChatSummary {
  const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
  return {
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
    preview: lastUser?.text.slice(0, 120) ?? "",
  };
}

export default function ChatView() {
  const toast = useApp((s) => s.toast);
  const config = useApp((s) => s.config);
  const fmContextSize = useApp((s) => s.status?.contextSize);
  const handoff = useHandoff();
  const ready = useModelReady();

  const [list, setList] = useState<ChatSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Another page can ask to open a chat (Overview → New chat).
  const [activeId, setActiveId] = useState<string | null>(handoff.chatId ?? null);
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [creating, setCreating] = useState(false);
  const [catalog, setCatalog] = useState<ToolInfo[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [deleting, setDeleting] = useState<ChatSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [stopping, setStopping] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);

  // The latest state and chat id for async callbacks (send, new chat, delete).
  const stateRef = useRef(state);
  const activeIdRef = useRef(activeId);
  useLayoutEffect(() => {
    stateRef.current = state;
    activeIdRef.current = activeId;
  });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const chat = activeId ? (state.chats[activeId] ?? null) : null;
  const run = activeId ? state.runs[activeId] : undefined;
  const running = !!run?.running;
  const messages = chat?.messages ?? NO_MESSAGES;
  const loading = !!activeId && !chat && loadError?.id !== activeId;

  const { scrollRef, contentRef, onScroll, atBottom, scrollToBottom } = useAutoScroll(activeId);
  const { ref: dockRef, height: dockHeight } = useElementHeight<HTMLDivElement>();

  // ---------- loading ----------
  // Both loaders never reject: errors show in the list and in the tools sheet.
  const loadList = useCallback(
    () =>
      chatsList().then(
        (chats) => {
          setList(chats);
          setListError(null);
          return chats;
        },
        (err) => {
          setListError(errorMessage(err));
          return null;
        },
      ),
    [],
  );

  const loadCatalog = useCallback(
    () =>
      toolsCatalog().then(
        (tools) => {
          setCatalog(tools);
          setCatalogError(null);
        },
        (err) => setCatalogError(errorMessage(err)),
      ),
    [],
  );

  useEffect(() => {
    void loadList().then((chats) => {
      if (chats) setActiveId((cur) => cur ?? chats[0]?.id ?? null);
    });
    void loadCatalog();
  }, [loadList, loadCatalog]);

  // Load the selected chat once; live chats stay in local state. A failed load
  // shows its error until the next try (the error is keyed by chat id).
  useEffect(() => {
    if (!activeId || stateRef.current.chats[activeId]) return;
    const id = activeId;
    chatGet(id)
      .then((loaded) => {
        setLoadError((e) => (e?.id === id ? null : e));
        if (!stateRef.current.chats[loaded.id]) dispatch({ type: "setChat", chat: loaded });
      })
      .catch((err) => setLoadError({ id, message: errorMessage(err) }));
  }, [activeId, reloadTick]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeId]);

  // ---------- chats ----------
  const createChat = useCallback(async (): Promise<string | null> => {
    setCreating(true);
    try {
      const created = await chatCreate();
      dispatch({ type: "setChat", chat: created });
      setList((l) => [summaryOf(created), ...(l ?? []).filter((c) => c.id !== created.id)]);
      setActiveId(created.id);
      activeIdRef.current = created.id;
      return created.id;
    } catch (err) {
      toast(`Could not start a new chat. ${errorMessage(err)}`, "error");
      return null;
    } finally {
      setCreating(false);
    }
  }, [toast]);

  const newChat = useCallback(async () => {
    const current = activeIdRef.current ? stateRef.current.chats[activeIdRef.current] : null;
    const currentRun = activeIdRef.current ? stateRef.current.runs[activeIdRef.current] : undefined;
    // The open chat is still empty: reuse it instead of making another one.
    if (current && current.messages.length === 0 && !currentRun?.running) {
      textareaRef.current?.focus();
      return;
    }
    if (await createChat()) textareaRef.current?.focus();
  }, [createChat]);

  // ⌘N starts a new chat.
  const onNewChatKey = useEffectEvent(() => void newChat());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNewChatKey();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function rename(id: string, title: string): Promise<boolean> {
    try {
      const saved = await chatRename(id, title);
      dispatch({ type: "patchChat", id, patch: { title: saved.title, updatedAt: saved.updatedAt } });
      setList((l) => l?.map((c) => (c.id === id ? { ...c, title: saved.title } : c)) ?? l);
      return true;
    } catch (err) {
      toast(`Could not rename the chat. ${errorMessage(err)}`, "error");
      return false;
    }
  }

  async function saveInstructions(text: string): Promise<string | null> {
    if (!activeId) return "No chat is open.";
    try {
      const saved = await chatSetInstructions(activeId, text);
      dispatch({ type: "patchChat", id: activeId, patch: { instructions: saved.instructions } });
      toast("Instructions saved.", "success");
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  }

  async function confirmDelete() {
    const target = deleting;
    if (!target) return;
    setDeleteBusy(true);
    try {
      if (stateRef.current.runs[target.id]?.running) await chatCancel(target.id).catch(() => undefined);
      await chatDelete(target.id);
      const remaining = (list ?? []).filter((c) => c.id !== target.id);
      setList(remaining);
      dispatch({ type: "removeChat", id: target.id });
      if (activeId === target.id) setActiveId(remaining[0]?.id ?? null);
      setDeleting(null);
    } catch (err) {
      toast(`Could not delete the chat. ${errorMessage(err)}`, "error");
    } finally {
      setDeleteBusy(false);
    }
  }

  // ---------- sending ----------
  const send = useCallback(
    async (text: string, images: string[]) => {
      let chatId = activeIdRef.current;
      let fresh = false;
      if (!chatId) {
        chatId = await createChat();
        if (!chatId) return;
        // The new chat is queued in the reducer but not rendered yet.
        fresh = true;
      }
      if (!fresh && !stateRef.current.chats[chatId]) {
        toast("This chat is still loading. Try again in a moment.");
        return;
      }
      if (!fresh && stateRef.current.runs[chatId]?.running) return;
      const id = chatId;
      dispatch({ type: "startRun", chatId: id, text, images, tempUser: blankMessage("user", { text, images }) });
      scrollToBottom();
      const onEvent = (event: AgentEvent) => dispatch({ type: "event", chatId: id, event });
      try {
        const final = await chatSend(id, text, images, onEvent);
        dispatch(final?.id ? { type: "finishRun", chatId: id, message: final } : { type: "finishRun", chatId: id });
      } catch (err) {
        dispatch({ type: "finishRun", chatId: id, error: errorMessage(err) });
      }
      setStopping((s) => ({ ...s, [id]: false }));
      // The engine may have given the chat a title.
      const chats = await loadList();
      const summary = chats?.find((c) => c.id === id);
      if (summary) dispatch({ type: "patchChat", id, patch: { title: summary.title, updatedAt: summary.updatedAt } });
    },
    [createChat, loadList, scrollToBottom, toast],
  );

  function submit() {
    const text = (drafts[activeId ?? NEW_KEY] ?? "").trim();
    const images = attachments.filter((a) => a.src).map((a) => a.src!);
    if (!text && images.length === 0) return;
    setDrafts((d) => ({ ...d, [activeId ?? NEW_KEY]: "" }));
    setAttachments([]);
    send(text, images);
  }

  function retryLive() {
    if (!activeId || !run) return;
    if (run.tempUserId) dispatch({ type: "removeMessage", chatId: activeId, messageId: run.tempUserId });
    dispatch({ type: "clearError", chatId: activeId });
    send(run.lastText, run.lastImages);
  }

  function retrySaved() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) send(lastUser.text, lastUser.images);
  }

  async function stop() {
    if (!activeId) return;
    const id = activeId;
    setStopping((s) => ({ ...s, [id]: true }));
    try {
      await chatCancel(id);
    } catch (err) {
      setStopping((s) => ({ ...s, [id]: false }));
      toast(`Could not stop the answer. ${errorMessage(err)}`, "error");
    }
  }

  const respond = useCallback(
    async (approvalId: string, decision: ApprovalDecision) => {
      try {
        await approvalRespond(approvalId, decision);
        if (decision === "always") {
          // The engine saved approval=always in the config; keep the store in sync
          // so a later config save does not undo it. (The config-changed event
          // does this too, so a failed read here is harmless.)
          getConfig()
            .then((fresh) => useApp.setState({ config: fresh }))
            .catch(() => undefined);
          void loadCatalog();
        }
        return true;
      } catch (err) {
        toast(`Could not send your answer. ${errorMessage(err)}`, "error");
        return false;
      }
    },
    [loadCatalog, toast],
  );

  // ---------- attachments ----------
  const addImagePaths = useCallback(
    (paths: string[]) => {
      const items = paths.map((p) => ({ id: newId(), src: null, name: baseName(p), loading: true }));
      setAttachments((a) => [...a, ...items]);
      items.forEach((item, i) => {
        readImageDataUrl(paths[i])
          .then((src) => setAttachments((a) => a.map((x) => (x.id === item.id ? { ...x, src, loading: false } : x))))
          .catch((err) => {
            setAttachments((a) => a.filter((x) => x.id !== item.id));
            toast(`Could not read ${item.name}. ${errorMessage(err)}`, "error");
          });
      });
    },
    [toast],
  );

  function addFiles(files: File[]) {
    const items = files.map((f) => ({ id: newId(), src: null, name: f.name || "Pasted image", loading: true }));
    setAttachments((a) => [...a, ...items]);
    items.forEach((item, i) => {
      readFileAsDataUrl(files[i])
        .then((src) => setAttachments((a) => a.map((x) => (x.id === item.id ? { ...x, src, loading: false } : x))))
        .catch((err) => {
          setAttachments((a) => a.filter((x) => x.id !== item.id));
          toast(`Could not read ${item.name}. ${errorMessage(err)}`, "error");
        });
    });
  }

  async function pickImages() {
    try {
      const paths = await pickImagePaths();
      if (paths.length) addImagePaths(paths);
    } catch (err) {
      toast(`Could not open the file picker. ${errorMessage(err)}`, "error");
    }
  }

  const dropOver = useImageFileDrop(addImagePaths);

  // ---------- derived ----------
  const dangerousTools = useMemo(() => new Set((catalog ?? []).filter((t) => t.dangerous).map((t) => t.id)), [catalog]);
  const runningIds = useMemo(
    () =>
      new Set(
        Object.entries(state.runs)
          .filter(([, r]) => r.running)
          .map(([id]) => id),
      ),
    [state.runs],
  );

  const toolsOff = config?.chatDefaults.toolsEnabled === false;
  const toolsLabel = useMemo(() => {
    if (toolsOff) return "Tools off";
    if (!catalog) return "Tools";
    const tools = catalog.filter((t) => t.enabled && t.source !== "skill").length;
    const skills = Object.values(config?.skills ?? {}).filter((s) => s.mode !== "off").length;
    return skills > 0 ? `${pluralize(tools, "tool")} · ${pluralize(skills, "skill")}` : pluralize(tools, "tool");
  }, [catalog, config, toolsOff]);

  const context: ContextUse | null = useMemo(() => {
    if (!activeId) return null;
    const live = state.context[activeId];
    if (live) return live;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.usage);
    const size = config?.contextSize || fmContextSize || 0;
    return lastAssistant?.usage && size ? { used: lastAssistant.usage.totalTokens, size } : null;
  }, [activeId, state.context, messages, config?.contextSize, fmContextSize]);

  const lastMessage = messages[messages.length - 1];
  const showWelcome = (list !== null && !activeId) || (!!chat && messages.length === 0 && !running);
  const draft = drafts[activeId ?? NEW_KEY] ?? "";

  return (
    <div className="page cv-page">
      <div className="split">
        <ChatList
          chats={list}
          error={listError}
          onRetry={loadList}
          activeId={activeId}
          runningIds={runningIds}
          creating={creating}
          onSelect={setActiveId}
          onNew={newChat}
          onRename={rename}
          onDelete={setDeleting}
        />

        <section
          className="split__detail cv-detail"
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
          <ChatHeader
            chat={chat}
            context={context}
            toolsLabel={toolsLabel}
            toolsOff={toolsOff}
            onRename={(title) => (activeId ? rename(activeId, title) : Promise.resolve(false))}
            onSaveInstructions={saveInstructions}
            onOpenTools={() => {
              setShowTools(true);
              loadCatalog();
            }}
          />

          <div className="cv-scroll" ref={scrollRef} onScroll={onScroll}>
            <div className="cv-thread" ref={contentRef} style={{ paddingBottom: dockHeight + 28 }}>
              {loading && (
                <div className="cv-center">
                  <Spinner />
                </div>
              )}
              {loadError && loadError.id === activeId && (
                <Callout tone="error">
                  <div>Could not open this chat.</div>
                  <div className="xsmall selectable" style={{ marginTop: 4 }}>
                    {loadError.message}
                  </div>
                  <Button
                    size="sm"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      setLoadError(null);
                      setReloadTick((t) => t + 1);
                    }}
                  >
                    Try again
                  </Button>
                </Callout>
              )}
              {showWelcome && (
                <Welcome onPick={(text) => send(text, [])} disabled={!ready.ready || creating} toolsOff={toolsOff} />
              )}
              {(messages.length > 0 || running) && (
                <div className="cv-thread__messages" key={activeId ?? NEW_KEY}>
                  {messages.map((m, i) =>
                    m.role === "user" ? (
                      <UserMessage key={i} text={m.text} images={m.images} pending={running && isTempId(m.id)} />
                    ) : (
                      <AssistantMessage
                        key={i}
                        message={m}
                        streaming={running && m.id === run?.liveId}
                        status={m.id === run?.liveId ? (run?.status ?? null) : null}
                        approvals={m.id === run?.liveId ? run?.approvals : undefined}
                        dangerousTools={dangerousTools}
                        onRespond={respond}
                        onRetry={!running && m === lastMessage && m.error ? retrySaved : undefined}
                      />
                    ),
                  )}
                  {running && !run?.liveId && (
                    <div className="cv-msg cv-msg--assistant">
                      <StatusLine text={run?.status || "Thinking…"} />
                    </div>
                  )}
                </div>
              )}
              {!running && run?.error && (
                <MessageError text={run.error} onRetry={ready.ready ? retryLive : undefined} />
              )}
            </div>
          </div>

          {!atBottom && (
            <button
              type="button"
              className="cv-tobottom"
              style={{ bottom: dockHeight + 10 }}
              title="Scroll to the newest message"
              aria-label="Scroll to the newest message"
              onClick={() => scrollToBottom(true)}
            >
              <ArrowDown size={15} />
            </button>
          )}

          <div className="cv-dock" ref={dockRef}>
            <Composer
              textareaRef={textareaRef}
              value={draft}
              onChange={(v) => setDrafts((d) => ({ ...d, [activeId ?? NEW_KEY]: v }))}
              onSubmit={submit}
              onStop={stop}
              running={running}
              stopping={!!(activeId && stopping[activeId])}
              ready={ready}
              blockedReason={loading ? "This chat is still loading." : creating ? "Starting a new chat…" : null}
              attachments={attachments}
              onRemoveAttachment={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
              onAttach={pickImages}
              onPasteFiles={addFiles}
              placeholder={chat && messages.length > 0 ? "Reply" : "Ask anything"}
            />
          </div>

          {dropOver && (
            <div className="cv-drop">
              <ImagePlus size={28} />
              <div>Drop images to attach them</div>
            </div>
          )}
        </section>
      </div>

      {showTools && (
        <ToolsModal
          catalog={catalog}
          error={catalogError}
          reload={loadCatalog}
          setCatalog={setCatalog}
          onClose={() => setShowTools(false)}
        />
      )}

      {deleting && (
        <Modal
          title="Delete this chat?"
          onClose={() => !deleteBusy && setDeleting(null)}
          footer={
            <>
              <div className="spacer" />
              <Button onClick={() => setDeleting(null)} disabled={deleteBusy}>
                Cancel
              </Button>
              <Button variant="danger" loading={deleteBusy} onClick={confirmDelete}>
                Delete
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            “{deleting.title || "New chat"}” and all its messages will be deleted. You cannot undo this.
          </p>
        </Modal>
      )}
    </div>
  );
}
