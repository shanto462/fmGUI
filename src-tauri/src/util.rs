//! Small shared helpers. CONTRACT FILE: other modules depend on these signatures.

use std::collections::HashMap;
use std::sync::OnceLock;

/// Removes terminal escape sequences. `fm` colors stderr (and some stdout
/// lines) even when it is not attached to a terminal, and ignores NO_COLOR.
pub fn strip_ansi(text: &str) -> String {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B[@-Z\\-_]").unwrap()
    });
    if !text.contains('\u{1B}') {
        return text.to_string();
    }
    re.replace_all(text, "").into_owned()
}

/// Cleans an `fm` error message: strips colors and the leading "Error: ".
pub fn clean_fm_error(stderr: &str) -> String {
    let text = strip_ansi(stderr);
    let text = text.trim();
    text.strip_prefix("Error:").map(str::trim).unwrap_or(text).to_string()
}

/// Cuts text to at most `max_chars` characters (not bytes), adding a note
/// when something was removed. Used to keep tool output inside the small
/// context window.
pub fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let cut: String = text.chars().take(max_chars).collect();
    format!("{cut}\n…[truncated, {} more characters]", text.chars().count() - max_chars)
}

/// Rough token estimate (about 4 characters per token for English).
/// Use `fm count-tokens` when an exact number matters.
pub fn estimate_tokens(text: &str) -> u32 {
    (text.chars().count() as u32).div_ceil(4)
}

/// Environment of the user's login shell (PATH from ~/.zprofile, nvm,
/// Homebrew, ...). Apps opened from Finder only get a minimal PATH, so
/// `npx`, `uvx` or `node` would not be found without this. Computed once.
pub fn login_env() -> &'static HashMap<String, String> {
    static ENV: OnceLock<HashMap<String, String>> = OnceLock::new();
    ENV.get_or_init(|| {
        let mut env: HashMap<String, String> = std::env::vars().collect();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        // `env -0` keeps values with newlines intact.
        let output = std::process::Command::new(&shell)
            .args(["-ilc", "env -0"])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output();
        if let Ok(out) = output {
            if out.status.success() {
                for entry in out.stdout.split(|b| *b == 0) {
                    let entry = String::from_utf8_lossy(entry);
                    if let Some((k, v)) = entry.split_once('=') {
                        if k == "PATH" || !env.contains_key(k) {
                            env.insert(k.to_string(), v.to_string());
                        }
                    }
                }
            }
        }
        // Common tool folders as a safety net.
        let path = env.get("PATH").cloned().unwrap_or_default();
        let mut parts: Vec<String> = path.split(':').filter(|p| !p.is_empty()).map(String::from).collect();
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            if !parts.iter().any(|p| p == extra) {
                parts.push(extra.to_string());
            }
        }
        env.insert("PATH".into(), parts.join(":"));
        env
    })
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_colors_and_prefix() {
        let raw = "Error: \u{1B}[38;2;255;107;128mInvalid guardrail 'x'.\u{1B}[0m\n";
        assert_eq!(clean_fm_error(raw), "Invalid guardrail 'x'.");
        assert_eq!(strip_ansi("plain"), "plain");
    }

    #[test]
    fn truncates_by_chars() {
        assert_eq!(truncate_chars("héllo", 10), "héllo");
        let t = truncate_chars("ééééé", 2);
        assert!(t.starts_with("éé\n…[truncated, 3 more"));
    }
}
