//! CLI chat sessions in `~/.fm/sessions/` (shared with `fm chat`).
//! OWNER: agent "cli".

use serde::Serialize;
use std::path::Path;

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

/// CONTRACT: newest first. Missing folder → empty list.
pub fn list(dir: &Path) -> Result<Vec<CliSession>, String> {
    let _ = dir;
    Ok(Vec::new())
}

/// CONTRACT: same rules as fm: not empty, not "." or "..", no '/', '\\' or NUL.
pub fn is_valid_name(name: &str) -> bool {
    !(name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']))
}
