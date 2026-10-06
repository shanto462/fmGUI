//! OWNER: agent "mcp". JSON-RPC client for stdio and Streamable HTTP. See mcp/mod.rs.
//! One `McpClient` is one live connection: handshake, tools/list, tools/call.

use super::http::HttpTransport;
use super::rpc::{self, CallError, LogTail};
use super::stdio::{StdioSpec, StdioTransport};
use crate::config::{McpServerConfig, McpTransport};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::mpsc;

/// Things a connection tells its manager without being asked.
#[derive(Debug, Clone, PartialEq)]
pub enum ClientEvent {
    /// `notifications/tools/list_changed`: list the tools again.
    ToolsChanged,
    /// The connection is gone (process exited, ...). Not sent after `close()`.
    Closed(String),
}

/// Handles a notification from the server (both transports).
pub(crate) fn handle_notification(
    method: &str,
    params: &Value,
    tail: &LogTail,
    events: &mpsc::UnboundedSender<ClientEvent>,
) {
    match method {
        "notifications/tools/list_changed" => {
            let _ = events.send(ClientEvent::ToolsChanged);
        }
        "notifications/message" => tail.push(&rpc::log_line(params)),
        _ => {} // progress, resources, prompts, ...: not used in v1
    }
}

/// A tool as the server lists it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

impl ToolDef {
    fn from_value(v: &Value) -> Option<Self> {
        let name = v.get("name")?.as_str()?.to_string();
        let description = v
            .get("description")
            .and_then(Value::as_str)
            .or_else(|| v.get("title").and_then(Value::as_str))
            .or_else(|| v.get("annotations").and_then(|a| a.get("title")).and_then(Value::as_str))
            .unwrap_or_default()
            .to_string();
        let input_schema = match v.get("inputSchema") {
            Some(s) if s.is_object() => s.clone(),
            _ => json!({"type": "object", "properties": {}}),
        };
        Some(Self { name, description, input_schema })
    }
}

#[derive(Debug, Clone, Default)]
pub struct ServerInfo {
    pub name: Option<String>,
    pub version: Option<String>,
    pub protocol_version: Option<String>,
}

enum Transport {
    Stdio(StdioTransport),
    Http(HttpTransport),
}

pub struct McpClient {
    transport: Transport,
    next_id: AtomicU64,
    info: Mutex<ServerInfo>,
    /// Only one re-initialize at a time (Streamable HTTP session expiry).
    reinit: tokio::sync::Mutex<()>,
    tail: LogTail,
}

impl McpClient {
    /// Starts the transport (spawns the process for stdio). No handshake yet.
    pub async fn start(
        config: &McpServerConfig,
        tail: LogTail,
        events: mpsc::UnboundedSender<ClientEvent>,
    ) -> Result<Self, String> {
        let transport = match &config.transport {
            McpTransport::Stdio { command, args, env, cwd } => {
                let spec = StdioSpec {
                    command: command.clone(),
                    args: args.clone(),
                    env: env.iter().map(|kv| (kv.key.clone(), kv.value.clone())).collect(),
                    cwd: cwd.clone(),
                };
                Transport::Stdio(StdioTransport::spawn(spec, tail.clone(), events).await?)
            }
            McpTransport::Http { url, headers } => {
                Transport::Http(HttpTransport::new(url, headers, tail.clone(), events)?)
            }
        };
        Ok(Self {
            transport,
            next_id: AtomicU64::new(1),
            info: Mutex::new(ServerInfo::default()),
            reinit: tokio::sync::Mutex::new(()),
            tail,
        })
    }

    pub fn info(&self) -> ServerInfo {
        self.info.lock().unwrap().clone()
    }

    pub fn tail(&self) -> &LogTail {
        &self.tail
    }

    /// initialize → notifications/initialized.
    pub async fn initialize(&self) -> Result<(), String> {
        self.handshake().await.map_err(|e| match e {
            CallError::Rpc(err) => format!("The server refused to start: {}", err.user_message()),
            other => other.message_for("initialize"),
        })
    }

    async fn handshake(&self) -> Result<(), CallError> {
        let params = json!({
            "protocolVersion": rpc::PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "fmGUI", "version": "0.1.0"}
        });
        let result = self.raw_request("initialize", params, rpc::INITIALIZE_TIMEOUT).await?;
        let server = result.get("serverInfo");
        let text = |key: &str| server.and_then(|s| s.get(key)).and_then(Value::as_str).map(str::to_string);
        let protocol = result.get("protocolVersion").and_then(Value::as_str).unwrap_or(rpc::PROTOCOL_VERSION).to_string();
        *self.info.lock().unwrap() =
            ServerInfo { name: text("name"), version: text("version"), protocol_version: Some(protocol.clone()) };
        if let Transport::Http(http) = &self.transport {
            http.set_protocol_version(&protocol);
        }
        self.raw_notify("notifications/initialized", Value::Null).await
    }

    /// All tools, following `nextCursor` pages.
    pub async fn list_tools(&self) -> Result<Vec<ToolDef>, String> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..100 {
            let params = match &cursor {
                Some(c) => json!({"cursor": c}),
                None => Value::Null,
            };
            let result = match self.request("tools/list", params, rpc::LIST_TIMEOUT).await {
                Ok(r) => r,
                // A server without tools may not know the method.
                Err(CallError::Rpc(e)) if e.code == -32601 && cursor.is_none() => return Ok(Vec::new()),
                Err(e) => return Err(e.message_for("tools/list")),
            };
            if let Some(items) = result.get("tools").and_then(Value::as_array) {
                tools.extend(items.iter().filter_map(ToolDef::from_value));
            }
            match result.get("nextCursor").and_then(Value::as_str) {
                Some(next) if !next.is_empty() && cursor.as_deref() != Some(next) => cursor = Some(next.to_string()),
                _ => break,
            }
        }
        Ok(tools)
    }

    /// Calls a tool. Text parts are joined; other parts are described in text.
    /// `isError: true` → Err(text).
    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<String, String> {
        let arguments = if arguments.is_null() { json!({}) } else { arguments };
        let result = self
            .request("tools/call", json!({"name": name, "arguments": arguments}), rpc::CALL_TIMEOUT)
            .await
            .map_err(|e| e.message_for("tools/call"))?;
        let text = join_content(&result);
        if result.get("isError").and_then(Value::as_bool).unwrap_or(false) {
            return Err(if text.trim().is_empty() { "The tool reported an error.".into() } else { text });
        }
        Ok(text)
    }

    /// Stops the connection (process or HTTP session).
    pub async fn close(&self) {
        match &self.transport {
            Transport::Stdio(t) => t.close().await,
            Transport::Http(t) => t.close().await,
        }
    }

    /// A request; on Streamable HTTP, re-initializes once when the session expired.
    async fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, CallError> {
        match self.raw_request(method, params.clone(), timeout).await {
            Err(CallError::SessionExpired) => {
                {
                    let _guard = self.reinit.lock().await;
                    if let Transport::Http(http) = &self.transport {
                        http.reset_session();
                    }
                    self.handshake().await.map_err(|e| match e {
                        CallError::SessionExpired => CallError::Failed("The server ended the session.".into()),
                        other => other,
                    })?;
                }
                self.raw_request(method, params, timeout).await.map_err(|e| match e {
                    CallError::SessionExpired => CallError::Failed("The server ended the session again.".into()),
                    other => other,
                })
            }
            other => other,
        }
    }

    async fn raw_request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, CallError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        match &self.transport {
            Transport::Stdio(t) => t.request(id, method, params, timeout).await,
            Transport::Http(t) => t.request(id, method, params, timeout).await,
        }
    }

    async fn raw_notify(&self, method: &str, params: Value) -> Result<(), CallError> {
        match &self.transport {
            Transport::Stdio(t) => t.notify(method, params).await,
            Transport::Http(t) => t.notify(method, params).await,
        }
    }
}

/// Joins the content of a `tools/call` result into one text:
/// text → the text; image → "[image <mimeType>]"; audio → "[audio]";
/// resource → its text or "[resource <uri>]"; resource_link → "[link <uri>]".
/// When there is no text but `structuredContent`, it is shown as pretty JSON.
pub fn join_content(result: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut has_text = false;
    let str_of = |v: &Value, key: &str| v.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    for item in result.get("content").and_then(Value::as_array).into_iter().flatten() {
        match item.get("type").and_then(Value::as_str).unwrap_or_default() {
            "text" => {
                parts.push(str_of(item, "text"));
                has_text = true;
            }
            "image" => parts.push(format!("[image {}]", str_of(item, "mimeType")).replace(" ]", "]")),
            "audio" => parts.push("[audio]".into()),
            "resource" => {
                let resource = item.get("resource").cloned().unwrap_or(Value::Null);
                match resource.get("text").and_then(Value::as_str) {
                    Some(text) => {
                        parts.push(text.to_string());
                        has_text = true;
                    }
                    None => parts.push(format!("[resource {}]", str_of(&resource, "uri"))),
                }
            }
            "resource_link" => parts.push(format!("[link {}]", str_of(item, "uri"))),
            other if !other.is_empty() => parts.push(format!("[{other}]")),
            _ => {}
        }
    }
    if !has_text {
        if let Some(structured) = result.get("structuredContent").filter(|v| !v.is_null()) {
            let pretty = serde_json::to_string_pretty(structured).unwrap_or_default();
            parts.insert(0, pretty);
        }
    }
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_all_content_kinds() {
        let result = json!({
            "content": [
                {"type": "text", "text": "Hello"},
                {"type": "image", "data": "AAAA", "mimeType": "image/png"},
                {"type": "audio", "data": "AAAA", "mimeType": "audio/wav"},
                {"type": "resource", "resource": {"uri": "file:///notes.txt", "text": "Note body"}},
                {"type": "resource", "resource": {"uri": "file:///photo.jpg", "blob": "AAAA"}},
                {"type": "resource_link", "uri": "file:///readme.md", "name": "readme"}
            ]
        });
        assert_eq!(
            join_content(&result),
            "Hello\n[image image/png]\n[audio]\nNote body\n[resource file:///photo.jpg]\n[link file:///readme.md]"
        );
    }

    #[test]
    fn structured_content_when_no_text() {
        let result = json!({"content": [], "structuredContent": {"sum": 5}});
        assert_eq!(join_content(&result), "{\n  \"sum\": 5\n}");
        let with_text = json!({"content": [{"type": "text", "text": "5"}], "structuredContent": {"sum": 5}});
        assert_eq!(join_content(&with_text), "5");
        let image_only = json!({"content": [{"type": "image", "mimeType": "image/jpeg"}], "structuredContent": {"ok": true}});
        assert_eq!(join_content(&image_only), "{\n  \"ok\": true\n}\n[image image/jpeg]");
        assert_eq!(join_content(&json!({})), "");
    }

    #[test]
    fn tool_defs_have_defaults() {
        let t = ToolDef::from_value(&json!({"name": "echo"})).unwrap();
        assert_eq!(t.input_schema, json!({"type": "object", "properties": {}}));
        let t = ToolDef::from_value(&json!({"name": "x", "title": "X tool", "inputSchema": {"type": "object"}})).unwrap();
        assert_eq!(t.description, "X tool");
        assert!(ToolDef::from_value(&json!({"description": "no name"})).is_none());
    }

    #[test]
    fn notifications_reach_events_and_tail() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let tail = LogTail::default();
        handle_notification("notifications/tools/list_changed", &Value::Null, &tail, &tx);
        handle_notification("notifications/message", &json!({"level": "warning", "data": "disk almost full"}), &tail, &tx);
        handle_notification("notifications/progress", &json!({}), &tail, &tx);
        assert_eq!(rx.try_recv().unwrap(), ClientEvent::ToolsChanged);
        assert!(rx.try_recv().is_err());
        assert_eq!(tail.snapshot(), vec!["[warning] disk almost full".to_string()]);
    }
}
