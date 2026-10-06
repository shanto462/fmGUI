//! Tauri commands for MCP, mirrored in `src/lib/api.ts`.

use super::{McpServerStatus, McpTestResult};
use crate::config::McpServerConfig;
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn mcp_statuses(state: State<'_, AppState>) -> Result<Vec<McpServerStatus>, String> {
    let configs = state.config().mcp_servers;
    // Servers removed from the settings should not keep running.
    state.mcp.prune(&configs).await;
    Ok(state.mcp.statuses(&configs).await)
}

/// Connects the saved server with this id.
#[tauri::command]
pub async fn mcp_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<McpServerStatus>, String> {
    let configs = state.config().mcp_servers;
    let config = configs.iter().find(|c| c.id == id).ok_or("This MCP server is not saved yet. Save it first.")?;
    state.mcp.connect(&app, config).await?;
    Ok(state.mcp.statuses(&configs).await)
}

#[tauri::command]
pub async fn mcp_disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<McpServerStatus>, String> {
    state.mcp.disconnect(&app, &id).await;
    let configs = state.config().mcp_servers;
    Ok(state.mcp.statuses(&configs).await)
}

/// Tests an unsaved server config (wizard).
#[tauri::command]
pub async fn mcp_test(state: State<'_, AppState>, config: McpServerConfig) -> Result<McpTestResult, String> {
    Ok(state.mcp.test(&config).await)
}
