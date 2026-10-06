//! Tauri commands for the agent engine, mirrored in `src/lib/api.ts`.

use super::{chats, router, tools, AgentEvent, Chat, ChatMessage, ChatSummary, EngineStatus, ToolInfo, ToolTestResult};
use crate::config::CustomTool;
use crate::state::AppState;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn engine_status(state: State<'_, AppState>) -> Result<EngineStatus, String> {
    Ok(state.engine.server.status().await)
}

/// Starts (or restarts) the private `fm serve --socket` instance.
#[tauri::command]
pub async fn engine_restart(state: State<'_, AppState>) -> Result<EngineStatus, String> {
    let fm_path = state.fm_path();
    state.engine.server.restart(&fm_path).await?;
    Ok(state.engine.server.status().await)
}

#[tauri::command]
pub async fn chats_list(state: State<'_, AppState>) -> Result<Vec<ChatSummary>, String> {
    Ok(chats::list(&state.engine.chats_dir))
}

#[tauri::command]
pub async fn chat_get(state: State<'_, AppState>, id: String) -> Result<Chat, String> {
    chats::load(&state.engine.chats_dir, &id)
}

/// `instructions: None` → use config.chatDefaults.instructions.
#[tauri::command]
pub async fn chat_create(state: State<'_, AppState>, instructions: Option<String>) -> Result<Chat, String> {
    let instructions = instructions.unwrap_or_else(|| state.config().chat_defaults.instructions);
    chats::create(&state.engine.chats_dir, &instructions)
}

#[tauri::command]
pub async fn chat_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.engine.cancel_run(&id);
    chats::delete(&state.engine.chats_dir, &id)
}

#[tauri::command]
pub async fn chat_rename(state: State<'_, AppState>, id: String, title: String) -> Result<Chat, String> {
    chats::rename(&state.engine.chats_dir, &id, &title)
}

#[tauri::command]
pub async fn chat_set_instructions(
    state: State<'_, AppState>,
    id: String,
    instructions: String,
) -> Result<Chat, String> {
    chats::set_instructions(&state.engine.chats_dir, &id, &instructions)
}

/// Runs one agent turn. Streams AgentEvents; returns the final assistant message.
/// `images` are data URLs. Errors during the turn (model errors, "Stopped")
/// are returned inside `message.error` (and sent as an `error` event before
/// `done`); `Err` is only for problems before the turn starts.
#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: String,
    text: String,
    images: Vec<String>,
    on_event: Channel<AgentEvent>,
) -> Result<ChatMessage, String> {
    let emit = move |event: AgentEvent| {
        let _ = on_event.send(event);
    };
    router::run_turn(state.inner(), Some(&app), &chat_id, text, images, &emit).await
}

#[tauri::command]
pub async fn chat_cancel(state: State<'_, AppState>, chat_id: String) -> Result<(), String> {
    state.engine.cancel_run(&chat_id);
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
    // The router saves "always" (it knows which tool it is) and emits
    // "config-changed" with the app handle it got from chat_send.
    let _ = app;
    if !matches!(decision.as_str(), "allow" | "always" | "deny") {
        return Err(format!("Unknown decision \"{decision}\". Use allow, always or deny."));
    }
    if state.engine.respond_approval(&approval_id, &decision) {
        Ok(())
    } else {
        Err("This approval request is no longer waiting. The turn may have ended.".into())
    }
}

/// Every tool: built-in, custom, MCP (connected servers), and `use_skill`.
#[tauri::command]
pub async fn tools_catalog(state: State<'_, AppState>) -> Result<Vec<ToolInfo>, String> {
    let cfg = state.config();
    Ok(tools::catalog(state.inner(), &cfg).await.into_iter().map(|t| t.info).collect())
}

/// Runs a catalog tool directly with the given arguments (no model, no approval).
#[tauri::command]
pub async fn tool_test(
    state: State<'_, AppState>,
    tool_id: String,
    arguments: serde_json::Value,
) -> Result<ToolTestResult, String> {
    tools::test_tool(state.inner(), &tool_id, &arguments).await
}

/// Runs an unsaved custom tool definition (setup wizard "Test" step).
#[tauri::command]
pub async fn custom_tool_test(
    state: State<'_, AppState>,
    tool: CustomTool,
    arguments: serde_json::Value,
) -> Result<ToolTestResult, String> {
    Ok(tools::test_custom(state.inner(), &tool, &arguments).await)
}

/// Names from `shortcuts list` (Apple Shortcuts), for the Shortcut tool kind.
#[tauri::command]
pub async fn shortcuts_list() -> Result<Vec<String>, String> {
    super::builtin::shortcuts_list().await
}
