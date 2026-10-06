//! Everything that runs the `fm` CLI directly: one-shot runs with streamed
//! output, status checks, CLI sessions, transcripts and the public server.
//!
//! Types that cross the IPC boundary are mirrored in `src/lib/types.ts`.

pub mod commands;
mod decode;
pub mod public_server;
pub mod sessions;
pub mod status;
pub mod transcript;

#[cfg(test)]
mod integration_tests;

use crate::util::LockExt;
use decode::ChunkDecoder;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

/// Streamed to the UI while `fm` runs (`fm_run` command channel).
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

/// Result of one `fm` invocation.
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

/// Cancellation tokens for running `fm` processes, keyed by run id.
#[derive(Default)]
pub struct RunRegistry {
    inner: Mutex<HashMap<String, CancellationToken>>,
}

impl RunRegistry {
    pub fn register(&self, run_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.inner.lock_safe().insert(run_id.to_string(), token.clone());
        token
    }

    pub fn cancel(&self, run_id: &str) -> bool {
        match self.inner.lock_safe().remove(run_id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    pub fn finish(&self, run_id: &str) {
        self.inner.lock_safe().remove(run_id);
    }
}

/// The shell command shown to users, e.g. `fm respond -i 'Be brief' 'Hi'`.
/// Uses `fm` instead of the full path when the binary is `/usr/bin/fm`.
pub fn display_command(fm_path: &str, args: &[String]) -> String {
    let exe = if fm_path == "/usr/bin/fm" { "fm" } else { fm_path };
    std::iter::once(exe.to_string()).chain(args.iter().cloned()).map(|a| shell_quote(&a)).collect::<Vec<_>>().join(" ")
}

pub fn shell_quote(arg: &str) -> String {
    if arg.is_empty() {
        return "''".into();
    }
    // A leading "=" is expanded by zsh (=cmd → path of cmd), so quote it.
    let safe = !arg.starts_with('=') && arg.chars().all(|c| c.is_ascii_alphanumeric() || "-_./=:,+@%".contains(c));
    if safe {
        arg.to_string()
    } else {
        format!("'{}'", arg.replace('\'', "'\\''"))
    }
}

/// Exit code `fm` uses when the license has not been agreed to.
pub const EXIT_LICENSE: i32 = 69;

/// Message shown when `fm` exits with code 69.
pub const LICENSE_MESSAGE: &str = "You have not agreed to the fm license yet. Run 'sudo fm license' in Terminal.";

/// Environment added to every `fm` process. `fm` ignores NO_COLOR and TERM
/// (harmless). `NSUnbufferedIO=YES` makes Foundation tools flush stdout on
/// every write, so `fm serve` logs arrive live instead of at exit.
pub(crate) const FM_ENV: [(&str, &str); 3] = [("NO_COLOR", "1"), ("TERM", "dumb"), ("NSUnbufferedIO", "YES")];

/// Turns the stderr of a failed run into one clean message.
/// Drops the help text `fm` prints after some errors (e.g. "Missing prompt").
pub fn error_message(exit_code: i32, stderr: &str) -> String {
    if exit_code == EXIT_LICENSE {
        return LICENSE_MESSAGE.to_string();
    }
    let cleaned = crate::util::clean_fm_error(stderr);
    let mut text = cleaned.as_str();
    // `fm` follows usage errors with a help screen; keep only the error part.
    if let Some(pos) = text.find("\n\n") {
        let rest = &text[pos..];
        if ["USAGE", "OPTIONS", "ARGUMENTS", "EXAMPLES", "Usage:"].iter().any(|h| rest.contains(h)) {
            text = &text[..pos];
        }
    }
    if let Some(pos) = text.find("\nUsage:") {
        text = &text[..pos];
    }
    let text = text.trim();
    if text.is_empty() {
        format!("fm stopped with exit code {exit_code}.")
    } else {
        text.to_string()
    }
}

/// Exit code of a finished process. Killed by a signal → 128 + signal (shell convention).
fn exit_code_of(status: &std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    status.code().unwrap_or_else(|| 128 + status.signal().unwrap_or(0))
}

/// Asks a child to stop (SIGTERM), then kills it (SIGKILL) after `grace`.
pub(crate) async fn terminate(child: &mut tokio::process::Child, grace: Duration) {
    if let Ok(Some(_)) = child.try_wait() {
        return;
    }
    if let Some(pid) = child.id() {
        // The child is not reaped yet, so the pid cannot belong to anyone else.
        let _ = tokio::process::Command::new("/bin/kill")
            .args(["-TERM", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
        if tokio::time::timeout(grace, child.wait()).await.is_ok() {
            return;
        }
    }
    let _ = child.kill().await;
}

/// Runs `fm` with `args`, streaming events, until it exits or `cancel` fires.
/// stdin is /dev/null. Never fails for a non-zero exit: that is reported in RunResult.
/// Returns Err only when the process cannot be started.
pub async fn run_streaming(
    fm_path: &str,
    args: &[String],
    cancel: CancellationToken,
    on_event: impl Fn(RunEvent) + Send + Sync + 'static,
) -> Result<RunResult, String> {
    let command = display_command(fm_path, args);
    let started = Instant::now();
    let mut child = tokio::process::Command::new(fm_path)
        .args(args)
        .envs(FM_ENV)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Could not start fm at {fm_path}: {e}"))?;

    on_event(RunEvent::Started { command: command.clone() });

    let (Some(mut out_pipe), Some(mut err_pipe)) = (child.stdout.take(), child.stderr.take()) else {
        return Err("Could not read the output of fm.".into());
    };
    let mut out_buf = vec![0u8; 8192];
    let mut err_buf = vec![0u8; 8192];
    let mut out_dec = ChunkDecoder::default();
    let mut err_dec = ChunkDecoder::default();
    let (mut out_open, mut err_open) = (true, true);
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut first_output_ms = None;
    let mut cancelled = false;
    let mut exit: Option<i32> = None;
    // Once the child has exited, read what is left in the pipes for a short
    // while, then stop. Waiting for EOF alone is not safe on macOS: another
    // child spawned at the same moment can inherit the pipe's write end.
    let drain = tokio::time::sleep(Duration::from_secs(3600));
    tokio::pin!(drain);

    let emit_out = |text: String, all: &mut String| {
        if !text.is_empty() {
            all.push_str(&text);
            on_event(RunEvent::Stdout { text });
        }
    };
    let emit_err = |text: String, all: &mut String| {
        if !text.is_empty() {
            all.push_str(&text);
            on_event(RunEvent::Stderr { text });
        }
    };

    while out_open || err_open {
        tokio::select! {
            read = out_pipe.read(&mut out_buf), if out_open => match read {
                Ok(n) if n > 0 => {
                    if first_output_ms.is_none() {
                        first_output_ms = Some(started.elapsed().as_millis() as u64);
                    }
                    emit_out(out_dec.push(&out_buf[..n]), &mut stdout);
                }
                _ => {
                    out_open = false;
                    emit_out(out_dec.finish(), &mut stdout);
                }
            },
            read = err_pipe.read(&mut err_buf), if err_open => match read {
                Ok(n) if n > 0 => emit_err(err_dec.push(&err_buf[..n]), &mut stderr),
                _ => {
                    err_open = false;
                    emit_err(err_dec.finish(), &mut stderr);
                }
            },
            status = child.wait(), if exit.is_none() => {
                exit = Some(status.map(|s| exit_code_of(&s)).unwrap_or(-1));
                drain.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(500));
            },
            _ = cancel.cancelled(), if !cancelled && exit.is_none() => {
                cancelled = true;
                terminate(&mut child, Duration::from_secs(1)).await;
            },
            _ = &mut drain, if exit.is_some() => break,
        }
    }
    if out_open {
        emit_out(out_dec.finish(), &mut stdout);
    }
    if err_open {
        emit_err(err_dec.finish(), &mut stderr);
    }

    let exit_code = match exit {
        Some(code) => code,
        None => child.wait().await.map(|s| exit_code_of(&s)).unwrap_or(-1),
    };
    let error = (exit_code != 0 && !cancelled).then(|| error_message(exit_code, &stderr));

    Ok(RunResult {
        command,
        exit_code,
        stdout,
        stderr,
        error,
        duration_ms: started.elapsed().as_millis() as u64,
        first_output_ms,
        cancelled,
    })
}

/// How long [`run_collect`] waits. It is used for quick commands (status,
/// license text, token counts), never for long generations.
pub const COLLECT_TIMEOUT: Duration = Duration::from_secs(120);

/// Runs `fm` and collects all output (no streaming). Stops `fm` and fails
/// after [`COLLECT_TIMEOUT`].
pub async fn run_collect(fm_path: &str, args: &[String]) -> Result<RunResult, String> {
    run_collect_within(fm_path, args, COLLECT_TIMEOUT).await
}

/// [`run_collect`] with its own time limit.
pub async fn run_collect_within(fm_path: &str, args: &[String], limit: Duration) -> Result<RunResult, String> {
    let cancel = CancellationToken::new();
    let timer = {
        let cancel = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(limit).await;
            cancel.cancel();
        })
    };
    let result = run_streaming(fm_path, args, cancel, |_| {}).await;
    let timed_out = timer.is_finished();
    timer.abort();
    let result = result?;
    if result.cancelled && timed_out {
        return Err(format!("fm did not finish within {} seconds and was stopped.", limit.as_secs()));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn quotes_like_a_shell() {
        let args: Vec<String> = ["respond", "-i", "Be brief", "it's"].iter().map(|s| s.to_string()).collect();
        assert_eq!(display_command("/usr/bin/fm", &args), r#"fm respond -i 'Be brief' 'it'\''s'"#);
    }

    #[test]
    fn error_message_drops_help_screen() {
        let raw = "Error: \u{1B}[38;2;255;107;128mMissing prompt. Provide a positional prompt.\n\n\n  \u{1B}[1mARGUMENTS\u{1B}[0m\n    <prompt>\n";
        assert_eq!(error_message(1, raw), "Missing prompt. Provide a positional prompt.");
        assert_eq!(
            error_message(64, "Error: Socket path must not be empty\nUsage: fm serve\n"),
            "Socket path must not be empty"
        );
        assert_eq!(error_message(69, "anything"), LICENSE_MESSAGE);
        assert_eq!(error_message(3, ""), "fm stopped with exit code 3.");
    }

    /// Writes a small shell script that stands in for `fm`.
    fn fake_fm(dir: &std::path::Path, body: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("fake-fm");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.display().to_string()
    }

    #[tokio::test]
    async fn streams_and_collects_output() {
        let dir = tempfile::tempdir().unwrap();
        let fm = fake_fm(
            dir.path(),
            r#"printf 'Hel'; sleep 0.2; printf 'lo \342\234'; sleep 0.2; printf '\223 done\n'; printf '\033[31mwarn\033[0m\n' >&2; exit 0"#,
        );
        let events = Arc::new(StdMutex::new(Vec::new()));
        let sink = events.clone();
        let result = run_streaming(&fm, &strings(&["respond", "Hi there"]), CancellationToken::new(), move |e| {
            sink.lock().unwrap().push(e)
        })
        .await
        .unwrap();
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.stdout, "Hello ✓ done\n");
        assert_eq!(result.stderr, "warn\n");
        assert!(result.error.is_none());
        assert!(result.first_output_ms.is_some());
        let events = events.lock().unwrap();
        assert!(matches!(&events[0], RunEvent::Started { command } if command.ends_with("respond 'Hi there'")));
        let chunks = events.iter().filter(|e| matches!(e, RunEvent::Stdout { .. })).count();
        assert!(chunks >= 2, "expected several stdout chunks, got {chunks}");
    }

    #[tokio::test]
    async fn reports_errors_and_license_exit() {
        let dir = tempfile::tempdir().unwrap();
        let fm = fake_fm(dir.path(), "printf 'Error: \\033[31mBad thing.\\033[0m\\n' >&2; exit 1");
        let r = run_collect(&fm, &[]).await.unwrap();
        assert_eq!(r.exit_code, 1);
        assert_eq!(r.error.as_deref(), Some("Bad thing."));

        let fm = fake_fm(dir.path(), "echo 'license' >&2; exit 69");
        let r = run_collect(&fm, &[]).await.unwrap();
        assert_eq!(r.exit_code, 69);
        assert_eq!(r.error.as_deref(), Some(LICENSE_MESSAGE));
    }

    #[tokio::test]
    async fn cancel_stops_the_process() {
        let dir = tempfile::tempdir().unwrap();
        let fm = fake_fm(dir.path(), "echo start; exec sleep 30");
        let token = CancellationToken::new();
        let t2 = token.clone();
        let started = Instant::now();
        // Cancel as soon as the first output arrives (like a user pressing Stop).
        let r = run_streaming(&fm, &[], token, move |e| {
            if matches!(e, RunEvent::Stdout { .. }) {
                t2.cancel();
            }
        })
        .await
        .unwrap();
        assert!(r.cancelled);
        assert!(r.error.is_none());
        assert_eq!(r.stdout, "start\n");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[tokio::test]
    async fn returns_when_a_stray_process_holds_the_pipe() {
        let dir = tempfile::tempdir().unwrap();
        // The background sleep keeps stdout open after the script exits.
        let fm = fake_fm(dir.path(), "sleep 5 & echo done; exit 3");
        let started = Instant::now();
        let r = run_collect(&fm, &[]).await.unwrap();
        assert_eq!(r.stdout, "done\n");
        assert_eq!(r.exit_code, 3);
        assert!(started.elapsed() < Duration::from_secs(3), "took {:?}", started.elapsed());
    }

    #[tokio::test]
    async fn collect_has_a_time_limit() {
        let dir = tempfile::tempdir().unwrap();
        let fm = fake_fm(dir.path(), "exec sleep 30");
        let started = Instant::now();
        let err = run_collect_within(&fm, &[], Duration::from_millis(300)).await.unwrap_err();
        assert!(err.contains("did not finish within"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[tokio::test]
    async fn missing_binary_is_an_error() {
        let err = run_collect("/nonexistent/fm", &[]).await.unwrap_err();
        assert!(err.starts_with("Could not start fm at /nonexistent/fm:"), "{err}");
    }
}
