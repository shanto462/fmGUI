//! The private `fm serve --socket <path>` instance owned by the engine
//! (decisions.md D6), and a tiny HTTP/1.1 client that talks to it over the
//! Unix socket. OWNER: agent "engine".

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper_util::rt::TokioIo;
use serde_json::Value;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncBufReadExt;
use tokio::net::UnixStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::EngineStatus;

/// How long we wait for a fresh server to answer `/health`.
const START_TIMEOUT: Duration = Duration::from_secs(15);
/// Lines of stderr we keep for error messages.
const STDERR_LINES: usize = 40;
/// Max wait between two pieces of a streamed reply.
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// Max wait for a non-streamed reply.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
/// macOS limits Unix socket paths to 104 bytes (with the final NUL).
const MAX_SOCKET_PATH: usize = 100;

/// What went wrong with a request to `fm serve`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FmErrorKind {
    /// "The session's transcript exceeded the model's context size."
    ContextOverflow,
    /// "The model's safety guardrails were triggered."
    Guardrails,
    /// Any other error reply from the server.
    Server,
    /// Could not reach the server (not running, crashed, socket gone).
    Transport,
}

#[derive(Debug, Clone)]
pub struct FmError {
    pub kind: FmErrorKind,
    /// HTTP status (0 for transport errors).
    pub status: u16,
    pub message: String,
}

impl FmError {
    pub fn transport(message: impl Into<String>) -> Self {
        Self { kind: FmErrorKind::Transport, status: 0, message: message.into() }
    }

    /// Builds an error from a server reply (`{"error":{"message",...}}` or text).
    pub fn from_reply(status: u16, body: &Value) -> Self {
        let message = body
            .get("error")
            .and_then(|e| e.get("message").and_then(Value::as_str).or_else(|| e.as_str()))
            .map(str::to_string)
            .unwrap_or_else(|| match body {
                Value::String(s) if !s.trim().is_empty() => s.trim().to_string(),
                Value::Null => format!("fm serve replied with HTTP {status}."),
                other => other.to_string(),
            });
        Self::from_message(status, message)
    }

    pub fn from_message(status: u16, message: String) -> Self {
        let lower = message.to_lowercase();
        let kind = if lower.contains("context size") || lower.contains("context window") || lower.contains("exceeded the model") {
            FmErrorKind::ContextOverflow
        } else if lower.contains("guardrail") {
            FmErrorKind::Guardrails
        } else {
            FmErrorKind::Server
        };
        Self { kind, status, message }
    }
}

impl std::fmt::Display for FmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// One Server-Sent Event.
#[derive(Debug, Clone, PartialEq)]
pub struct SseEvent {
    /// The `event:` field, when present (`fm serve` uses "error").
    pub event: Option<String>,
    pub data: String,
}

/// Owns the child process.
pub struct FmServer {
    configured_socket: PathBuf,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    child: Option<Child>,
    pid: Option<u32>,
    socket: Option<PathBuf>,
    fm_path: Option<String>,
    last_error: Option<String>,
    stderr_tail: Arc<StdMutex<VecDeque<String>>>,
    stderr_task: Option<JoinHandle<()>>,
}

impl FmServer {
    pub fn new(socket_path: PathBuf) -> Self {
        Self { configured_socket: socket_path, inner: Mutex::new(Inner::default()) }
    }

    /// The socket path really used (the configured one, or a short fallback
    /// in the per-user temp folder when the configured path is too long).
    pub fn effective_socket(&self) -> PathBuf {
        effective_socket_path(&self.configured_socket)
    }

    pub async fn status(&self) -> EngineStatus {
        let mut inner = self.inner.lock().await;
        let running = match inner.child.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        };
        EngineStatus {
            running,
            socket_path: inner.socket.clone().unwrap_or_else(|| self.effective_socket()).display().to_string(),
            pid: if running { inner.pid } else { None },
            last_error: inner.last_error.clone(),
        }
    }

    /// Makes sure the server runs and answers `/health`. Starts it when needed.
    pub async fn ensure(&self, fm_path: &str) -> Result<PathBuf, String> {
        let mut inner = self.inner.lock().await;
        let same_binary = inner.fm_path.as_deref() == Some(fm_path);
        if same_binary {
            if let (Some(socket), Some(child)) = (inner.socket.clone(), inner.child.as_mut()) {
                if matches!(child.try_wait(), Ok(None)) && health(&socket).await.is_ok() {
                    return Ok(socket);
                }
            }
        }
        self.start_locked(&mut inner, fm_path).await
    }

    /// Stops the server (if any) and starts a new one.
    pub async fn restart(&self, fm_path: &str) -> Result<PathBuf, String> {
        let mut inner = self.inner.lock().await;
        self.start_locked(&mut inner, fm_path).await
    }

    /// Stops a generation that nobody reads anymore (Stop button, stalled
    /// stream). `fm serve` keeps generating after the client goes away, and
    /// the on-device model serves one request at a time, so the only way to
    /// free it is to stop the process. The next request starts a new one.
    pub async fn abort_generation(&self) {
        self.stop().await;
    }

    /// Stops the server and removes the socket file.
    pub async fn stop(&self) {
        let mut inner = self.inner.lock().await;
        stop_locked(&mut inner).await;
    }

    async fn start_locked(&self, inner: &mut Inner, fm_path: &str) -> Result<PathBuf, String> {
        stop_locked(inner).await;
        inner.fm_path = Some(fm_path.to_string());
        let result = self.spawn_and_wait(inner, fm_path).await;
        match &result {
            Ok(_) => inner.last_error = None,
            Err(err) => {
                inner.last_error = Some(err.clone());
                stop_locked(inner).await;
            }
        }
        result
    }

    async fn spawn_and_wait(&self, inner: &mut Inner, fm_path: &str) -> Result<PathBuf, String> {
        let socket = self.effective_socket();
        if let Some(parent) = socket.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        // A socket file left by a crash makes `fm serve` fail to bind.
        if std::fs::symlink_metadata(&socket).is_ok() {
            let _ = std::fs::remove_file(&socket);
        }

        let mut child = Command::new(fm_path)
            .arg("serve")
            .arg("--socket")
            .arg(&socket)
            // fm buffers its log lines when not on a terminal.
            .env("NSUnbufferedIO", "YES")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|err| {
                if err.kind() == std::io::ErrorKind::NotFound {
                    format!("fm was not found at {fm_path}. Check the fm path in Settings.")
                } else {
                    format!("Could not start fm serve: {err}")
                }
            })?;

        let tail = Arc::new(StdMutex::new(VecDeque::new()));
        inner.stderr_tail = tail.clone();
        if let Some(stderr) = child.stderr.take() {
            inner.stderr_task = Some(tokio::spawn(async move {
                let mut lines = tokio::io::BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = crate::util::strip_ansi(&line).trim_end().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    let mut tail = tail.lock().unwrap();
                    if tail.len() >= STDERR_LINES {
                        tail.pop_front();
                    }
                    tail.push_back(line);
                }
            }));
        }
        inner.pid = child.id();

        let started = Instant::now();
        loop {
            if let Ok(Some(status)) = child.try_wait() {
                // Give the stderr reader a moment to collect the last lines.
                tokio::time::sleep(Duration::from_millis(150)).await;
                let text = tail_text(&inner.stderr_tail);
                return Err(start_error(status.code(), &text));
            }
            if socket.exists() && health(&socket).await.is_ok() {
                inner.child = Some(child);
                inner.socket = Some(socket.clone());
                return Ok(socket);
            }
            if started.elapsed() > START_TIMEOUT {
                let _ = child.start_kill();
                let _ = child.wait().await;
                let text = tail_text(&inner.stderr_tail);
                let mut msg = "fm serve did not start within 15 seconds.".to_string();
                if !text.is_empty() {
                    msg.push(' ');
                    msg.push_str(&text);
                }
                return Err(msg);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// Socket of a running server; starts one (with the last fm path) when none runs.
    async fn socket_for_request(&self) -> Result<PathBuf, FmError> {
        let fm_path = {
            let mut inner = self.inner.lock().await;
            if let (Some(socket), Some(child)) = (inner.socket.clone(), inner.child.as_mut()) {
                if matches!(child.try_wait(), Ok(None)) {
                    return Ok(socket);
                }
            }
            inner.fm_path.clone().unwrap_or_else(|| "/usr/bin/fm".into())
        };
        self.ensure(&fm_path).await.map_err(FmError::transport)
    }

    /// Restarts after a transport failure, but only when the server really died.
    async fn recover(&self) -> Result<PathBuf, FmError> {
        let mut inner = self.inner.lock().await;
        if let (Some(socket), Some(child)) = (inner.socket.clone(), inner.child.as_mut()) {
            if matches!(child.try_wait(), Ok(None)) && health(&socket).await.is_ok() {
                // Still alive: the failure was a hiccup, just retry.
                return Ok(socket);
            }
        }
        let fm_path = inner.fm_path.clone().unwrap_or_else(|| "/usr/bin/fm".into());
        self.start_locked(&mut inner, &fm_path).await.map_err(FmError::transport)
    }

    /// Sends one request. Restarts the server once when it cannot be reached.
    async fn send(&self, method: &str, path: &str, body: Option<&Value>) -> Result<hyper::Response<Incoming>, FmError> {
        let socket = self.socket_for_request().await?;
        match send_request(&socket, method, path, body).await {
            Ok(resp) => Ok(resp),
            Err(first) => {
                let socket = self.recover().await.map_err(|err| FmError::transport(format!("{first} ({err})")))?;
                send_request(&socket, method, path, body).await
            }
        }
    }

    /// GET a JSON endpoint (`/health`, `/v1/models`).
    pub async fn get_json(&self, path: &str) -> Result<(u16, Value), FmError> {
        let resp = self.send("GET", path, None).await?;
        read_json(resp).await
    }

    /// POST JSON and read the whole JSON reply. Error replies are returned
    /// as `Ok((status, body))`; only transport problems are `Err`.
    pub async fn post_json(&self, path: &str, body: &Value) -> Result<(u16, Value), FmError> {
        let resp = self.send("POST", path, Some(body)).await?;
        read_json(resp).await
    }

    /// POST JSON and stream the Server-Sent Events of the reply. A non-200
    /// reply becomes an `FmError` with the server's message.
    pub async fn post_stream(&self, path: &str, body: &Value) -> Result<SseStream, FmError> {
        let resp = self.send("POST", path, Some(body)).await?;
        let status = resp.status().as_u16();
        if status != 200 {
            let (status, body) = read_json(resp).await?;
            return Err(FmError::from_reply(status, &body));
        }
        Ok(SseStream { body: resp.into_body(), buf: Vec::new(), queue: VecDeque::new(), finished: false })
    }
}

async fn stop_locked(inner: &mut Inner) {
    if let Some(mut child) = inner.child.take() {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
    }
    if let Some(task) = inner.stderr_task.take() {
        task.abort();
    }
    if let Some(socket) = inner.socket.take() {
        let _ = std::fs::remove_file(socket);
    }
    inner.pid = None;
}

fn tail_text(tail: &Arc<StdMutex<VecDeque<String>>>) -> String {
    let lines: Vec<String> = tail.lock().unwrap().iter().cloned().collect();
    let text = lines.join("\n");
    crate::util::clean_fm_error(&text)
}

/// Human message for a server that exited during start-up.
pub fn start_error(code: Option<i32>, stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if code == Some(69) || lower.contains("license") {
        return "The Foundation Models license is not accepted yet. Open Setup and follow the steps, then try again.".into();
    }
    let mut msg = match code {
        Some(c) => format!("fm serve stopped right away (exit code {c})."),
        None => "fm serve stopped right away.".to_string(),
    };
    if !stderr.trim().is_empty() {
        msg.push(' ');
        msg.push_str(stderr.trim());
    }
    msg
}

/// Uses a short path in the per-user temp folder when `path` is too long for
/// a Unix socket.
pub fn effective_socket_path(path: &Path) -> PathBuf {
    if path.as_os_str().len() <= MAX_SOCKET_PATH {
        return path.to_path_buf();
    }
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    let short = std::env::temp_dir().join(format!("fmgui-{:016x}.sock", hasher.finish()));
    if short.as_os_str().len() <= MAX_SOCKET_PATH {
        short
    } else {
        PathBuf::from(format!("/tmp/fmgui-{:016x}.sock", hasher.finish()))
    }
}

async fn health(socket: &Path) -> Result<(), FmError> {
    let resp = tokio::time::timeout(Duration::from_secs(3), send_request(socket, "GET", "/health", None))
        .await
        .map_err(|_| FmError::transport("health check timed out"))??;
    if resp.status().as_u16() == 200 {
        Ok(())
    } else {
        Err(FmError::transport(format!("health check returned HTTP {}", resp.status().as_u16())))
    }
}

/// One request on a fresh connection (`fm serve` closes after each reply).
async fn send_request(
    socket: &Path,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> Result<hyper::Response<Incoming>, FmError> {
    let stream = UnixStream::connect(socket)
        .await
        .map_err(|err| FmError::transport(format!("Could not connect to the engine: {err}")))?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake::<_, Full<Bytes>>(TokioIo::new(stream))
        .await
        .map_err(|err| FmError::transport(format!("Could not talk to the engine: {err}")))?;
    // The connection task ends when the response body is fully read or dropped.
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let bytes = match body {
        Some(v) => Bytes::from(serde_json::to_vec(v).unwrap_or_default()),
        None => Bytes::new(),
    };
    let mut builder = hyper::Request::builder().method(method).uri(path).header("host", "localhost");
    if body.is_some() {
        builder = builder.header("content-type", "application/json").header("content-length", bytes.len());
    }
    let req = builder.body(Full::new(bytes)).map_err(|err| FmError::transport(err.to_string()))?;
    sender
        .send_request(req)
        .await
        .map_err(|err| FmError::transport(format!("The engine closed the connection: {err}")))
}

async fn read_json(resp: hyper::Response<Incoming>) -> Result<(u16, Value), FmError> {
    let status = resp.status().as_u16();
    let collected = tokio::time::timeout(REQUEST_TIMEOUT, resp.into_body().collect())
        .await
        .map_err(|_| FmError::transport("The engine did not answer in time."))?
        .map_err(|err| FmError::transport(format!("Could not read the engine reply: {err}")))?;
    let bytes = collected.to_bytes();
    let value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
    Ok((status, value))
}

/// Server-Sent Events of one streamed reply.
pub struct SseStream {
    body: Incoming,
    buf: Vec<u8>,
    queue: VecDeque<SseEvent>,
    finished: bool,
}

impl SseStream {
    /// Next event, or `None` at the end (`data: [DONE]` or end of body).
    /// An `event: error` becomes `Some(Err(..))`.
    pub async fn next_event(&mut self) -> Option<Result<SseEvent, FmError>> {
        loop {
            if let Some(event) = self.queue.pop_front() {
                if event.data.trim() == "[DONE]" {
                    self.finished = true;
                    self.queue.clear();
                    return None;
                }
                if event.event.as_deref() == Some("error") {
                    let value: Value = serde_json::from_str(&event.data).unwrap_or(Value::String(event.data.clone()));
                    let status = value
                        .pointer("/error/code")
                        .and_then(|c| c.as_str().and_then(|s| s.parse().ok()).or_else(|| c.as_u64().map(|n| n as u16)))
                        .unwrap_or(500);
                    return Some(Err(FmError::from_reply(status, &value)));
                }
                return Some(Ok(event));
            }
            if self.finished {
                return None;
            }
            let frame = match tokio::time::timeout(STREAM_IDLE_TIMEOUT, self.body.frame()).await {
                Err(_) => return Some(Err(FmError::transport("The model stopped responding for 60 seconds, so the request was stopped. Try again."))),
                Ok(None) => {
                    self.finished = true;
                    // Flush a last event without the blank line.
                    let rest = std::mem::take(&mut self.buf);
                    self.queue.extend(parse_sse(&rest, true).0);
                    continue;
                }
                Ok(Some(Err(err))) => return Some(Err(FmError::transport(format!("The engine stream broke: {err}")))),
                Ok(Some(Ok(frame))) => frame,
            };
            if let Ok(data) = frame.into_data() {
                self.buf.extend_from_slice(&data);
                let (events, used) = parse_sse(&self.buf, false);
                self.buf.drain(..used);
                self.queue.extend(events);
            }
        }
    }
}

/// Parses complete SSE events from `buf`. Returns the events and how many
/// bytes were consumed. With `flush`, a trailing event without a blank line
/// is parsed too.
pub fn parse_sse(buf: &[u8], flush: bool) -> (Vec<SseEvent>, usize) {
    let mut events = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < buf.len() {
        // An event ends with a blank line: "\n\n" or "\r\n\r\n".
        let end = if buf[i] == b'\n' && buf.get(i + 1) == Some(&b'\n') {
            Some(2)
        } else if buf[i..].starts_with(b"\r\n\r\n") {
            Some(4)
        } else {
            None
        };
        if let Some(len) = end {
            if let Some(event) = parse_block(&buf[start..i]) {
                events.push(event);
            }
            i += len;
            start = i;
        } else {
            i += 1;
        }
    }
    if flush && start < buf.len() {
        if let Some(event) = parse_block(&buf[start..]) {
            events.push(event);
        }
        start = buf.len();
    }
    (events, start)
}

fn parse_block(block: &[u8]) -> Option<SseEvent> {
    let text = String::from_utf8_lossy(block);
    let mut event = None;
    let mut data: Vec<&str> = Vec::new();
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(rest) = line.strip_prefix("data:") {
            data.push(rest.strip_prefix(' ').unwrap_or(rest));
        } else if let Some(rest) = line.strip_prefix("event:") {
            event = Some(rest.trim().to_string());
        }
    }
    if data.is_empty() {
        return None;
    }
    Some(SseEvent { event, data: data.join("\n") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sse_events_across_chunks() {
        let raw = b"data: {\"a\":1}\n\nevent: error\ndata: {\"error\":{\"message\":\"x\"}}\n\ndata: [DO";
        let (events, used) = parse_sse(raw, false);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].data, "{\"a\":1}");
        assert_eq!(events[1].event.as_deref(), Some("error"));
        assert_eq!(&raw[used..], b"data: [DO");
        let (rest, _) = parse_sse(b"data: [DONE]", true);
        assert_eq!(rest[0].data, "[DONE]");
    }

    #[test]
    fn parses_crlf_events() {
        let (events, used) = parse_sse(b"data: one\r\n\r\ndata: two\r\n\r\n", false);
        assert_eq!(events.iter().map(|e| e.data.as_str()).collect::<Vec<_>>(), ["one", "two"]);
        assert_eq!(used, 26);
    }

    #[test]
    fn classifies_errors() {
        let overflow = serde_json::json!({"error": {"message": "The session's transcript exceeded the model's context size.", "code": "500"}});
        assert_eq!(FmError::from_reply(500, &overflow).kind, FmErrorKind::ContextOverflow);
        let guard = serde_json::json!({"error": {"message": "The model's safety guardrails were triggered."}});
        assert_eq!(FmError::from_reply(500, &guard).kind, FmErrorKind::Guardrails);
        let other = serde_json::json!({"error": {"message": "stop sequences are not supported."}});
        let err = FmError::from_reply(400, &other);
        assert_eq!(err.kind, FmErrorKind::Server);
        assert_eq!(err.message, "stop sequences are not supported.");
    }

    #[test]
    fn long_socket_paths_get_a_short_fallback() {
        let short = Path::new("/tmp/a.sock");
        assert_eq!(effective_socket_path(short), short);
        let long = PathBuf::from(format!("/tmp/{}/engine.sock", "x".repeat(120)));
        let eff = effective_socket_path(&long);
        assert!(eff.as_os_str().len() <= MAX_SOCKET_PATH, "{}", eff.display());
        assert_eq!(eff, effective_socket_path(&long));
    }

    #[test]
    fn license_error_is_friendly() {
        assert!(start_error(Some(69), "").contains("license"));
        assert!(start_error(Some(1), "boom").contains("boom"));
    }
}
