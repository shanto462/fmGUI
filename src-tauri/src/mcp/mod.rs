//! Minimal MCP client (JSON-RPC 2.0): stdio and Streamable HTTP transports,
//! tools only (initialize → notifications/initialized → tools/list → tools/call).
//! OWNER: agent "mcp". Items marked CONTRACT keep their signatures.
//! Event: "mcp-status" with Vec<McpServerStatus> whenever a server changes state.

pub mod client;
pub mod commands;

use crate::config::McpServerConfig;
use serde::Serialize;
use tauri::AppHandle;

/// CONTRACT: a tool offered by a connected server (unfiltered).
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDescriptor {
    pub server_id: String,
    pub server_name: String,
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpToolSummary {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    /// false when listed in the server config's `disabledTools`.
    pub enabled: bool,
}

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub id: String,
    pub name: String,
    /// "disconnected" | "connecting" | "connected" | "error"
    pub state: String,
    pub error: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools: Vec<McpToolSummary>,
    /// Last lines the server printed on stderr (stdio only), for debugging.
    pub stderr_tail: Vec<String>,
}

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpTestResult {
    pub ok: bool,
    pub error: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools: Vec<McpToolSummary>,
    pub stderr_tail: Vec<String>,
    pub duration_ms: u64,
}

/// CONTRACT: lives in AppState.
#[derive(Default)]
pub struct McpManager {
    // Agent "mcp": add fields (tokio Mutex<HashMap<String, Connection>>, ...).
}

impl McpManager {
    /// CONTRACT: connect (or reconnect) one server and list its tools.
    pub async fn connect(&self, app: &AppHandle, config: &McpServerConfig) -> Result<(), String> {
        let _ = (app, config);
        Err("mcp is not implemented yet".into())
    }

    /// CONTRACT
    pub async fn disconnect(&self, app: &AppHandle, server_id: &str) {
        let _ = (app, server_id);
    }

    /// CONTRACT: one status per configured server (disconnected when not running).
    pub async fn statuses(&self, configs: &[McpServerConfig]) -> Vec<McpServerStatus> {
        configs
            .iter()
            .map(|c| McpServerStatus { id: c.id.clone(), name: c.name.clone(), state: "disconnected".into(), ..Default::default() })
            .collect()
    }

    /// CONTRACT: all tools of all connected servers (the engine filters by config).
    pub async fn tools(&self) -> Vec<McpToolDescriptor> {
        Vec::new()
    }

    /// CONTRACT: call a tool; returns the text content joined (images/resources described in text).
    /// An MCP tool result with `isError: true` → Err(text).
    pub async fn call_tool(&self, server_id: &str, tool: &str, arguments: serde_json::Value) -> Result<String, String> {
        let _ = (server_id, tool, arguments);
        Err("mcp is not implemented yet".into())
    }

    /// CONTRACT: connect, list tools, disconnect. For the setup wizard.
    pub async fn test(&self, config: &McpServerConfig) -> McpTestResult {
        let _ = config;
        McpTestResult { error: Some("mcp is not implemented yet".into()), ..Default::default() }
    }

    /// CONTRACT: stop every server. Called on app exit.
    pub async fn shutdown(&self) {}
}
