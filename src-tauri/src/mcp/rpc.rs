//! JSON-RPC 2.0 framing for MCP: building messages, classifying what the
//! server sends, matching responses to requests, and the small log tail.
//! OWNER: agent "mcp".

use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

/// The MCP protocol version we ask for. We accept whatever the server answers.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

pub const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(60);
pub const LIST_TIMEOUT: Duration = Duration::from_secs(30);
pub const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// A JSON-RPC error object sent by the server.
#[derive(Debug, Clone, PartialEq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

impl RpcError {
    pub fn from_value(v: &Value) -> Self {
        Self {
            code: v.get("code").and_then(Value::as_i64).unwrap_or(0),
            message: v.get("message").and_then(Value::as_str).unwrap_or_default().to_string(),
            data: v.get("data").cloned(),
        }
    }

    /// The message for people. Falls back to the code when the server sent no text.
    pub fn user_message(&self) -> String {
        let msg = self.message.trim();
        if msg.is_empty() {
            format!("The server returned error {}.", self.code)
        } else {
            msg.to_string()
        }
    }
}

/// Why a request did not produce a result.
#[derive(Debug, Clone, PartialEq)]
pub enum CallError {
    /// The server answered with a JSON-RPC error.
    Rpc(RpcError),
    /// The connection is gone. The text explains why (exit code, last output).
    Closed(String),
    /// No answer in time (seconds).
    Timeout(u64),
    /// Streamable HTTP: the server forgot our session (HTTP 404 with a session id).
    SessionExpired,
    /// Any other transport problem, already written for people.
    Failed(String),
}

impl CallError {
    /// A message for people. `method` picks a better timeout text.
    pub fn message_for(&self, method: &str) -> String {
        match self {
            CallError::Rpc(e) => e.user_message(),
            CallError::Closed(reason) => reason.clone(),
            CallError::Failed(msg) => msg.clone(),
            CallError::SessionExpired => "The server ended the session. Connect again.".into(),
            CallError::Timeout(secs) => match method {
                "initialize" => format!(
                    "The server did not answer within {secs} seconds. The first start with npx or uvx can be slow while it downloads. Try again."
                ),
                "tools/list" => format!("The server did not list its tools within {secs} seconds."),
                "tools/call" => format!("The tool did not finish within {secs} seconds."),
                _ => format!("The server did not answer within {secs} seconds."),
            },
        }
    }
}

/// One message from the server.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    /// An answer to one of our requests.
    Response { id: u64, result: Result<Value, RpcError> },
    /// The server asks us something (ping, roots/list, ...).
    Request { id: Value, method: String, params: Value },
    Notification { method: String, params: Value },
    /// Valid JSON that is not a message we can use (for example a response with a null id).
    Unknown(Value),
}

/// Our ids are numbers, but accept a numeric string too.
fn id_as_u64(v: &Value) -> Option<u64> {
    match v {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

pub fn classify(v: Value) -> Incoming {
    let Some(obj) = v.as_object() else { return Incoming::Unknown(v) };
    if let Some(method) = obj.get("method").and_then(Value::as_str) {
        let params = obj.get("params").cloned().unwrap_or(Value::Null);
        return match obj.get("id") {
            Some(id) if !id.is_null() => Incoming::Request { id: id.clone(), method: method.to_string(), params },
            _ => Incoming::Notification { method: method.to_string(), params },
        };
    }
    let has_result = obj.contains_key("result");
    let has_error = obj.contains_key("error");
    if has_result || has_error {
        if let Some(id) = obj.get("id").and_then(id_as_u64) {
            let result = match obj.get("error") {
                Some(err) if !err.is_null() => Err(RpcError::from_value(err)),
                _ => Ok(obj.get("result").cloned().unwrap_or(Value::Null)),
            };
            return Incoming::Response { id, result };
        }
    }
    Incoming::Unknown(v)
}

/// Parses one JSON text (a message or a batch). None when it is not JSON.
pub fn parse_messages(text: &str) -> Option<Vec<Incoming>> {
    let value: Value = serde_json::from_str(text.trim()).ok()?;
    Some(match value {
        Value::Array(items) => items.into_iter().map(classify).collect(),
        other => vec![classify(other)],
    })
}

pub fn request(id: u64, method: &str, params: Value) -> Value {
    if params.is_null() {
        json!({"jsonrpc": "2.0", "id": id, "method": method})
    } else {
        json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
    }
}

pub fn notification(method: &str, params: Value) -> Value {
    if params.is_null() {
        json!({"jsonrpc": "2.0", "method": method})
    } else {
        json!({"jsonrpc": "2.0", "method": method, "params": params})
    }
}

/// Our answer to a request the server sent us. We support only `ping` and
/// `roots/list` (no roots). Everything else is "method not found".
pub fn reply_to_server_request(id: &Value, method: &str) -> Value {
    match method {
        "ping" => json!({"jsonrpc": "2.0", "id": id, "result": {}}),
        "roots/list" => json!({"jsonrpc": "2.0", "id": id, "result": {"roots": []}}),
        _ => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {"code": -32601, "message": format!("Method not found: {method}")}
        }),
    }
}

type Waiter = oneshot::Sender<Result<Value, CallError>>;

#[derive(Default)]
struct PendingInner {
    waiters: HashMap<u64, Waiter>,
    /// Set once the connection is gone; new requests fail at once.
    closed: Option<String>,
}

/// Requests waiting for an answer, keyed by id.
#[derive(Clone, Default)]
pub struct PendingMap(Arc<Mutex<PendingInner>>);

impl PendingMap {
    /// Registers a waiter. Fails when the connection is already closed.
    pub fn insert(&self, id: u64) -> Result<oneshot::Receiver<Result<Value, CallError>>, CallError> {
        let mut inner = self.0.lock().unwrap();
        if let Some(reason) = &inner.closed {
            return Err(CallError::Closed(reason.clone()));
        }
        let (tx, rx) = oneshot::channel();
        inner.waiters.insert(id, tx);
        Ok(rx)
    }

    pub fn remove(&self, id: u64) {
        self.0.lock().unwrap().waiters.remove(&id);
    }

    /// Delivers a response. Returns false when nobody waits for this id.
    pub fn resolve(&self, id: u64, result: Result<Value, RpcError>) -> bool {
        let waiter = self.0.lock().unwrap().waiters.remove(&id);
        match waiter {
            Some(tx) => {
                let _ = tx.send(result.map_err(CallError::Rpc));
                true
            }
            None => false,
        }
    }

    /// Marks the connection closed and fails every waiting request.
    /// Returns false when it was already closed.
    pub fn close(&self, reason: &str) -> bool {
        let waiters = {
            let mut inner = self.0.lock().unwrap();
            if inner.closed.is_some() {
                return false;
            }
            inner.closed = Some(reason.to_string());
            std::mem::take(&mut inner.waiters)
        };
        for (_, tx) in waiters {
            let _ = tx.send(Err(CallError::Closed(reason.to_string())));
        }
        true
    }

    pub fn closed_reason(&self) -> Option<String> {
        self.0.lock().unwrap().closed.clone()
    }

    pub fn len(&self) -> usize {
        self.0.lock().unwrap().waiters.len()
    }
}

const TAIL_LINES: usize = 50;
const TAIL_LINE_CHARS: usize = 1000;

/// The last lines a server printed on stderr (plus log notifications and
/// stray stdout lines), for the status page.
#[derive(Clone, Default)]
pub struct LogTail(Arc<Mutex<VecDeque<String>>>);

impl LogTail {
    pub fn push(&self, line: &str) {
        let line = crate::util::strip_ansi(line);
        let line = line.trim_end();
        if line.trim().is_empty() {
            return;
        }
        let line = if line.chars().count() > TAIL_LINE_CHARS {
            let cut: String = line.chars().take(TAIL_LINE_CHARS).collect();
            format!("{cut}…")
        } else {
            line.to_string()
        };
        let mut q = self.0.lock().unwrap();
        if q.len() == TAIL_LINES {
            q.pop_front();
        }
        q.push_back(line);
    }

    pub fn snapshot(&self) -> Vec<String> {
        self.0.lock().unwrap().iter().cloned().collect()
    }

    /// The last `n` lines, oldest first.
    pub fn last(&self, n: usize) -> Vec<String> {
        let q = self.0.lock().unwrap();
        q.iter().skip(q.len().saturating_sub(n)).cloned().collect()
    }
}

/// Text for a `notifications/message` (MCP logging) line in the tail.
pub fn log_line(params: &Value) -> String {
    let level = params.get("level").and_then(Value::as_str).unwrap_or("info");
    let logger = params.get("logger").and_then(Value::as_str);
    let data = match params.get("data") {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    match logger {
        Some(l) => format!("[{level}] {l}: {data}"),
        None => format!("[{level}] {data}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_requests_and_notifications() {
        let r = request(7, "tools/list", Value::Null);
        assert_eq!(r, json!({"jsonrpc": "2.0", "id": 7, "method": "tools/list"}));
        let r = request(8, "tools/call", json!({"name": "add"}));
        assert_eq!(r["params"]["name"], "add");
        let n = notification("notifications/initialized", Value::Null);
        assert!(n.get("id").is_none());
        assert_eq!(n["method"], "notifications/initialized");
    }

    #[test]
    fn classifies_messages() {
        let ok = classify(json!({"jsonrpc": "2.0", "id": 3, "result": {"x": 1}}));
        assert_eq!(ok, Incoming::Response { id: 3, result: Ok(json!({"x": 1})) });

        let string_id = classify(json!({"jsonrpc": "2.0", "id": "4", "result": null}));
        assert_eq!(string_id, Incoming::Response { id: 4, result: Ok(Value::Null) });

        let err = classify(json!({"jsonrpc": "2.0", "id": 5, "error": {"code": -32602, "message": "Bad params"}}));
        match err {
            Incoming::Response { id: 5, result: Err(e) } => {
                assert_eq!(e.code, -32602);
                assert_eq!(e.user_message(), "Bad params");
            }
            other => panic!("unexpected {other:?}"),
        }

        let req = classify(json!({"jsonrpc": "2.0", "id": "srv-1", "method": "ping"}));
        assert_eq!(req, Incoming::Request { id: json!("srv-1"), method: "ping".into(), params: Value::Null });

        let note = classify(json!({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}));
        assert!(matches!(note, Incoming::Notification { ref method, .. } if method == "notifications/tools/list_changed"));

        let null_id = classify(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "Parse error"}}));
        assert!(matches!(null_id, Incoming::Unknown(_)));
    }

    #[test]
    fn parses_batches_and_rejects_non_json() {
        let msgs = parse_messages(r#"[{"jsonrpc":"2.0","id":1,"result":{}},{"jsonrpc":"2.0","method":"x"}]"#).unwrap();
        assert_eq!(msgs.len(), 2);
        assert!(parse_messages("Starting server on stdio...").is_none());
    }

    #[test]
    fn answers_server_requests() {
        let id = json!(9);
        assert_eq!(reply_to_server_request(&id, "ping"), json!({"jsonrpc": "2.0", "id": 9, "result": {}}));
        assert_eq!(reply_to_server_request(&id, "roots/list")["result"]["roots"], json!([]));
        let other = reply_to_server_request(&id, "sampling/createMessage");
        assert_eq!(other["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn pending_map_matches_and_fails() {
        let pending = PendingMap::default();
        let rx1 = pending.insert(1).unwrap();
        let rx2 = pending.insert(2).unwrap();
        assert!(pending.resolve(2, Ok(json!("two"))));
        assert!(!pending.resolve(42, Ok(json!("nobody"))));
        assert_eq!(rx2.await.unwrap(), Ok(json!("two")));
        assert!(pending.close("The server stopped (exit code 1)."));
        assert!(!pending.close("again"));
        assert_eq!(rx1.await.unwrap(), Err(CallError::Closed("The server stopped (exit code 1).".into())));
        assert!(matches!(pending.insert(3), Err(CallError::Closed(_))));
        assert_eq!(pending.len(), 0);
    }

    #[test]
    fn log_tail_keeps_last_lines() {
        let tail = LogTail::default();
        for i in 0..60 {
            tail.push(&format!("line {i}"));
        }
        tail.push("   ");
        tail.push("\u{1B}[31mred\u{1B}[0m");
        let lines = tail.snapshot();
        assert_eq!(lines.len(), 50);
        assert_eq!(lines.last().unwrap(), "red");
        assert_eq!(tail.last(2), vec!["line 59".to_string(), "red".to_string()]);
    }

    #[test]
    fn timeout_messages_depend_on_method() {
        assert!(CallError::Timeout(60).message_for("initialize").contains("npx"));
        assert_eq!(CallError::Timeout(120).message_for("tools/call"), "The tool did not finish within 120 seconds.");
    }
}
