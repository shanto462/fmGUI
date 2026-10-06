//! Tauri commands for the agent engine. OWNER: agent "engine".
//! CONTRACT: mirrored in `src/lib/api.ts`.

use super::{AgentEvent, Chat, ChatMessage, ChatSummary, EngineStatus, ToolInfo, ToolTestResult};
use crate::config::CustomTool;
use crate::state::AppState;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

const TODO: &str = "not implemented yet";

#[tauri::command]
pub async fn engine_status(state: State<'_, AppState>) -> Result<EngineStatus, String> {
    Ok(EngineStatus { socket_path: state.engine.socket_path.display().to_string(), ..Default::default() })
}

/// Starts (or restarts) the private `fm serve --socket` instance.
#[tauri::command]
pub async fn engine_restart(state: State<'_, AppState>) -> Result<EngineStatus, String> {
    let _ = state;
    Err(TODO.into())
}

#[tauri::command]
pub async fn chats_list(state: State<'_, AppState>) -> Result<Vec<ChatSummary>, String> {
    let _ = state;
    Ok(Vec::new())
}

#[tauri::command]
pub async fn chat_get(state: State<'_, AppState>, id: String) -> Result<Chat, String> {
    let _ = (state, id);
    Err(TODO.into())
}

/// `instructions: None` → use config.chatDefaults.instructions.
#[tauri::command]
pub async fn chat_create(state: State<'_, AppState>, instructions: Option<String>) -> Result<Chat, String> {
    let _ = (state, instructions);
    Err(TODO.into())
}

#[tauri::command]
pub async fn chat_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let _ = (state, id);
    Err(TODO.into())
}

#[tauri::command]
pub async fn chat_rename(state: State<'_, AppState>, id: String, title: String) -> Result<Chat, String> {
    let _ = (state, id, title);
    Err(TODO.into())
}

#[tauri::command]
pub async fn chat_set_instructions(state: State<'_, AppState>, id: String, instructions: String) -> Result<Chat, String> {
    let _ = (state, id, instructions);
    Err(TODO.into())
}

/// Runs one agent turn. Streams AgentEvents; returns the final assistant message.
/// `images` are data URLs.
#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
    text: String,
    images: Vec<String>,
    on_event: Channel<AgentEvent>,
) -> Result<ChatMessage, String> {
    let _ = (app, state, chat_id, text, images, on_event);
    Err(TODO.into())
}

#[tauri::command]
pub async fn chat_cancel(state: State<'_, AppState>, chat_id: String) -> Result<(), String> {
    let _ = (state, chat_id);
    Ok(())
}

/// `decision`: "allow" (once) | "always" (also saves approval=always in config) | "deny".
#[tauri::command]
pub async fn approval_respond(
    app: AppHandle,
    state: State<'_, AppState>,
    approval_id: String,
    decision: String,
) -> Result<(), String> {
    let _ = (app, state, approval_id, decision);
    Err(TODO.into())
}

/// Every tool: built-in, custom, MCP (connected servers), and `use_skill`.
#[tauri::command]
pub async fn tools_catalog(state: State<'_, AppState>) -> Result<Vec<ToolInfo>, String> {
    let _ = state;
    Ok(Vec::new())
}

/// Runs a catalog tool directly with the given arguments (no model, no approval).
#[tauri::command]
pub async fn tool_test(
    state: State<'_, AppState>,
    tool_id: String,
    arguments: serde_json::Value,
) -> Result<ToolTestResult, String> {
    let _ = (state, tool_id, arguments);
    Err(TODO.into())
}

/// Runs an unsaved custom tool definition (setup wizard "Test" step).
#[tauri::command]
pub async fn custom_tool_test(
    state: State<'_, AppState>,
    tool: CustomTool,
    arguments: serde_json::Value,
) -> Result<ToolTestResult, String> {
    let _ = (state, tool, arguments);
    Err(TODO.into())
}

/// Names from `shortcuts list` (Apple Shortcuts), for the Shortcut tool kind.
#[tauri::command]
pub async fn shortcuts_list() -> Result<Vec<String>, String> {
    Err(TODO.into())
}
