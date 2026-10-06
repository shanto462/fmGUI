//! Streamable HTTP transport (MCP 2025-03-26 and later): every message is a
//! POST; the answer is JSON or an SSE stream. OWNER: agent "mcp".
//! The old HTTP+SSE transport (2024-11-05) is not supported.

use super::client::{handle_notification, ClientEvent};
use super::errors;
use super::rpc::{self, CallError, Incoming, LogTail};
use super::sse::{SseEvent, SseParser};
use crate::config::KeyValue;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use reqwest::StatusCode;
use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::mpsc;

const SESSION_HEADER: &str = "mcp-session-id";
const VERSION_HEADER: &str = "mcp-protocol-version";

pub struct HttpTransport {
    client: reqwest::Client,
    url: String,
    headers: HeaderMap,
    session_id: Mutex<Option<String>>,
    protocol_version: Mutex<Option<String>>,
    tail: LogTail,
    events: mpsc::UnboundedSender<ClientEvent>,
}

/// Checks the URL and the custom headers from the config.
pub fn validate(url: &str, headers: &[KeyValue]) -> Result<(String, HeaderMap), String> {
    let url = url.trim();
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| format!("The URL is not valid: {url}. Use a full address, for example http://localhost:3000/mcp."))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("The URL must start with http:// or https://, for example http://localhost:3000/mcp.".into());
    }
    let mut map = HeaderMap::new();
    for kv in headers {
        let key = kv.key.trim();
        if key.is_empty() {
            continue;
        }
        let name = HeaderName::from_bytes(key.as_bytes()).map_err(|_| format!("The header name \"{key}\" is not valid."))?;
        let value =
            HeaderValue::from_str(kv.value.trim()).map_err(|_| format!("The value of the header \"{key}\" is not valid."))?;
        map.insert(name, value);
    }
    Ok((url.to_string(), map))
}

impl HttpTransport {
    pub fn new(
        url: &str,
        headers: &[KeyValue],
        tail: LogTail,
        events: mpsc::UnboundedSender<ClientEvent>,
    ) -> Result<Self, String> {
        let (url, headers) = validate(url, headers)?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("Could not set up the HTTP client: {e}"))?;
        Ok(Self {
            client,
            url,
            headers,
            session_id: Mutex::new(None),
            protocol_version: Mutex::new(None),
            tail,
            events,
        })
    }

    pub fn set_protocol_version(&self, version: &str) {
        *self.protocol_version.lock().unwrap() = Some(version.to_string());
    }

    pub fn session_id(&self) -> Option<String> {
        self.session_id.lock().unwrap().clone()
    }

    /// Forget the session before a new `initialize`.
    pub fn reset_session(&self) {
        *self.session_id.lock().unwrap() = None;
        *self.protocol_version.lock().unwrap() = None;
    }

    pub async fn request(&self, id: u64, method: &str, params: Value, timeout: Duration) -> Result<Value, CallError> {
        let msg = rpc::request(id, method, params);
        match tokio::time::timeout(timeout, self.exchange(&msg, id, method == "initialize")).await {
            Ok(result) => result,
            Err(_) => Err(CallError::Timeout(timeout.as_secs())),
        }
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), CallError> {
        let msg = rpc::notification(method, params);
        let resp = match tokio::time::timeout(Duration::from_secs(30), self.post(&msg)).await {
            Ok(r) => r?,
            Err(_) => return Err(CallError::Timeout(30)),
        };
        let status = resp.status();
        if status == StatusCode::NOT_FOUND && self.session_id().is_some() {
            return Err(CallError::SessionExpired);
        }
        if !status.is_success() {
            return Err(self.status_error(resp, false).await);
        }
        Ok(())
    }

    /// Ends the session on the server (DELETE). Errors are ignored.
    pub async fn close(&self) {
        let Some(session) = self.session_id() else { return };
        let mut headers = self.headers.clone();
        if let Ok(v) = HeaderValue::from_str(&session) {
            headers.insert(SESSION_HEADER, v);
        }
        if let Some(Ok(v)) = self.protocol_version.lock().unwrap().as_deref().map(HeaderValue::from_str) {
            headers.insert(VERSION_HEADER, v);
        }
        let _ = tokio::time::timeout(Duration::from_secs(5), self.client.delete(&self.url).headers(headers).send()).await;
        *self.session_id.lock().unwrap() = None;
    }

    async fn exchange(&self, msg: &Value, id: u64, is_init: bool) -> Result<Value, CallError> {
        let resp = self.post(msg).await?;
        let status = resp.status();
        if is_init {
            if let Some(session) = resp.headers().get(SESSION_HEADER).and_then(|v| v.to_str().ok()) {
                *self.session_id.lock().unwrap() = Some(session.to_string());
            }
        }
        if status == StatusCode::NOT_FOUND && !is_init && self.session_id().is_some() {
            return Err(CallError::SessionExpired);
        }
        if !status.is_success() {
            return Err(self.status_error(resp, is_init).await);
        }
        if status == StatusCode::ACCEPTED {
            return Err(CallError::Failed("The server accepted the request but sent no answer.".into()));
        }
        let content_type = resp
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if content_type.starts_with("text/event-stream") {
            return self.read_sse(resp, id).await;
        }
        let text = resp.text().await.map_err(|e| CallError::Failed(format!("The connection broke: {e}")))?;
        let Some(messages) = rpc::parse_messages(&text) else {
            return Err(CallError::Failed(if is_init {
                "This URL did not answer like an MCP server. Check the URL (it often ends in /mcp).".into()
            } else {
                format!("The server sent an answer fmGUI could not read: {}", crate::util::truncate_chars(text.trim(), 200))
            }));
        };
        let mut found = None;
        for m in messages {
            if let Some(result) = self.handle(m, id).await {
                found = Some(result);
            }
        }
        found.unwrap_or_else(|| Err(CallError::Failed("The server answer did not include a reply to this request.".into())))
    }

    async fn read_sse(&self, resp: reqwest::Response, id: u64) -> Result<Value, CallError> {
        let mut stream = resp.bytes_stream();
        let mut parser = SseParser::default();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| CallError::Failed(format!("The connection broke: {e}")))?;
            for event in parser.push(&chunk) {
                if let Some(result) = self.handle_event(event, id).await {
                    return result;
                }
            }
        }
        for event in parser.finish() {
            if let Some(result) = self.handle_event(event, id).await {
                return result;
            }
        }
        Err(CallError::Failed("The server closed the stream before it answered.".into()))
    }

    async fn handle_event(&self, event: SseEvent, id: u64) -> Option<Result<Value, CallError>> {
        if !event.is_message() || event.data.trim().is_empty() {
            return None;
        }
        let Some(messages) = rpc::parse_messages(&event.data) else {
            self.tail.push(&format!("[sse] {}", event.data));
            return None;
        };
        let mut found = None;
        for m in messages {
            if let Some(result) = self.handle(m, id).await {
                found = Some(result);
            }
        }
        found
    }

    /// Handles one message. Returns the result when it answers request `id`.
    async fn handle(&self, msg: Incoming, id: u64) -> Option<Result<Value, CallError>> {
        match msg {
            Incoming::Response { id: rid, result } if rid == id => Some(result.map_err(CallError::Rpc)),
            Incoming::Response { .. } => None,
            Incoming::Request { id: rid, method, .. } => {
                let reply = rpc::reply_to_server_request(&rid, &method);
                if let Err(err) = self.post(&reply).await {
                    self.tail.push(&err.message_for(""));
                }
                None
            }
            Incoming::Notification { method, params } => {
                handle_notification(&method, &params, &self.tail, &self.events);
                None
            }
            Incoming::Unknown(v) => {
                if let Some(err) = v.get("error") {
                    self.tail.push(&format!("server error: {err}"));
                }
                None
            }
        }
    }

    async fn post(&self, msg: &Value) -> Result<reqwest::Response, CallError> {
        let mut headers = self.headers.clone();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(ACCEPT, HeaderValue::from_static("application/json, text/event-stream"));
        if let Some(Ok(v)) = self.session_id().as_deref().map(HeaderValue::from_str) {
            headers.insert(SESSION_HEADER, v);
        }
        if let Some(Ok(v)) = self.protocol_version.lock().unwrap().as_deref().map(HeaderValue::from_str) {
            headers.insert(VERSION_HEADER, v);
        }
        let body = serde_json::to_vec(msg).map_err(|e| CallError::Failed(e.to_string()))?;
        self.client
            .post(&self.url)
            .headers(headers)
            .body(body)
            .send()
            .await
            .map_err(|e| CallError::Failed(errors::http_send_error(&self.url, &e)))
    }

    async fn status_error(&self, resp: reqwest::Response, is_init: bool) -> CallError {
        let code = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if let Some(messages) = rpc::parse_messages(&text) {
            for m in messages {
                if let Incoming::Response { result: Err(err), .. } = m {
                    return CallError::Rpc(err);
                }
            }
        }
        let snippet = crate::util::truncate_chars(text.trim(), 300);
        match code {
            401 | 403 => CallError::Failed(format!(
                "The server refused access (HTTP {code}). Check the headers, for example add Authorization: Bearer <your token>."
            )),
            400..=499 if is_init => CallError::Failed(format!(
                "The server answered HTTP {code}. This server may use the old SSE transport, which fmGUI does not support yet."
            )),
            _ if snippet.is_empty() => CallError::Failed(format!("The server answered HTTP {code}.")),
            _ => CallError::Failed(format!("The server answered HTTP {code}: {snippet}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_urls_and_headers() {
        assert!(validate("ftp://example.com", &[]).unwrap_err().contains("http://"));
        assert!(validate("localhost:3000", &[]).is_err());
        let (url, headers) = validate(
            " https://example.com/mcp ",
            &[
                KeyValue { key: "Authorization".into(), value: "Bearer test-token".into() },
                KeyValue { key: "".into(), value: "ignored".into() },
            ],
        )
        .unwrap();
        assert_eq!(url, "https://example.com/mcp");
        assert_eq!(headers.get("authorization").unwrap(), "Bearer test-token");
        assert!(validate("http://x", &[KeyValue { key: "Bad Header".into(), value: "x".into() }]).is_err());
    }
}
