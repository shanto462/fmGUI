//! Agent chat storage: one JSON file per chat in `<data>/chats/<id>.json`.
//! OWNER: agent "engine".

use super::{Chat, ChatSummary};
use crate::util::{new_id, now_ms};
use std::path::{Path, PathBuf};

/// Title of a chat that has no user message yet.
pub const NEW_CHAT_TITLE: &str = "New chat";
const TITLE_MAX: usize = 48;
const PREVIEW_MAX: usize = 120;

/// Chat ids are UUIDs; anything else could escape the folder.
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn chat_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("This chat id is not valid.".into());
    }
    Ok(dir.join(format!("{id}.json")))
}

pub fn create(dir: &Path, instructions: &str) -> Result<Chat, String> {
    let now = now_ms();
    let chat = Chat {
        id: new_id(),
        title: NEW_CHAT_TITLE.into(),
        created_at: now,
        updated_at: now,
        instructions: instructions.to_string(),
        messages: Vec::new(),
    };
    save(dir, &chat)?;
    Ok(chat)
}

pub fn load(dir: &Path, id: &str) -> Result<Chat, String> {
    let path = chat_path(dir, id)?;
    let bytes = std::fs::read(&path).map_err(|_| "This chat was not found. It may have been deleted.".to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("This chat file is damaged: {e}"))
}

/// Atomic write: temp file + rename.
pub fn save(dir: &Path, chat: &Chat) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create the chats folder: {e}"))?;
    let path = chat_path(dir, &chat.id)?;
    let json = serde_json::to_vec_pretty(chat).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".{}.{}.tmp", chat.id, &new_id()[..8]));
    std::fs::write(&tmp, json).map_err(|e| format!("Could not save the chat: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save the chat: {e}")
    })
}

pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    let path = chat_path(dir, id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete the chat: {e}")),
    }
}

pub fn rename(dir: &Path, id: &str, title: &str) -> Result<Chat, String> {
    let mut chat = load(dir, id)?;
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    chat.title = if title.is_empty() { NEW_CHAT_TITLE.into() } else { title };
    chat.updated_at = now_ms();
    save(dir, &chat)?;
    Ok(chat)
}

pub fn set_instructions(dir: &Path, id: &str, instructions: &str) -> Result<Chat, String> {
    let mut chat = load(dir, id)?;
    chat.instructions = instructions.to_string();
    chat.updated_at = now_ms();
    save(dir, &chat)?;
    Ok(chat)
}

/// All chats, newest first. Broken files are skipped.
pub fn list(dir: &Path) -> Vec<ChatSummary> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<ChatSummary> = entries
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.ends_with(".json") && !name.starts_with('.')
        })
        .filter_map(|e| std::fs::read(e.path()).ok())
        .filter_map(|bytes| serde_json::from_slice::<Chat>(&bytes).ok())
        .map(|chat| summary(&chat))
        .collect();
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.id.cmp(&b.id)));
    out
}

pub fn summary(chat: &Chat) -> ChatSummary {
    let preview = chat
        .messages
        .iter()
        .rev()
        .find(|m| !m.text.trim().is_empty())
        .map(|m| shorten(&m.text, PREVIEW_MAX))
        .unwrap_or_default();
    ChatSummary {
        id: chat.id.clone(),
        title: chat.title.clone(),
        updated_at: chat.updated_at,
        message_count: chat.messages.len() as u32,
        preview,
    }
}

/// Title from the first user message: one line, at most 48 characters.
pub fn title_from(text: &str) -> String {
    let t = shorten(text, TITLE_MAX);
    if t.is_empty() {
        NEW_CHAT_TITLE.into()
    } else {
        t
    }
}

/// Whitespace collapsed to single spaces, cut at a word end when possible.
pub fn shorten(text: &str, max: usize) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= max {
        return one_line;
    }
    let cut: String = one_line.chars().take(max.saturating_sub(1)).collect();
    let cut = match cut.rfind(' ') {
        Some(pos) if pos > max / 2 => cut[..pos].to_string(),
        _ => cut,
    };
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::ChatMessage;

    #[test]
    fn create_save_list_delete() {
        let dir = tempfile::tempdir().unwrap();
        let mut a = create(dir.path(), "Be brief.").unwrap();
        let mut b = create(dir.path(), "").unwrap();
        a.updated_at = 10;
        a.messages.push(ChatMessage { role: "user".into(), text: "Hello there\nfriend".into(), ..Default::default() });
        save(dir.path(), &a).unwrap();
        b.updated_at = 20;
        save(dir.path(), &b).unwrap();
        std::fs::write(dir.path().join("broken.json"), "{not json").unwrap();

        let list = list(dir.path());
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, b.id);
        assert_eq!(list[1].preview, "Hello there friend");
        assert_eq!(list[1].message_count, 1);

        let renamed = rename(dir.path(), &a.id, "  My   chat ").unwrap();
        assert_eq!(renamed.title, "My chat");
        assert_eq!(load(dir.path(), &a.id).unwrap().instructions, "Be brief.");
        delete(dir.path(), &a.id).unwrap();
        assert!(load(dir.path(), &a.id).is_err());
        delete(dir.path(), &a.id).unwrap();
    }

    #[test]
    fn rejects_bad_ids() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load(dir.path(), "../config").is_err());
        assert!(chat_path(dir.path(), "a/b").is_err());
    }

    #[test]
    fn titles_are_short() {
        assert_eq!(title_from("  What is   the weather? "), "What is the weather?");
        let t = title_from(&"word ".repeat(30));
        assert!(t.chars().count() <= 48, "{t}");
        assert!(t.ends_with('…'));
        assert_eq!(title_from("   "), NEW_CHAT_TITLE);
    }
}
