//! CLI chat sessions in `~/.fm/sessions/` (shared with `fm chat`).
//! OWNER: agent "cli".

use serde::Serialize;
use std::path::{Path, PathBuf};

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CliSession {
    /// File name without `.json`; this is what `fm chat --resume <name>` takes.
    pub name: String,
    pub path: String,
    pub modified_ms: i64,
    pub size_bytes: u64,
    /// First user message, shortened.
    pub preview: String,
    /// Number of user turns.
    pub turns: u32,
}

const PREVIEW_CHARS: usize = 80;

/// CONTRACT: newest first. Missing folder → empty list.
pub fn list(dir: &Path) -> Result<Vec<CliSession>, String> {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Could not read {}: {e}", dir.display())),
    };

    let mut sessions = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()).map(String::from) else {
            continue;
        };
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let mut session = CliSession {
            name,
            path: path.display().to_string(),
            modified_ms,
            size_bytes: meta.len(),
            ..Default::default()
        };
        // Unreadable or broken files are still listed, with an empty preview.
        if let Ok(parsed) = std::fs::read(&path).map_err(|e| e.to_string()).and_then(|b| super::transcript::parse(&b)) {
            let users: Vec<_> = parsed.messages.iter().filter(|m| m.role == "user").collect();
            session.turns = users.len() as u32;
            if let Some(first) = users.first() {
                session.preview = preview(&first.text, !first.images.is_empty());
            }
        }
        sessions.push(session);
    }
    sessions.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.name.cmp(&b.name)));
    Ok(sessions)
}

/// One line, at most 80 characters.
fn preview(text: &str, has_images: bool) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        return if has_images { "(image)".into() } else { String::new() };
    }
    if line.chars().count() <= PREVIEW_CHARS {
        return line;
    }
    let cut: String = line.chars().take(PREVIEW_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

/// CONTRACT: same rules as fm: not empty, not "." or "..", no '/', '\\' or NUL.
pub fn is_valid_name(name: &str) -> bool {
    !(name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']))
}

/// Path of the session called `name`, after checking the name.
pub fn session_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    let name = name.strip_suffix(".json").unwrap_or(name);
    if !is_valid_name(name) {
        return Err(format!("'{name}' is not a valid session name. Do not use '/' or '\\'."));
    }
    Ok(dir.join(format!("{name}.json")))
}

/// Short file name from any text: lowercase words joined by '-',
/// at most 5 words and 48 characters. Falls back to "chat".
pub fn slugify(base: &str) -> String {
    let words: Vec<String> = base
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(5)
        .map(|w| w.to_lowercase())
        .collect();
    let mut slug = String::new();
    for word in words {
        let extra = if slug.is_empty() { 0 } else { 1 } + word.chars().count();
        if slug.chars().count() + extra > 48 {
            if slug.is_empty() {
                slug = word.chars().take(48).collect();
            }
            break;
        }
        if !slug.is_empty() {
            slug.push('-');
        }
        slug.push_str(&word);
    }
    if slug.is_empty() {
        "chat".into()
    } else {
        slug
    }
}

/// An unused `<dir>/<slug>[-N].json`. Creates `dir`.
pub fn new_session_path(dir: &Path, base: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let slug = slugify(base);
    let mut candidate = dir.join(format!("{slug}.json"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{slug}-{n}.json"));
        n += 1;
    }
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_newest_first_with_preview() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("older.json");
        std::fs::write(&old, super::super::transcript::tests::FIXTURE).unwrap();
        // Make the first file clearly older.
        let past = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        std::fs::File::options().write(true).open(&old).unwrap().set_modified(past).unwrap();
        std::fs::write(dir.path().join("broken.json"), b"{ not json").unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"ignored").unwrap();

        let sessions = list(dir.path()).unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].name, "broken");
        assert_eq!(sessions[0].preview, "");
        assert_eq!(sessions[0].turns, 0);
        let s = &sessions[1];
        assert_eq!(s.name, "older");
        assert_eq!(s.preview, "Hello there, friend");
        assert_eq!(s.turns, 2);
        assert!(s.size_bytes > 0 && s.path.ends_with("older.json"));
    }

    #[test]
    fn missing_folder_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(&dir.path().join("nope")).unwrap().is_empty());
    }

    #[test]
    fn preview_is_one_short_line() {
        let long = "word ".repeat(40);
        let p = preview(&long, false);
        assert!(p.chars().count() <= 80 && p.ends_with('…'));
        assert_eq!(preview("  a\n\tb  ", false), "a b");
        assert_eq!(preview("", true), "(image)");
    }

    #[test]
    fn slugs_and_unique_paths() {
        assert_eq!(slugify("What is Swift? Tell me MORE please now"), "what-is-swift-tell-me");
        assert_eq!(slugify("  !!!  "), "chat");
        assert_eq!(slugify(&"a".repeat(60)).len(), 48);
        assert!(slugify("internationalization localization globalization").len() <= 48);

        let dir = tempfile::tempdir().unwrap();
        let sessions = dir.path().join("sessions");
        let first = new_session_path(&sessions, "Hello world").unwrap();
        assert_eq!(first, sessions.join("hello-world.json"));
        std::fs::write(&first, "{}").unwrap();
        let second = new_session_path(&sessions, "Hello, World!").unwrap();
        assert_eq!(second, sessions.join("hello-world-2.json"));
    }

    #[test]
    fn checks_names() {
        let dir = Path::new("/x");
        assert_eq!(session_path(dir, "my-chat").unwrap(), Path::new("/x/my-chat.json"));
        assert_eq!(session_path(dir, "my-chat.json").unwrap(), Path::new("/x/my-chat.json"));
        assert!(session_path(dir, "../evil").is_err());
        assert!(session_path(dir, "..").is_err());
        assert!(session_path(dir, "").is_err());
    }
}
