// CLI sessions in ~/.fm/sessions, shared with `fm chat`. Browse, rename,
// delete, and keep talking with `fm respond --resume`. OWNER: agent "ui-chat".

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, ImagePlus, MessagesSquare, Pencil, RefreshCw, ScrollText, Search, SquarePen, SquareTerminal, Trash } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, CommandPreview, CopyButton, IconButton, Spinner, cx, formatTime } from "../components/ui";
import {
  cliSessionDelete,
  cliSessionNewPath,
  cliSessionRead,
  cliSessionRename,
  cliSessionsList,
  errorMessage,
  fmCancel,
  fmRun,
  newId,
  openInTerminal,
  readImageDataUrl,
  saveTempFile,
} from "../lib/api";
import { displayCommand, respondArgs, validateRespond, type RespondOptions } from "../lib/fmArgs";
import { useApp } from "../lib/store";
import type { CliSession, ParsedTranscript, RunResult } from "../lib/types";
import { Composer, type ComposerAttachment } from "./chat/Composer";
import { useAutoScroll, useElementHeight, useImageFileDrop } from "./chat/hooks";
import { AnswerText, ImageThumbs, MessageError, StatusLine, UserMessage } from "./chat/Messages";
import { useModelReady } from "./chat/ModelReady";
import { basename, imageFiles, pickImagePaths, pluralize, readFileAsDataUrl } from "./chat/utils";
import { NewSessionModal } from "./sessions/NewSessionModal";
import { DEFAULT_CLI_OPTIONS, RunOptionsButton, type CliRunOptions } from "./sessions/RunOptions";
import { DeleteSessionModal, RenameSessionModal } from "./sessions/SessionModals";
import "./chat/chat.css";
import "./sessions/sessions.css";

interface CliAttachment extends ComposerAttachment {
  /** File passed to `--image`. Null while a pasted image is being saved. */
  path: string | null;
}

interface ActiveRun {
  runId: string;
  sessionName: string;
  prompt: string;
  images: string[];
  output: string;
  stderr: string;
  command: string;
}

interface RunFailure {
  sessionName: string;
  text: string;
  detail: string;
  license: boolean;
}

function describeFailure(result: RunResult): Omit<RunFailure, "sessionName"> {
  const detail = result.stderr.trim();
  if (result.exitCode === 69) {
    return { text: "The fm license is not agreed yet. Agree to it first, then try again.", detail, license: true };
  }
  if (/exceeded the model's context size/i.test(detail)) {
    return {
      text: "This session is longer than the model's context window. Start a new session to keep going.",
      detail,
      license: false,
    };
  }
  if (result.error) return { text: result.error, detail, license: false };
  return { text: `fm stopped with exit code ${result.exitCode}.`, detail, license: false };
}

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop();
  if (file.name.includes(".") && fromName) return fromName.toLowerCase();
  return file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
}

export default function SessionsView() {
  const toast = useApp((s) => s.toast);
  const navigate = useApp((s) => s.navigate);
  const fmPath = useApp((s) => s.config?.fmPath ?? "/usr/bin/fm");
  const sessionsDir = useApp((s) => s.paths?.cliSessionsDir ?? null);
  const ready = useModelReady();

  const [sessions, setSessions] = useState<CliSession[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingNew, setPendingNew] = useState<CliSession | null>(null);
  const [transcript, setTranscript] = useState<{ name: string; data: ParsedTranscript } | null>(null);
  const [transcriptError, setTranscriptError] = useState<{ name: string; message: string } | null>(null);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  const [stopping, setStopping] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<CliAttachment[]>([]);
  const [options, setOptions] = useState<CliRunOptions>(DEFAULT_CLI_OPTIONS);
  const [renaming, setRenaming] = useState<CliSession | null>(null);
  const [deleting, setDeleting] = useState<CliSession | null>(null);
  const [showNew, setShowNew] = useState(false);

  const { scrollRef, contentRef, onScroll, scrollToBottom } = useAutoScroll(selected);
  const dock = useElementHeight<HTMLDivElement>();

  const onDisk = useCallback((name: string | null) => !!name && !!sessions?.some((s) => s.name === name), [sessions]);
  const session = useMemo(
    () => sessions?.find((s) => s.name === selected) ?? (pendingNew && pendingNew.name === selected ? pendingNew : null),
    [sessions, selected, pendingNew],
  );
  const isPendingNew = !!session && session === pendingNew && !onDisk(session.name);
  const runHere = !!run && run.sessionName === selected;

  // ---------- loading ----------
  const loadList = useCallback(async (): Promise<CliSession[] | null> => {
    try {
      const list = await cliSessionsList();
      setSessions(list);
      setListError(null);
      return list;
    } catch (err) {
      setListError(errorMessage(err));
      return null;
    }
  }, []);

  const loadTranscript = useCallback(async (name: string) => {
    setTranscriptError(null);
    try {
      const data = await cliSessionRead(name);
      setTranscript({ name, data });
      return true;
    } catch (err) {
      setTranscriptError({ name, message: errorMessage(err) });
      return false;
    }
  }, []);

  useEffect(() => {
    loadList().then((list) => {
      if (list) setSelected((cur) => cur ?? list[0]?.name ?? null);
    });
  }, [loadList]);

  useEffect(() => {
    if (!selected || (pendingNew?.name === selected && !onDisk(selected))) return;
    // Only when the selection changes; runs reload the transcript themselves.
    loadTranscript(selected);
  }, [selected, loadTranscript]);

  async function refresh() {
    setRefreshing(true);
    const list = await loadList();
    if (list && selected && list.some((s) => s.name === selected)) await loadTranscript(selected);
    setRefreshing(false);
  }

  function select(name: string) {
    if (pendingNew && name !== pendingNew.name && run?.sessionName !== pendingNew.name) setPendingNew(null);
    if (failure && failure.sessionName !== name) setFailure(null);
    setSelected(name);
  }

  // ---------- running fm ----------
  async function runFm(args: string[], ctx: { sessionName: string; prompt: string; images: string[] }) {
    const runId = newId();
    setFailure(null);
    setRun({ runId, ...ctx, output: "", stderr: "", command: displayCommand(args, fmPath) });
    scrollToBottom();
    let ok = false;
    try {
      const result = await fmRun(
        args,
        (e) =>
          setRun((r) => {
            if (!r || r.runId !== runId) return r;
            if (e.kind === "stdout") return { ...r, output: r.output + e.text };
            if (e.kind === "stderr") return { ...r, stderr: r.stderr + e.text };
            return { ...r, command: e.command };
          }),
        runId,
      );
      if (result.cancelled) ok = true;
      else if (result.error || result.exitCode !== 0) setFailure({ sessionName: ctx.sessionName, ...describeFailure(result) });
      else ok = true;
    } catch (err) {
      setFailure({ sessionName: ctx.sessionName, text: errorMessage(err), detail: "", license: false });
    }
    const list = await loadList();
    if (list?.some((s) => s.name === ctx.sessionName)) {
      await loadTranscript(ctx.sessionName);
      setPendingNew((p) => (p?.name === ctx.sessionName ? null : p));
    }
    setRun(null);
    setStopping(false);
    return ok;
  }

  async function stop() {
    if (!run) return;
    setStopping(true);
    try {
      await fmCancel(run.runId);
    } catch (err) {
      setStopping(false);
      toast(`Could not stop fm. ${errorMessage(err)}`, "error");
    }
  }

  const composerOptions: RespondOptions | null = session
    ? {
        prompt: draft.trim(),
        resumePath: session.path,
        saveTranscriptPath: session.path,
        tools: options.tools,
        greedy: options.greedy,
        useCase: options.useCase,
        images: attachments.filter((a) => a.path).map((a) => ({ path: a.path! })),
      }
    : null;
  const previewCommand = composerOptions ? displayCommand(respondArgs(composerOptions), fmPath) : "";

  async function submit() {
    if (!session || !composerOptions || run) return;
    const problems = validateRespond(composerOptions);
    if (problems.length) {
      toast(problems[0], "error");
      return;
    }
    const prompt = composerOptions.prompt;
    const images = attachments.filter((a) => a.path && a.src).map((a) => a.src!);
    setDraft("");
    setAttachments([]);
    const ok = await runFm(respondArgs(composerOptions), { sessionName: session.name, prompt, images });
    // Give the text back so the user can try again.
    if (!ok) setDraft((d) => d || prompt);
  }

  async function startNew(instructions: string, prompt: string): Promise<string | null> {
    const problems = validateRespond({ instructions, prompt });
    if (problems.length) return problems[0];
    let path: string;
    try {
      path = await cliSessionNewPath(prompt);
    } catch (err) {
      return `Could not make a file for the session. ${errorMessage(err)}`;
    }
    const name = basename(path).replace(/\.json$/i, "");
    const fresh: CliSession = { name, path, modifiedMs: Date.now(), sizeBytes: 0, preview: prompt, turns: 0 };
    setPendingNew(fresh);
    setSelected(name);
    setTranscript({ name, data: { modelName: null, instructions: instructions || null, messages: [], systemVersion: null } });
    setTranscriptError(null);
    setShowNew(false);
    const args = respondArgs({
      instructions,
      prompt,
      saveTranscriptPath: path,
      tools: options.tools,
      greedy: options.greedy,
      useCase: options.useCase,
    });
    runFm(args, { sessionName: name, prompt, images: [] });
    return null;
  }

  // ---------- session actions ----------
  const resumeCommand = session ? displayCommand(["chat", "--resume", session.name], fmPath) : "";

  async function openTerminal() {
    try {
      await openInTerminal(resumeCommand);
    } catch (err) {
      toast(`Could not open Terminal. ${errorMessage(err)}`, "error");
    }
  }

  async function reveal() {
    if (!session) return;
    try {
      await revealItemInDir(session.path);
    } catch (err) {
      toast(`Could not show the file in Finder. ${errorMessage(err)}`, "error");
    }
  }

  async function rename(from: string, to: string): Promise<string | null> {
    try {
      await cliSessionRename(from, to);
    } catch (err) {
      return errorMessage(err);
    }
    setRenaming(null);
    await loadList();
    setSelected(to);
    toast("Session renamed.", "success");
    return null;
  }

  async function remove(target: CliSession): Promise<string | null> {
    try {
      await cliSessionDelete(target.name);
    } catch (err) {
      return errorMessage(err);
    }
    setDeleting(null);
    const list = await loadList();
    if (selected === target.name) {
      setTranscript(null);
      setSelected(list?.[0]?.name ?? null);
    }
    return null;
  }

  // ---------- attachments ----------
  const patchAttachment = (id: string, patch: Partial<CliAttachment>) =>
    setAttachments((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const addPaths = useCallback((paths: string[]) => {
    const items: CliAttachment[] = paths.map((p) => ({ id: newId(), path: p, src: null, name: basename(p), loading: true }));
    setAttachments((a) => [...a, ...items]);
    for (const item of items) {
      // The preview is only for show; fm reads the file itself.
      readImageDataUrl(item.path!)
        .then((src) => patchAttachment(item.id, { src, loading: false }))
        .catch(() => patchAttachment(item.id, { loading: false }));
    }
  }, []);

  function addFiles(files: File[]) {
    files.forEach((file, i) => {
      const id = newId();
      const name = `pasted-${Date.now()}-${i}.${extensionFor(file)}`;
      setAttachments((a) => [...a, { id, path: null, src: null, name, loading: true }]);
      readFileAsDataUrl(file)
        .then(async (src) => {
          patchAttachment(id, { src });
          const path = await saveTempFile(name, src);
          patchAttachment(id, { path, loading: false });
        })
        .catch((err) => {
          setAttachments((a) => a.filter((x) => x.id !== id));
          toast(`Could not attach the image. ${errorMessage(err)}`, "error");
        });
    });
  }

  async function pickImages() {
    try {
      const paths = await pickImagePaths();
      if (paths.length) addPaths(paths);
    } catch (err) {
      toast(`Could not open the file picker. ${errorMessage(err)}`, "error");
    }
  }

  const dropOver = useImageFileDrop(addPaths, !!session && !isPendingNew);

  // ---------- render ----------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!sessions || !q) return sessions ?? [];
    return sessions.filter((s) => s.name.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q));
  }, [sessions, query]);

  const shownTranscript = transcript && transcript.name === selected ? transcript.data : null;
  const showFailure = failure && failure.sessionName === selected ? failure : null;
  const blockedReason = !session
    ? "Pick a session first."
    : isPendingNew
      ? runHere
        ? "The first answer is still running."
        : "This session was not saved. Start a new one."
      : run && !runHere
        ? "Another fm command is running. Wait for it to finish."
        : null;

  return (
    <div className="page sv-page">
      <div className="split">
        <aside className="split__list cv-list">
          <div className="cv-list__header" data-tauri-drag-region>
            <span className="cv-list__title" data-tauri-drag-region>
              CLI Sessions
            </span>
            <div className="spacer" data-tauri-drag-region />
            <IconButton label="Refresh" onClick={refresh} disabled={refreshing}>
              {refreshing ? <Spinner /> : <RefreshCw size={15} />}
            </IconButton>
            <IconButton label="New CLI session" onClick={() => setShowNew(true)} disabled={!!run}>
              <SquarePen size={16} />
            </IconButton>
          </div>
          <div className="cv-search">
            <Search size={13} />
            <input
              className="cv-search__input"
              placeholder="Search"
              value={query}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
          </div>
          <div className="cv-list__rows">
            {listError && (
              <div className="cv-list__note">
                <div className="small">Could not read ~/.fm/sessions.</div>
                <div className="xsmall muted selectable">{listError}</div>
                <Button size="sm" onClick={refresh}>
                  Try again
                </Button>
              </div>
            )}
            {!listError && sessions === null && (
              <div className="cv-list__note">
                <Spinner />
              </div>
            )}
            {pendingNew && !onDisk(pendingNew.name) && (
              <div
                className={cx("list-row cv-row", selected === pendingNew.name && "list-row--active")}
                onClick={() => select(pendingNew.name)}
              >
                <div className="cv-row__top">
                  <span className="list-row__title">{pendingNew.name}</span>
                  <span className="cv-row__time">{run?.sessionName === pendingNew.name ? <Spinner /> : "Not saved"}</span>
                </div>
                <div className="list-row__meta">{pendingNew.preview}</div>
              </div>
            )}
            {sessions && sessions.length === 0 && !listError && !pendingNew && (
              <div className="cv-list__note">
                <MessagesSquare size={20} />
                <div className="small muted">No sessions yet. Start one here or run fm chat in Terminal.</div>
              </div>
            )}
            {sessions && sessions.length > 0 && filtered.length === 0 && (
              <div className="cv-list__note small muted">No sessions match “{query}”.</div>
            )}
            {filtered.map((s) => (
              <div
                key={s.path}
                role="button"
                tabIndex={0}
                className={cx("list-row cv-row", s.name === selected && "list-row--active")}
                onClick={() => select(s.name)}
                onKeyDown={(e) => e.key === "Enter" && select(s.name)}
              >
                <div className="cv-row__top">
                  <span className="list-row__title">{s.name}</span>
                  <span className="cv-row__time">
                    {run?.sessionName === s.name ? <Spinner /> : formatTime(s.modifiedMs)}
                  </span>
                </div>
                <div className="list-row__meta">{s.preview || "No messages"}</div>
                <div className="list-row__meta sv-row__turns">{pluralize(s.turns, "turn")}</div>
              </div>
            ))}
          </div>
        </aside>

        <section
          className="split__detail cv-detail"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            const files = imageFiles(e.dataTransfer.files);
            if (files.length && session && !isPendingNew) {
              e.preventDefault();
              addFiles(files);
            }
          }}
        >
          <header className="cv-header" data-tauri-drag-region>
            <div className="cv-header__titles" data-tauri-drag-region>
              <div className="cv-title cv-title--static sv-title">{session?.name ?? "CLI Sessions"}</div>
              <div className="cv-header__sub" data-tauri-drag-region>
                {session
                  ? isPendingNew
                    ? "New session"
                    : `${pluralize(session.turns, "turn")} · Saved ${formatTime(session.modifiedMs)}`
                  : "Chats you have with fm chat in Terminal"}
              </div>
            </div>
            {session && !isPendingNew && (
              <div className="cv-header__actions">
                <Button size="sm" icon={<SquareTerminal size={13} />} onClick={openTerminal} title={resumeCommand}>
                  <span className="cv-wide-only">Open in Terminal</span>
                </Button>
                <IconButton label="Rename" onClick={() => setRenaming(session)} disabled={runHere}>
                  <Pencil size={15} />
                </IconButton>
                <IconButton label="Show in Finder" onClick={reveal}>
                  <FolderOpen size={15} />
                </IconButton>
                <IconButton label="Delete" onClick={() => setDeleting(session)} disabled={runHere}>
                  <Trash size={15} />
                </IconButton>
              </div>
            )}
          </header>

          <div className="cv-scroll" ref={scrollRef} onScroll={onScroll}>
            <div className="cv-thread" ref={contentRef} style={{ paddingBottom: dock.height + 28 }}>
              {!session && sessions !== null && (
                <div className="sv-empty">
                  <div className="cv-welcome__icon">
                    <SquareTerminal size={26} />
                  </div>
                  <h1 className="cv-welcome__title">CLI sessions</h1>
                  <p className="cv-welcome__text">
                    When you chat with <span className="mono">fm chat</span> in Terminal, each session is saved in
                    ~/.fm/sessions. Read them here, keep talking, or open them again in Terminal with{" "}
                    <span className="mono">fm chat --resume</span>.
                  </p>
                  <Button variant="primary" icon={<SquarePen size={14} />} onClick={() => setShowNew(true)} disabled={!!run}>
                    New CLI session
                  </Button>
                </div>
              )}

              {session && (
                <div className="sv-thread" key={session.name}>
                  {!isPendingNew && (
                    <div className="sv-banner">
                      <div className="sv-banner__text">
                        <SquareTerminal size={13} />
                        <span>
                          Shared with <span className="mono">fm chat</span>. Continue it in Terminal with:
                        </span>
                      </div>
                      <CommandPreview command={resumeCommand} />
                    </div>
                  )}

                  {transcriptError && transcriptError.name === selected && (
                    <Callout tone="error">
                      <div>Could not read this session.</div>
                      <div className="xsmall selectable" style={{ marginTop: 4 }}>
                        {transcriptError.message}
                      </div>
                      <Button size="sm" style={{ marginTop: 8 }} onClick={() => loadTranscript(session.name)}>
                        Try again
                      </Button>
                    </Callout>
                  )}

                  {!shownTranscript && !transcriptError && !isPendingNew && (
                    <div className="cv-center">
                      <Spinner />
                    </div>
                  )}

                  {shownTranscript?.instructions && (
                    <div className="sv-instructions">
                      <div className="sv-instructions__label">
                        <ScrollText size={12} />
                        Instructions
                      </div>
                      <div className="sv-instructions__text selectable">{shownTranscript.instructions}</div>
                    </div>
                  )}

                  {shownTranscript && shownTranscript.messages.length === 0 && !runHere && !showFailure && (
                    <div className="small muted sv-note">No messages in this session yet.</div>
                  )}

                  {shownTranscript?.messages.map((m, i) =>
                    m.role === "user" ? (
                      <UserMessage key={m.id || i} text={m.text} images={m.images} />
                    ) : m.role === "response" ? (
                      <div key={m.id || i} className="cv-msg cv-msg--assistant">
                        <ImageThumbs images={m.images} />
                        <AnswerText text={m.text} />
                        {m.text && (
                          <div className="cv-msg__footer">
                            <span className="cv-msg__copy">
                              <CopyButton text={m.text} label="Copy answer" />
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div key={m.id || i} className="sv-other">
                        <div className="sv-other__role">{m.role}</div>
                        <div className="selectable">{m.text}</div>
                      </div>
                    ),
                  )}

                  {runHere && run && (
                    <>
                      <UserMessage text={run.prompt} images={run.images} pending />
                      <div className="cv-msg cv-msg--assistant">
                        {run.output ? <AnswerText text={run.output} streaming /> : <StatusLine text="Waiting for fm…" />}
                      </div>
                    </>
                  )}

                  {showFailure && (
                    <div className="stack" style={{ gap: 8 }}>
                      <MessageError text={showFailure.text} />
                      {showFailure.license && (
                        <div>
                          <Button size="sm" onClick={() => navigate("setup")}>
                            Open Setup Guide
                          </Button>
                        </div>
                      )}
                      {showFailure.detail && <pre className="sv-stderr selectable">{showFailure.detail}</pre>}
                    </div>
                  )}

                  {shownTranscript?.modelName && !runHere && (
                    <div className="sv-meta">
                      {shownTranscript.modelName}
                      {shownTranscript.systemVersion ? ` · ${shownTranscript.systemVersion}` : ""}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="cv-dock" ref={dock.ref} style={{ display: session ? undefined : "none" }}>
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={submit}
              onStop={stop}
              running={runHere}
              stopping={stopping}
              ready={ready}
              blockedReason={blockedReason}
              attachments={attachments}
              onRemoveAttachment={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
              onAttach={pickImages}
              onPasteFiles={addFiles}
              placeholder={isPendingNew ? "Wait for the first answer" : "Continue this session"}
              toolbar={<RunOptionsButton value={options} onChange={setOptions} disabled={runHere} />}
              top={
                session && !isPendingNew ? (
                  <div className="sv-command">
                    <CommandPreview command={runHere && run ? run.command : previewCommand} />
                  </div>
                ) : undefined
              }
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

      {showNew && (
        <NewSessionModal
          options={options}
          fmPath={fmPath}
          sessionsDir={sessionsDir}
          ready={ready}
          onStart={startNew}
          onClose={() => setShowNew(false)}
        />
      )}
      {renaming && (
        <RenameSessionModal
          session={renaming}
          existing={(sessions ?? []).map((s) => s.name)}
          onRename={(to) => rename(renaming.name, to)}
          onClose={() => setRenaming(null)}
        />
      )}
      {deleting && (
        <DeleteSessionModal session={deleting} onDelete={() => remove(deleting)} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}
