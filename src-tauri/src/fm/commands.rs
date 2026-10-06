//! Tauri commands for the CLI layer. Names, parameters and return types are
//! mirrored in `src/lib/api.ts`.

use super::public_server::PublicServerStatus;
use super::sessions::CliSession;
use super::status::FmStatus;
use super::transcript::ParsedTranscript;
use super::{RunEvent, RunResult};
use crate::config::PublicServerConfig;
use crate::state::AppState;
use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

/// Runs `fm <args>` and streams output. `run_id` lets the UI cancel it.
#[tauri::command]
pub async fn fm_run(
    state: State<'_, AppState>,
    args: Vec<String>,
    run_id: String,
    on_event: Channel<RunEvent>,
) -> Result<RunResult, String> {
    let fm_path = state.fm_path();
    let token = state.runs.register(&run_id);
    let result = super::run_streaming(&fm_path, &args, token, move |event| {
        let _ = on_event.send(event);
    })
    .await;
    state.runs.finish(&run_id);
    result
}

#[tauri::command]
pub async fn fm_cancel(state: State<'_, AppState>, run_id: String) -> Result<bool, String> {
    Ok(state.runs.cancel(&run_id))
}

#[tauri::command]
pub async fn fm_status(state: State<'_, AppState>) -> Result<FmStatus, String> {
    let cfg = state.config();
    Ok(super::status::check(&cfg.fm_path, cfg.context_size).await)
}

/// Output of `fm license --show`.
#[tauri::command]
pub async fn fm_license_text(state: State<'_, AppState>) -> Result<String, String> {
    license_text(&state.fm_path()).await
}

pub(crate) async fn license_text(fm_path: &str) -> Result<String, String> {
    let args = vec!["license".to_string(), "--show".to_string()];
    let result = super::run_collect(fm_path, &args).await?;
    if result.exit_code != 0 {
        return Err(result.error.unwrap_or_else(|| "Could not read the license text.".into()));
    }
    Ok(result.stdout.trim_end().to_string())
}

/// Opens Terminal.app and runs `command` there. The UI uses it for
/// `sudo fm license`, `fm chat --resume <name>` and the MCP server command
/// the user typed, so it cannot be limited to a fixed list. The command is
/// one line and is shown in Terminal before anything else happens there.
#[tauri::command]
pub async fn open_in_terminal(command: String) -> Result<(), String> {
    let script = terminal_script(&command)?;
    let mut osascript = tokio::process::Command::new("/usr/bin/osascript");
    for line in &script {
        osascript.arg("-e").arg(line);
    }
    // The first time, macOS asks whether fmGUI may control Terminal; give
    // the user time to answer, but never wait forever.
    let run = osascript.stdin(Stdio::null()).kill_on_drop(true).output();
    let out = tokio::time::timeout(Duration::from_secs(120), run)
        .await
        .map_err(|_| "Terminal did not answer. Try again.".to_string())?
        .map_err(|e| format!("Could not run osascript: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(format!("Could not open Terminal. {err}").trim().to_string())
    }
}

/// AppleScript lines that open Terminal and run `command`. The command must
/// be one line: a line break would run a second command right away.
fn terminal_script(command: &str) -> Result<Vec<String>, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("There is no command to run.".into());
    }
    if command.chars().any(char::is_control) {
        return Err("The command must be a single line.".into());
    }
    Ok(vec![
        "tell application \"Terminal\"".into(),
        "activate".into(),
        format!("do script \"{}\"", applescript_escape(command)),
        "end tell".into(),
    ])
}

/// Escapes text for an AppleScript string literal.
fn applescript_escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

#[tauri::command]
pub async fn cli_sessions_list(state: State<'_, AppState>) -> Result<Vec<CliSession>, String> {
    super::sessions::list(&state.paths.cli_sessions_dir)
}

#[tauri::command]
pub async fn cli_session_read(state: State<'_, AppState>, name: String) -> Result<ParsedTranscript, String> {
    session_read(&state.paths.cli_sessions_dir, &name)
}

#[tauri::command]
pub async fn cli_session_delete(state: State<'_, AppState>, name: String) -> Result<(), String> {
    session_delete(&state.paths.cli_sessions_dir, &name)
}

#[tauri::command]
pub async fn cli_session_rename(state: State<'_, AppState>, from: String, to: String) -> Result<(), String> {
    session_rename(&state.paths.cli_sessions_dir, &from, &to)
}

/// Returns an unused absolute path `~/.fm/sessions/<slug>[-N].json` for a new
/// session, built from `base` (any text; it is slugified). Creates the folder.
#[tauri::command]
pub async fn cli_session_new_path(state: State<'_, AppState>, base: String) -> Result<String, String> {
    let path = super::sessions::new_session_path(&state.paths.cli_sessions_dir, &base)?;
    let path = if path.is_absolute() { path } else { std::env::current_dir().map_err(|e| e.to_string())?.join(path) };
    Ok(path.display().to_string())
}

fn existing_session(dir: &std::path::Path, name: &str) -> Result<std::path::PathBuf, String> {
    let path = super::sessions::session_path(dir, name)?;
    if !path.is_file() {
        return Err(format!("The session '{}' was not found.", name.trim()));
    }
    Ok(path)
}

fn session_read(dir: &std::path::Path, name: &str) -> Result<ParsedTranscript, String> {
    let path = existing_session(dir, name)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    super::transcript::parse(&bytes)
}

fn session_delete(dir: &std::path::Path, name: &str) -> Result<(), String> {
    let path = existing_session(dir, name)?;
    std::fs::remove_file(&path).map_err(|e| format!("Could not delete {}: {e}", path.display()))
}

fn session_rename(dir: &std::path::Path, from: &str, to: &str) -> Result<(), String> {
    let source = existing_session(dir, from)?;
    let target = super::sessions::session_path(dir, to)?;
    if target == source {
        return Ok(());
    }
    if target.exists() {
        return Err(format!("A session named '{}' already exists. Choose another name.", to.trim()));
    }
    std::fs::rename(&source, &target).map_err(|e| format!("Could not rename the session: {e}"))
}

/// Parses any transcript file (e.g. one picked for `--resume`). The path
/// comes from a file dialog in the UI, so any readable file is allowed.
#[tauri::command]
pub async fn transcript_read(path: String) -> Result<ParsedTranscript, String> {
    tokio::task::spawn_blocking(move || {
        let bytes = crate::util::read_user_file(std::path::Path::new(&path), super::transcript::MAX_FILE_BYTES)?;
        super::transcript::parse(&bytes)
    })
    .await
    .map_err(|e| format!("Could not read the transcript: {e}"))?
}

#[tauri::command]
pub async fn public_server_start(
    app: AppHandle,
    state: State<'_, AppState>,
    config: PublicServerConfig,
) -> Result<PublicServerStatus, String> {
    let fm_path = state.fm_path();
    state.public_server.start(&app, &fm_path, &config).await
}

#[tauri::command]
pub async fn public_server_stop(app: AppHandle, state: State<'_, AppState>) -> Result<PublicServerStatus, String> {
    Ok(state.public_server.stop(&app).await)
}

#[tauri::command]
pub async fn public_server_status(state: State<'_, AppState>) -> Result<PublicServerStatus, String> {
    Ok(state.public_server.status())
}

/// Reply of a "Try it" request to the public server.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HttpResult {
    pub status: u16,
    pub body: String,
    pub duration_ms: u64,
}

/// Sends a request to the running public server (TCP or socket) for the
/// "Try it" panel. `path` like "/v1/chat/completions".
#[tauri::command]
pub async fn public_server_request(
    state: State<'_, AppState>,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<HttpResult, String> {
    state.public_server.request(&method, &path, body).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_applescript() {
        assert_eq!(applescript_escape(r#"echo "hi" \ there"#), r#"echo \"hi\" \\ there"#);
        let script = terminal_script("  sudo fm license ").unwrap();
        assert_eq!(script[2], "do script \"sudo fm license\"");
        // Quotes and backslashes cannot end the string early or form escapes.
        let script = terminal_script(r#"echo "\" & do shell script "x" & "#).unwrap();
        assert_eq!(script[2], r#"do script "echo \"\\\" & do shell script \"x\" &""#);
        // A trailing backslash cannot escape the closing quote.
        assert_eq!(terminal_script("x\\").unwrap()[2], r#"do script "x\\""#);
        for bad in ["echo a\nrm -rf ~", "echo a\rb", "a\u{0}b", "a\u{1b}[2J", "\t", "   "] {
            assert!(terminal_script(bad).is_err(), "{bad:?}");
        }
    }

    /// AppleScript itself reads the escaped literal back to the exact input.
    #[test]
    fn applescript_literal_round_trips() {
        for text in [r#"say "hi" \ "#, r#"a\"b\\"c"#, r#"\n is not a line break"#, "x\\", "émoji ✓ 'single'"] {
            let out = std::process::Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(format!("return \"{}\"", applescript_escape(text)))
                .output()
                .unwrap();
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
            assert_eq!(String::from_utf8_lossy(&out.stdout).strip_suffix('\n').unwrap(), text);
        }
    }

    #[tokio::test]
    async fn transcript_read_refuses_folders() {
        let dir = tempfile::tempdir().unwrap();
        let err = transcript_read(dir.path().display().to_string()).await.unwrap_err();
        assert!(err.contains("is a folder"), "{err}");
    }

    #[test]
    fn session_file_commands() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        std::fs::write(d.join("one.json"), super::super::transcript::tests::FIXTURE).unwrap();
        std::fs::write(d.join("two.json"), "{}").unwrap();

        assert_eq!(session_read(d, "one").unwrap().messages[0].text, "Hello there,\nfriend");
        assert!(session_read(d, "missing").unwrap_err().contains("was not found"));
        assert!(session_read(d, "../one").unwrap_err().contains("not a valid session name"));
        for bad in ["/etc/hosts", "..", "a\\b", "a\0b", "../../.ssh/id_rsa", ""] {
            assert!(session_read(d, bad).is_err(), "{bad:?}");
            assert!(session_delete(d, bad).is_err(), "{bad:?}");
            assert!(session_rename(d, "two", bad).is_err(), "{bad:?}");
        }

        assert!(session_rename(d, "one", "two").unwrap_err().contains("already exists"));
        assert!(session_rename(d, "one", "a/b").is_err());
        session_rename(d, "one", "renamed").unwrap();
        assert!(d.join("renamed.json").is_file() && !d.join("one.json").exists());

        session_delete(d, "two").unwrap();
        assert!(!d.join("two.json").exists());
        assert!(session_delete(d, "two").unwrap_err().contains("was not found"));
    }
}
