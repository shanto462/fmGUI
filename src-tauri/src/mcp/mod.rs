//! Minimal MCP client (JSON-RPC 2.0): stdio and Streamable HTTP transports,
//! tools only (initialize → notifications/initialized → tools/list → tools/call).
//! OWNER: agent "mcp". Items marked CONTRACT keep their signatures.
//! Event: "mcp-status" with Vec<McpServerStatus> whenever a server changes state.

pub mod client;
pub mod commands;
pub mod errors;
pub mod http;
pub mod rpc;
pub mod sse;
pub mod stdio;

#[cfg(test)]
mod tests;

use crate::config::McpServerConfig;
use crate::state::AppState;
use client::{ClientEvent, McpClient, ToolDef};
use rpc::LogTail;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Mutex};

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

#[derive(Debug, Clone, PartialEq)]
enum Phase {
    Connecting,
    Connected,
    Error(String),
}

/// One configured server that is connecting, connected, or failed.
struct Connection {
    name: String,
    /// Changes on every connect, so late events from an old connection are ignored.
    generation: u64,
    phase: Phase,
    client: Option<Arc<McpClient>>,
    server_name: Option<String>,
    server_version: Option<String>,
    tools: Vec<ToolDef>,
    tail: LogTail,
}

type ConnMap = Arc<Mutex<HashMap<String, Connection>>>;

/// CONTRACT: lives in AppState.
#[derive(Default)]
pub struct McpManager {
    conns: ConnMap,
    generation: AtomicU64,
}

fn summaries(tools: &[ToolDef], disabled: &[String]) -> Vec<McpToolSummary> {
    tools
        .iter()
        .map(|t| McpToolSummary {
            name: t.name.clone(),
            description: t.description.clone(),
            input_schema: t.input_schema.clone(),
            enabled: !disabled.contains(&t.name),
        })
        .collect()
}

fn build_statuses(map: &HashMap<String, Connection>, configs: &[McpServerConfig]) -> Vec<McpServerStatus> {
    configs
        .iter()
        .map(|cfg| match map.get(&cfg.id) {
            None => McpServerStatus {
                id: cfg.id.clone(),
                name: cfg.name.clone(),
                state: "disconnected".into(),
                ..Default::default()
            },
            Some(c) => {
                let (state, error) = match &c.phase {
                    Phase::Connecting => ("connecting", None),
                    Phase::Connected => ("connected", None),
                    Phase::Error(e) => ("error", Some(e.clone())),
                };
                McpServerStatus {
                    id: cfg.id.clone(),
                    name: cfg.name.clone(),
                    state: state.into(),
                    error,
                    server_name: c.server_name.clone(),
                    server_version: c.server_version.clone(),
                    tools: if c.phase == Phase::Connected { summaries(&c.tools, &cfg.disabled_tools) } else { Vec::new() },
                    stderr_tail: c.tail.snapshot(),
                }
            }
        })
        .collect()
}

/// Sends "mcp-status" with every configured server. No-op without an app (tests).
async fn emit(conns: &ConnMap, app: Option<&AppHandle>) {
    let Some(app) = app else { return };
    let Some(state) = app.try_state::<AppState>() else { return };
    let configs = state.config().mcp_servers;
    let statuses = build_statuses(&*conns.lock().await, &configs);
    let _ = app.emit("mcp-status", statuses);
}

/// Starts a client, does the handshake and lists the tools. Closes it on failure.
async fn open(
    config: &McpServerConfig,
    tail: LogTail,
    events: mpsc::UnboundedSender<ClientEvent>,
) -> Result<(McpClient, Vec<ToolDef>), String> {
    let client = McpClient::start(config, tail, events).await?;
    if let Err(err) = client.initialize().await {
        client.close().await;
        return Err(err);
    }
    match client.list_tools().await {
        Ok(tools) => Ok((client, tools)),
        Err(err) => {
            client.close().await;
            Err(err)
        }
    }
}

/// Follows one connection: re-lists tools on `tools/list_changed`, and marks
/// the server as failed when the connection drops.
async fn watch_connection(
    conns: ConnMap,
    id: String,
    generation: u64,
    client: Weak<McpClient>,
    mut events: mpsc::UnboundedReceiver<ClientEvent>,
    app: Option<AppHandle>,
) {
    while let Some(event) = events.recv().await {
        match event {
            ClientEvent::ToolsChanged => {
                let Some(live) = client.upgrade() else { break };
                let listed = live.list_tools().await;
                drop(live);
                {
                    let mut map = conns.lock().await;
                    let Some(conn) = map.get_mut(&id).filter(|c| c.generation == generation) else { break };
                    match listed {
                        Ok(tools) => conn.tools = tools,
                        Err(err) => conn.tail.push(&format!("Could not refresh the tool list: {err}")),
                    }
                }
                emit(&conns, app.as_ref()).await;
            }
            ClientEvent::Closed(reason) => {
                let dead = {
                    let mut map = conns.lock().await;
                    match map.get_mut(&id).filter(|c| c.generation == generation) {
                        Some(conn) => {
                            conn.phase = Phase::Error(reason);
                            conn.client.take()
                        }
                        None => None,
                    }
                };
                if let Some(dead) = dead {
                    dead.close().await;
                }
                emit(&conns, app.as_ref()).await;
                break;
            }
        }
    }
}

impl McpManager {
    /// CONTRACT: connect (or reconnect) one server and list its tools.
    pub async fn connect(&self, app: &AppHandle, config: &McpServerConfig) -> Result<(), String> {
        self.connect_with(Some(app), config).await
    }

    /// `connect` without a Tauri app (no events). Used by tests.
    pub(crate) async fn connect_with(&self, app: Option<&AppHandle>, config: &McpServerConfig) -> Result<(), String> {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let tail = LogTail::default();
        let old = {
            let mut map = self.conns.lock().await;
            let conn = Connection {
                name: config.name.clone(),
                generation,
                phase: Phase::Connecting,
                client: None,
                server_name: None,
                server_version: None,
                tools: Vec::new(),
                tail: tail.clone(),
            };
            map.insert(config.id.clone(), conn).and_then(|c| c.client)
        };
        if let Some(old) = old {
            old.close().await;
        }
        emit(&self.conns, app).await;

        let (tx, rx) = mpsc::unbounded_channel();
        match open(config, tail, tx).await {
            Ok((client, tools)) => {
                let client = Arc::new(client);
                let info = client.info();
                let current = {
                    let mut map = self.conns.lock().await;
                    match map.get_mut(&config.id).filter(|c| c.generation == generation) {
                        Some(conn) => {
                            conn.phase = Phase::Connected;
                            conn.client = Some(client.clone());
                            conn.server_name = info.name;
                            conn.server_version = info.version;
                            conn.tools = tools;
                            true
                        }
                        None => false,
                    }
                };
                if !current {
                    // Disconnected or reconnected while we were starting.
                    client.close().await;
                    return Err("The connection was stopped before it finished.".into());
                }
                tokio::spawn(watch_connection(
                    self.conns.clone(),
                    config.id.clone(),
                    generation,
                    Arc::downgrade(&client),
                    rx,
                    app.cloned(),
                ));
                emit(&self.conns, app).await;
                Ok(())
            }
            Err(err) => {
                {
                    let mut map = self.conns.lock().await;
                    if let Some(conn) = map.get_mut(&config.id).filter(|c| c.generation == generation) {
                        conn.phase = Phase::Error(err.clone());
                    }
                }
                emit(&self.conns, app).await;
                Err(err)
            }
        }
    }

    /// CONTRACT
    pub async fn disconnect(&self, app: &AppHandle, server_id: &str) {
        self.disconnect_with(Some(app), server_id).await
    }

    pub(crate) async fn disconnect_with(&self, app: Option<&AppHandle>, server_id: &str) {
        let removed = self.conns.lock().await.remove(server_id);
        if let Some(client) = removed.and_then(|c| c.client) {
            client.close().await;
        }
        emit(&self.conns, app).await;
    }

    /// Stops connections whose server is no longer in the config.
    pub async fn prune(&self, configs: &[McpServerConfig]) {
        let stale: Vec<Arc<McpClient>> = {
            let mut map = self.conns.lock().await;
            let gone: Vec<String> = map.keys().filter(|id| !configs.iter().any(|c| &c.id == *id)).cloned().collect();
            gone.iter().filter_map(|id| map.remove(id)).filter_map(|c| c.client).collect()
        };
        futures_util::future::join_all(stale.iter().map(|c| c.close())).await;
    }

    /// CONTRACT: one status per configured server (disconnected when not running).
    pub async fn statuses(&self, configs: &[McpServerConfig]) -> Vec<McpServerStatus> {
        build_statuses(&*self.conns.lock().await, configs)
    }

    /// CONTRACT: all tools of all connected servers (the engine filters by config).
    pub async fn tools(&self) -> Vec<McpToolDescriptor> {
        let map = self.conns.lock().await;
        let mut connected: Vec<(&String, &Connection)> =
            map.iter().filter(|(_, c)| c.phase == Phase::Connected).collect();
        connected.sort_by(|a, b| a.1.name.cmp(&b.1.name).then(a.0.cmp(b.0)));
        connected
            .into_iter()
            .flat_map(|(id, c)| {
                c.tools.iter().map(move |t| McpToolDescriptor {
                    server_id: id.clone(),
                    server_name: c.name.clone(),
                    name: t.name.clone(),
                    description: t.description.clone(),
                    input_schema: t.input_schema.clone(),
                })
            })
            .collect()
    }

    /// CONTRACT: call a tool; returns the text content joined (images/resources described in text).
    /// An MCP tool result with `isError: true` → Err(text).
    pub async fn call_tool(&self, server_id: &str, tool: &str, arguments: serde_json::Value) -> Result<String, String> {
        let client = {
            let map = self.conns.lock().await;
            let conn = map.get(server_id).ok_or("This MCP server is not connected. Connect it on the MCP page first.")?;
            match (&conn.phase, &conn.client) {
                (Phase::Connected, Some(client)) => client.clone(),
                (Phase::Connecting, _) => {
                    return Err(format!("The MCP server \"{}\" is still starting. Try again in a moment.", conn.name))
                }
                (Phase::Error(err), _) => return Err(format!("The MCP server \"{}\" is not working: {err}", conn.name)),
                _ => return Err(format!("The MCP server \"{}\" is not connected.", conn.name)),
            }
        };
        client.call_tool(tool, arguments).await
    }

    /// CONTRACT: connect, list tools, disconnect. For the setup wizard.
    pub async fn test(&self, config: &McpServerConfig) -> McpTestResult {
        let started = Instant::now();
        let tail = LogTail::default();
        let (tx, _rx) = mpsc::unbounded_channel();
        let result = open(config, tail.clone(), tx).await;
        let mut out = match result {
            Ok((client, tools)) => {
                let info = client.info();
                client.close().await;
                McpTestResult {
                    ok: true,
                    error: None,
                    server_name: info.name,
                    server_version: info.version,
                    tools: summaries(&tools, &config.disabled_tools),
                    ..Default::default()
                }
            }
            Err(err) => McpTestResult { ok: false, error: Some(err), ..Default::default() },
        };
        out.stderr_tail = tail.snapshot();
        out.duration_ms = started.elapsed().as_millis() as u64;
        out
    }

    /// CONTRACT: stop every server. Called on app exit.
    pub async fn shutdown(&self) {
        let clients: Vec<Arc<McpClient>> =
            self.conns.lock().await.drain().filter_map(|(_, c)| c.client).collect();
        futures_util::future::join_all(clients.iter().map(|c| c.close())).await;
    }
}
