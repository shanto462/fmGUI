//! Tauri commands for the CLI layer. OWNER: agent "cli".
//! CONTRACT: names, parameters and return types are mirrored in `src/lib/api.ts`.

use super::public_server::{PublicServerStatus};
use super::sessions::CliSession;
use super::status::FmStatus;
use super::transcript::ParsedTranscript;
use super::{RunEvent, RunResult};
use crate::config::PublicServerConfig;
use crate::state::AppState;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

const TODO: &str = "not implemented yet";

/// Runs `fm <args>` and streams output. `run_id` lets the UI cancel it.
#[tauri::command]
pub async fn fm_run(
    state: State<'_, AppState>,
    args: Vec<String>,
    run_id: String,
    on_event: Channel<RunEvent>,
) -> Result<RunResult, String> {
    let _ = (state, args, run_id, on_event);
    Err(TODO.into())
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
    let _ = state;
    Err(TODO.into())
}

/// Opens Terminal.app and types `command` there (used for `sudo fm license`).
#[tauri::command]
pub async fn open_in_terminal(command: String) -> Result<(), String> {
    let _ = command;
    Err(TODO.into())
}

#[tauri::command]
pub async fn cli_sessions_list(state: State<'_, AppState>) -> Result<Vec<CliSession>, String> {
    super::sessions::list(&state.paths.cli_sessions_dir)
}

#[tauri::command]
pub async fn cli_session_read(state: State<'_, AppState>, name: String) -> Result<ParsedTranscript, String> {
    let _ = (state, name);
    Err(TODO.into())
}

#[tauri::command]
pub async fn cli_session_delete(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let _ = (state, name);
    Err(TODO.into())
}

#[tauri::command]
pub async fn cli_session_rename(state: State<'_, AppState>, from: String, to: String) -> Result<(), String> {
    let _ = (state, from, to);
    Err(TODO.into())
}

/// Returns an unused absolute path `~/.fm/sessions/<slug>[-N].json` for a new
/// session, built from `base` (any text; it is slugified). Creates the folder.
#[tauri::command]
pub async fn cli_session_new_path(state: State<'_, AppState>, base: String) -> Result<String, String> {
    let _ = (state, base);
    Err(TODO.into())
}

/// Parses any transcript file (e.g. one picked for `--resume`).
#[tauri::command]
pub async fn transcript_read(path: String) -> Result<ParsedTranscript, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    super::transcript::parse(&bytes)
}

#[tauri::command]
pub async fn public_server_start(
    app: AppHandle,
    state: State<'_, AppState>,
    config: PublicServerConfig,
) -> Result<PublicServerStatus, String> {
    let _ = (app, state, config);
    Err(TODO.into())
}

#[tauri::command]
pub async fn public_server_stop(app: AppHandle, state: State<'_, AppState>) -> Result<PublicServerStatus, String> {
    let _ = (app, state);
    Err(TODO.into())
}

#[tauri::command]
pub async fn public_server_status(state: State<'_, AppState>) -> Result<PublicServerStatus, String> {
    let _ = state;
    Ok(PublicServerStatus::default())
}

/// CONTRACT
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
    let _ = (state, method, path, body);
    Err(TODO.into())
}
