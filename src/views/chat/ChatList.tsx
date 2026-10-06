// Left column of the Chat view: new chat, search, and the chat list with
// inline rename and delete.

import { MessageSquare, Pencil, Search, SquarePen, Trash } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button, IconButton, Spinner } from "../../components/ui";
import { cx } from "../../lib/cx";
import { formatTime, pluralize } from "../../lib/format";
import type { ChatSummary } from "../../lib/types";

export function ChatList(props: {
  chats: ChatSummary[] | null;
  error: string | null;
  onRetry: () => void;
  activeId: string | null;
  runningIds: Set<string>;
  creating: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<boolean>;
  onDelete: (chat: ChatSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!props.chats || !q) return props.chats ?? [];
    return props.chats.filter((c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q));
  }, [props.chats, query]);

  function startEdit(chat: ChatSummary) {
    cancelled.current = false;
    setEditingId(chat.id);
    setDraft(chat.title);
  }

  async function commitEdit(chat: ChatSummary) {
    const title = draft.trim();
    setEditingId(null);
    if (cancelled.current) return;
    if (!title || title === chat.title) return;
    await props.onRename(chat.id, title);
  }

  return (
    <aside className="split__list cv-list">
      <div className="cv-list__header" data-tauri-drag-region>
        <span className="cv-list__title" data-tauri-drag-region>
          Chats
        </span>
        <div className="spacer" data-tauri-drag-region />
        <IconButton label="New chat (⌘N)" onClick={props.onNew} disabled={props.creating}>
          {props.creating ? <Spinner /> : <SquarePen size={16} />}
        </IconButton>
      </div>
      <div className="cv-search">
        <Search size={13} />
        <input
          className="cv-search__input"
          placeholder="Search"
          aria-label="Search chats"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        />
      </div>

      <div className="cv-list__rows">
        {props.error && (
          <div className="cv-list__note">
            <div className="small">Could not load chats.</div>
            <div className="xsmall muted selectable">{props.error}</div>
            <Button size="sm" onClick={props.onRetry}>
              Try again
            </Button>
          </div>
        )}
        {!props.error && props.chats === null && (
          <div className="cv-list__note">
            <Spinner />
          </div>
        )}
        {props.chats && props.chats.length === 0 && !props.error && (
          <div className="cv-list__note">
            <MessageSquare size={20} />
            <div className="small muted">No chats yet. Start one with the button above or press ⌘N.</div>
          </div>
        )}
        {props.chats && props.chats.length > 0 && filtered.length === 0 && (
          <div className="cv-list__note small muted">No chats match “{query}”.</div>
        )}
        {filtered.map((chat) => {
          const active = chat.id === props.activeId;
          const editing = chat.id === editingId;
          const running = props.runningIds.has(chat.id);
          return (
            <div
              key={chat.id}
              role="button"
              tabIndex={0}
              aria-current={active ? "true" : undefined}
              className={cx("list-row cv-row", active && "list-row--active", editing && "cv-row--editing")}
              onClick={() => !editing && props.onSelect(chat.id)}
              onDoubleClick={() => startEdit(chat)}
              onKeyDown={(e) => {
                // Keys typed in the rename field or on the row buttons belong to them.
                if (editing || e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  props.onSelect(chat.id);
                }
                if (e.key === "F2") startEdit(chat);
              }}
            >
              <div className="cv-row__top">
                {editing ? (
                  <input
                    className="input cv-row__input"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => commitEdit(chat)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        cancelled.current = true;
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <span className="list-row__title">{chat.title || "New chat"}</span>
                )}
                {!editing && <span className="cv-row__time">{running ? <Spinner /> : formatTime(chat.updatedAt)}</span>}
              </div>
              {!editing && (
                <div className="list-row__meta">
                  {chat.preview ||
                    (chat.messageCount === 0 ? "No messages yet" : pluralize(chat.messageCount, "message"))}
                </div>
              )}
              {!editing && (
                <div className="cv-row__actions" onClick={(e) => e.stopPropagation()}>
                  <IconButton label="Rename" onClick={() => startEdit(chat)}>
                    <Pencil size={13} />
                  </IconButton>
                  <IconButton label="Delete" onClick={() => props.onDelete(chat)}>
                    <Trash size={13} />
                  </IconButton>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
