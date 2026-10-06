//! Everything that runs the `fm` CLI directly.
//! OWNER: agent "cli". Public items marked CONTRACT must keep their signatures.

pub mod commands;
pub mod public_server;
pub mod sessions;
pub mod status;
pub mod transcript;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// CONTRACT: streamed to the UI while `fm` runs (`fm_run` command channel).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunEvent {
    /// The exact shell command being run (for the command preview).
    Started { command: String },
    /// A chunk of stdout (UTF-8 safe, ANSI stripped).
    Stdout { text: String },
    /// A chunk of stderr (ANSI stripped).
    Stderr { text: String },
}

/// CONTRACT: result of one `fm` invocation.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub command: String,
    pub exit_code: i32,
    pub stdout: String,
    /// ANSI stripped.
    pub stderr: String,
    /// Clean error message when `exit_code != 0` (no colors, no "Error:" prefix).
    /// Exit code 69 means the license was not agreed; the message says so.
    pub error: Option<String>,
    pub duration_ms: u64,
    /// Milliseconds until the first stdout byte (time to first token).
    pub first_output_ms: Option<u64>,
    pub cancelled: bool,
}

/// CONTRACT: cancellation tokens for running `fm` processes, keyed by run id.
#[derive(Default)]
pub struct RunRegistry {
    inner: Mutex<HashMap<String, CancellationToken>>,
}

impl RunRegistry {
    pub fn register(&self, run_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.inner.lock().unwrap().insert(run_id.to_string(), token.clone());
        token
    }

    pub fn cancel(&self, run_id: &str) -> bool {
        match self.inner.lock().unwrap().remove(run_id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    pub fn finish(&self, run_id: &str) {
        self.inner.lock().unwrap().remove(run_id);
    }
}

/// CONTRACT: the shell command shown to users, e.g. `fm respond -i 'Be brief' 'Hi'`.
/// Uses `fm` instead of the full path when the binary is `/usr/bin/fm`.
pub fn display_command(fm_path: &str, args: &[String]) -> String {
    let exe = if fm_path == "/usr/bin/fm" { "fm" } else { fm_path };
    std::iter::once(exe.to_string())
        .chain(args.iter().cloned())
        .map(|a| shell_quote(&a))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn shell_quote(arg: &str) -> String {
    if arg.is_empty() {
        return "''".into();
    }
    let safe = arg
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "-_./=:,+@%".contains(c));
    if safe {
        arg.to_string()
    } else {
        format!("'{}'", arg.replace('\'', "'\\''"))
    }
}

/// CONTRACT: run `fm` with `args`, streaming events, until it exits or `cancel` fires.
/// stdin is /dev/null. Never fails for a non-zero exit: that is reported in RunResult.
/// Returns Err only when the process cannot be started.
pub async fn run_streaming(
    fm_path: &str,
    args: &[String],
    cancel: CancellationToken,
    on_event: impl Fn(RunEvent) + Send + Sync + 'static,
) -> Result<RunResult, String> {
    let _ = (fm_path, args, cancel, on_event);
    Err("fm::run_streaming is not implemented yet".into())
}

/// CONTRACT: run `fm` and collect all output (no streaming, no cancel).
pub async fn run_collect(fm_path: &str, args: &[String]) -> Result<RunResult, String> {
    run_streaming(fm_path, args, CancellationToken::new(), |_| {}).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_like_a_shell() {
        let args: Vec<String> = ["respond", "-i", "Be brief", "it's"].iter().map(|s| s.to_string()).collect();
        assert_eq!(display_command("/usr/bin/fm", &args), r#"fm respond -i 'Be brief' 'it'\''s'"#);
    }
}
