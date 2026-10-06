//! The user-facing `fm serve` instance (Server page), for other apps to use.
//! Events: "public-server-log" (LogLine) for each output line,
//!         "public-server-state" (PublicServerStatus) on start/stop/exit.
//!
//! How it works: `start` spawns `fm serve` and hands the child to a watcher
//! task. The watcher waits for the child to exit, or for the stop token; then
//! it updates the status and emits "public-server-state". Two reader tasks turn
//! stdout and stderr into log lines. `NSUnbufferedIO=YES` is set because
//! `fm serve` buffers its log when stdout is a pipe (lines would only show up
//! at exit).
//!
//! A pid file (`<data>/public-server.pid`) lets the next start stop a server
//! that was left running when the app was killed.

use super::commands::HttpResult;
use crate::config::PublicServerConfig;
use crate::util::LockExt;
use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

/// One line the server printed (stdout or stderr), with its time.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub ts: i64,
    pub line: String,
}

/// State of the public server for the Server page.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PublicServerStatus {
    pub running: bool,
    pub pid: Option<u32>,
    /// "http://127.0.0.1:1976" in TCP mode.
    pub url: Option<String>,
    pub socket_path: Option<String>,
    pub started_at: Option<i64>,
    pub command: Option<String>,
    pub last_error: Option<String>,
    /// Most recent log lines (max ~500).
    pub logs: Vec<LogLine>,
}

const MAX_LOGS: usize = 500;
const READY_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// Largest reply the "Try it" panel reads.
const MAX_REPLY_BYTES: usize = 8 * 1024 * 1024;
const TOO_LARGE: &str = "The reply is larger than 8 MB, so it was not read.";
/// macOS limit for a Unix socket path (104 bytes including the final NUL).
const MAX_SOCKET_PATH: usize = 103;

/// What the server tells the outside world. The app sends these as Tauri events.
#[derive(Debug, Clone)]
pub enum ServerEvent {
    Log(LogLine),
    State(PublicServerStatus),
}

pub type EventSink = Arc<dyn Fn(ServerEvent) + Send + Sync>;

/// Sends server events to the UI as "public-server-log" / "public-server-state".
pub fn app_sink(app: &AppHandle) -> EventSink {
    let app = app.clone();
    Arc::new(move |event| {
        let _ = match event {
            ServerEvent::Log(line) => app.emit("public-server-log", line),
            ServerEvent::State(status) => app.emit("public-server-state", status),
        };
    })
}

/// Status and log ring buffer, shared with the watcher and reader tasks.
#[derive(Default)]
struct Shared {
    /// `logs` is always empty here; see `snapshot`.
    status: StdMutex<PublicServerStatus>,
    logs: StdMutex<VecDeque<LogLine>>,
}

impl Shared {
    fn snapshot(&self) -> PublicServerStatus {
        let mut status = self.status.lock_safe().clone();
        status.logs = self.logs.lock_safe().iter().cloned().collect();
        status
    }

    fn push_log(&self, line: String, sink: &EventSink) {
        let entry = LogLine { ts: crate::util::now_ms(), line };
        {
            let mut logs = self.logs.lock_safe();
            if logs.len() >= MAX_LOGS {
                logs.pop_front();
            }
            logs.push_back(entry.clone());
        }
        sink(ServerEvent::Log(entry));
    }

    /// Log lines written since `since_ms`, newest last.
    fn lines_since(&self, since_ms: i64) -> Vec<String> {
        self.logs.lock_safe().iter().filter(|l| l.ts >= since_ms).map(|l| l.line.clone()).collect()
    }
}

/// A started server: the stop token and the watcher task that owns the child.
struct Running {
    stop: CancellationToken,
    watcher: JoinHandle<()>,
}

/// Owns the `fm serve` child. It is stopped on `stop` and on app exit.
#[derive(Default)]
pub struct PublicServer {
    running: tokio::sync::Mutex<Option<Running>>,
    shared: Arc<Shared>,
    /// Where the pid of the running server is written (none in tests).
    pid_file: Option<PathBuf>,
}

/// Where the server listens.
#[derive(Debug)]
enum Target {
    Tcp { host: String, port: u16, base_url: String },
    Socket { path: PathBuf },
}

impl PublicServer {
    /// A server that records its pid in `pid_file` while it runs.
    pub fn with_pid_file(pid_file: PathBuf) -> Self {
        Self { pid_file: Some(pid_file), ..Default::default() }
    }

    /// Stops the child if it runs. Called on app exit.
    pub async fn shutdown(&self) {
        let running = self.running.lock().await.take();
        if let Some(running) = running {
            running.stop.cancel();
            let _ = tokio::time::timeout(Duration::from_secs(4), running.watcher).await;
        }
    }

    /// Current status with the recent log lines.
    pub fn status(&self) -> PublicServerStatus {
        self.shared.snapshot()
    }

    /// Starts `fm serve` (stops a running one first) and waits up to 5 s until
    /// it answers. Emits "public-server-state".
    pub async fn start(
        &self,
        app: &AppHandle,
        fm_path: &str,
        config: &PublicServerConfig,
    ) -> Result<PublicServerStatus, String> {
        self.start_with(fm_path, config, app_sink(app)).await
    }

    /// Stops the server (SIGTERM, then kill) and emits "public-server-state".
    pub async fn stop(&self, app: &AppHandle) -> PublicServerStatus {
        self.stop_with(app_sink(app)).await
    }

    /// `start` with any event sink (tests use a plain closure).
    pub async fn start_with(
        &self,
        fm_path: &str,
        config: &PublicServerConfig,
        sink: EventSink,
    ) -> Result<PublicServerStatus, String> {
        let (target, args) = plan(config)?;

        let mut guard = self.running.lock().await;
        if let Some(old) = guard.take() {
            old.stop.cancel();
            let _ = old.watcher.await;
        }

        // A server left running by an earlier, killed run of the app.
        if let Some(pid_file) = self.pid_file.clone() {
            let _ = tokio::task::spawn_blocking(move || crate::procs::reap_pid_file(&pid_file)).await;
        }

        match &target {
            Target::Socket { path } => prepare_socket(path).await?,
            Target::Tcp { host, port, .. } => check_port(host, *port).await?,
        }

        let command = super::display_command(fm_path, &args);
        let mut child = tokio::process::Command::new(fm_path)
            .args(&args)
            .envs(super::FM_ENV)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Could not start fm at {fm_path}: {e}"))?;

        if let (Some(pid_file), Some(pid)) = (self.pid_file.clone(), child.id()) {
            let program = fm_path.to_string();
            let _ = tokio::task::spawn_blocking(move || {
                crate::procs::write_pid_file(&pid_file, pid, false, &program, "serve")
            })
            .await;
        }

        let started_at = crate::util::now_ms();
        *self.shared.status.lock_safe() = PublicServerStatus {
            running: true,
            pid: child.id(),
            url: match &target {
                Target::Tcp { base_url, .. } => Some(base_url.clone()),
                Target::Socket { .. } => None,
            },
            socket_path: match &target {
                Target::Socket { path } => Some(path.display().to_string()),
                Target::Tcp { .. } => None,
            },
            started_at: Some(started_at),
            command: Some(command.clone()),
            last_error: None,
            logs: Vec::new(),
        };
        self.shared.push_log(format!("$ {command}"), &sink);

        let readers = vec![
            spawn_reader(child.stdout.take(), self.shared.clone(), sink.clone()),
            spawn_reader(child.stderr.take(), self.shared.clone(), sink.clone()),
        ];
        let stop = CancellationToken::new();
        let port = match &target {
            Target::Tcp { port, .. } => Some(*port),
            Target::Socket { .. } => None,
        };
        let watcher = tokio::spawn(watch(
            child,
            stop.clone(),
            readers,
            self.shared.clone(),
            sink.clone(),
            Exited { started_at, port, pid_file: self.pid_file.clone() },
        ));
        let running = Running { stop, watcher };

        match wait_ready(&target, &running.watcher).await {
            Ready::Yes => {}
            Ready::Exited => {
                let _ = running.watcher.await;
                let status = self.shared.snapshot();
                return Err(status.last_error.unwrap_or_else(|| "fm serve stopped right after it started.".into()));
            }
            Ready::Timeout => self
                .shared
                .push_log("The server did not answer within 5 seconds. It may still be starting.".into(), &sink),
        }
        *guard = Some(running);
        drop(guard);

        let status = self.shared.snapshot();
        sink(ServerEvent::State(status.clone()));
        Ok(status)
    }

    pub async fn stop_with(&self, sink: EventSink) -> PublicServerStatus {
        let running = self.running.lock().await.take();
        if let Some(running) = running {
            running.stop.cancel();
            let _ = running.watcher.await;
        }
        let status = self.shared.snapshot();
        sink(ServerEvent::State(status.clone()));
        status
    }

    /// Sends one request to the running server and returns the whole reply.
    /// Streamed replies (server-sent events) are returned as raw text.
    pub async fn request(&self, method: &str, path: &str, body: Option<String>) -> Result<HttpResult, String> {
        let status = self.shared.status.lock_safe().clone();
        if !status.running {
            return Err("The server is not running. Start it first.".into());
        }
        if path.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err("The path must not contain spaces or line breaks.".into());
        }
        let method = method.trim().to_uppercase();
        if method.is_empty() || !method.chars().all(|c| c.is_ascii_alphabetic()) {
            return Err(format!("'{method}' is not a valid HTTP method."));
        }
        let path = if path.starts_with('/') { path.to_string() } else { format!("/{path}") };
        let started = Instant::now();

        let (code, text) = if let Some(socket) = &status.socket_path {
            tokio::time::timeout(REQUEST_TIMEOUT, unix_request(Path::new(socket), &method, &path, body.as_deref()))
                .await
                .map_err(|_| "The server did not answer within 120 seconds.".to_string())??
        } else {
            let base = status.url.clone().ok_or("The server has no address.")?;
            tcp_request(&base, &method, &path, body).await?
        };
        Ok(HttpResult { status: code, body: text, duration_ms: started.elapsed().as_millis() as u64 })
    }
}

/// Checks the config and builds the `fm serve` arguments.
fn plan(config: &PublicServerConfig) -> Result<(Target, Vec<String>), String> {
    match config.mode.trim() {
        "socket" => {
            let raw = config.socket_path.trim();
            if raw.is_empty() {
                return Err("Choose a socket path first, for example /tmp/fm.sock.".into());
            }
            let path = expand_home(raw);
            let len = path.as_os_str().len();
            if len > MAX_SOCKET_PATH {
                return Err(format!(
                    "The socket path is too long ({len} characters). macOS allows at most {MAX_SOCKET_PATH}. \
                     Choose a shorter path, for example /tmp/fm.sock."
                ));
            }
            match path.parent() {
                Some(parent) if !parent.as_os_str().is_empty() && !parent.is_dir() => {
                    return Err(format!("The folder {} does not exist.", parent.display()));
                }
                _ => {}
            }
            let args = vec!["serve".into(), "--socket".into(), path.display().to_string()];
            Ok((Target::Socket { path }, args))
        }
        "tcp" | "" => {
            let host = match config.host.trim() {
                "" => "127.0.0.1".to_string(),
                h => h.to_string(),
            };
            if config.port == 0 {
                return Err("Choose a port between 1 and 65535.".into());
            }
            let base_url = format!("http://{}:{}", url_host(&host), config.port);
            let args = vec!["serve".into(), "--host".into(), host.clone(), "--port".into(), config.port.to_string()];
            Ok((Target::Tcp { host, port: config.port, base_url }, args))
        }
        other => Err(format!("Unknown server mode '{other}'. Use tcp or socket.")),
    }
}

/// Host for URLs: a wildcard address becomes loopback, IPv6 gets brackets.
fn url_host(host: &str) -> String {
    match host {
        "0.0.0.0" => "127.0.0.1".into(),
        "::" | "[::]" => "[::1]".into(),
        h if h.contains(':') && !h.starts_with('[') => format!("[{h}]"),
        h => h.into(),
    }
}

fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), dirs::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

/// Removes a stale socket file. Refuses when a live server uses it, or when
/// the path is a normal file (never delete user data).
async fn prepare_socket(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::FileTypeExt;
    let Ok(meta) = std::fs::symlink_metadata(path) else { return Ok(()) };
    if !meta.file_type().is_socket() {
        return Err(format!("{} already exists and is not a socket. Choose another path.", path.display()));
    }
    if tokio::net::UnixStream::connect(path).await.is_ok() {
        return Err(format!("Another server is already listening on {}.", path.display()));
    }
    std::fs::remove_file(path).map_err(|e| format!("Could not remove the old socket {}: {e}", path.display()))
}

/// Fails early with a clear message when another server already answers on
/// the port. This connects instead of binding on purpose: a probe listener
/// could leak into a child process spawned at the same moment (macOS sets
/// close-on-exec in a second step) and then block the port. Other problems
/// (unknown host, port taken without a listener) are left for fm to report.
async fn check_port(host: &str, port: u16) -> Result<(), String> {
    let host = match url_host(host).trim_start_matches('[').trim_end_matches(']') {
        "" => "127.0.0.1".to_string(),
        h => h.to_string(),
    };
    let probe = tokio::time::timeout(Duration::from_millis(500), tokio::net::TcpStream::connect((host.as_str(), port)));
    match probe.await {
        Ok(Ok(_)) => Err(format!("Port {port} is already in use. Stop the other server or choose another port.")),
        _ => Ok(()),
    }
}

fn spawn_reader<R>(pipe: Option<R>, shared: Arc<Shared>, sink: EventSink) -> JoinHandle<()>
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let Some(pipe) = pipe else { return };
        let mut reader = BufReader::new(pipe);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = crate::util::strip_ansi(&String::from_utf8_lossy(&buf));
                    let line = line.trim();
                    if !line.is_empty() {
                        shared.push_log(line.to_string(), &sink);
                    }
                }
            }
        }
    })
}

/// What the watcher needs after the child exits.
struct Exited {
    started_at: i64,
    port: Option<u16>,
    pid_file: Option<PathBuf>,
}

/// Owns the child until it exits (by itself or because `stop` fired).
async fn watch(
    mut child: tokio::process::Child,
    stop: CancellationToken,
    readers: Vec<JoinHandle<()>>,
    shared: Arc<Shared>,
    sink: EventSink,
    info: Exited,
) {
    let Exited { started_at, port, pid_file } = info;
    let mut stopped_by_user = false;
    let exit = tokio::select! {
        status = child.wait() => status.ok(),
        _ = stop.cancelled() => {
            stopped_by_user = true;
            super::terminate(&mut child, Duration::from_secs(2)).await;
            child.wait().await.ok()
        }
    };
    // Let the readers pass on the last lines (the error is usually there).
    for reader in readers {
        let _ = tokio::time::timeout(Duration::from_secs(1), reader).await;
    }
    let code = exit.map(|s| super::exit_code_of(&s));
    if let Some(pid_file) = &pid_file {
        crate::procs::remove_pid_file(pid_file);
    }

    let last_error = if stopped_by_user || code == Some(0) {
        None
    } else {
        Some(exit_error(&shared.lines_since(started_at), code, port))
    };
    {
        let mut status = shared.status.lock_safe();
        status.running = false;
        status.pid = None;
        status.last_error = last_error;
    }
    let note = match (stopped_by_user, code) {
        (true, _) => "Server stopped.".to_string(),
        (false, Some(c)) => format!("fm serve exited with code {c}."),
        (false, None) => "fm serve exited.".to_string(),
    };
    shared.push_log(note, &sink);
    sink(ServerEvent::State(shared.snapshot()));
}

/// A short reason for an unexpected exit, from the last log lines.
fn exit_error(lines: &[String], code: Option<i32>, port: Option<u16>) -> String {
    if code == Some(super::EXIT_LICENSE) {
        return super::LICENSE_MESSAGE.into();
    }
    let error_line = lines.iter().rev().find(|l| l.starts_with("Error:")).map(|l| crate::util::clean_fm_error(l));
    match error_line {
        Some(e) if e.contains("Address already in use") => match port {
            Some(p) => format!("Port {p} is already in use. Stop the other server or choose another port."),
            None => e,
        },
        Some(e) if !e.is_empty() => e,
        _ => {
            let tail: Vec<&str> = lines.iter().rev().take(3).map(String::as_str).collect();
            let tail: Vec<&str> = tail.into_iter().rev().filter(|l| !l.starts_with("$ ")).collect();
            if tail.is_empty() {
                format!("fm serve stopped with exit code {}.", code.unwrap_or(-1))
            } else {
                tail.join("\n")
            }
        }
    }
}

enum Ready {
    Yes,
    Exited,
    Timeout,
}

async fn wait_ready(target: &Target, watcher: &JoinHandle<()>) -> Ready {
    let deadline = Instant::now() + READY_TIMEOUT;
    let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_millis(800)).build().ok();
    loop {
        if watcher.is_finished() {
            return Ready::Exited;
        }
        let ok = match target {
            Target::Tcp { base_url, .. } => match &client {
                Some(c) => {
                    c.get(format!("{base_url}/health")).send().await.map(|r| r.status().is_success()).unwrap_or(false)
                }
                None => false,
            },
            Target::Socket { path } => path.exists() && tokio::net::UnixStream::connect(path).await.is_ok(),
        };
        if ok {
            return Ready::Yes;
        }
        if Instant::now() >= deadline {
            return Ready::Timeout;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn tcp_request(base: &str, method: &str, path: &str, body: Option<String>) -> Result<(u16, String), String> {
    let client = reqwest::Client::builder().no_proxy().timeout(REQUEST_TIMEOUT).build().map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut request = client.request(method, format!("{base}{path}"));
    if let Some(body) = body {
        request = request.header(reqwest::header::CONTENT_TYPE, "application/json").body(body);
    }
    let mut response = request.send().await.map_err(|e| friendly_reqwest_error(&e))?;
    let code = response.status().as_u16();
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| friendly_reqwest_error(&e))? {
        if body.len() + chunk.len() > MAX_REPLY_BYTES {
            return Err(TOO_LARGE.into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok((code, String::from_utf8_lossy(&body).into_owned()))
}

fn friendly_reqwest_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "The server did not answer within 120 seconds.".into()
    } else if e.is_connect() {
        format!("Could not connect to the server: {e}")
    } else {
        format!("The request failed: {e}")
    }
}

/// A minimal HTTP/1.1 client over a Unix socket (`Connection: close`).
pub(crate) async fn unix_request(
    socket: &Path,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<(u16, String), String> {
    let mut stream = tokio::net::UnixStream::connect(socket)
        .await
        .map_err(|e| format!("Could not connect to {}: {e}", socket.display()))?;
    let body = body.unwrap_or("");
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nAccept: */*\r\nConnection: close\r\n");
    if !body.is_empty() {
        head.push_str("Content-Type: application/json\r\n");
    }
    if !body.is_empty() || matches!(method, "POST" | "PUT" | "PATCH") {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).await.map_err(|e| format!("Could not send the request: {e}"))?;
    stream.write_all(body.as_bytes()).await.map_err(|e| format!("Could not send the request: {e}"))?;
    stream.flush().await.map_err(|e| e.to_string())?;

    let mut raw = Vec::new();
    let mut buf = vec![0u8; 16 * 1024];
    loop {
        let n = stream.read(&mut buf).await.map_err(|e| format!("Could not read the reply: {e}"))?;
        if n == 0 {
            break;
        }
        if raw.len() + n > MAX_REPLY_BYTES {
            return Err(TOO_LARGE.into());
        }
        raw.extend_from_slice(&buf[..n]);
        if response_complete(&raw) {
            break;
        }
    }
    parse_response(&raw)
}

/// Splits a raw reply into (head, body). None until the head is complete.
fn split_head(raw: &[u8]) -> Option<(&str, &[u8])> {
    let pos = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&raw[..pos]).ok()?;
    Some((head, &raw[pos + 4..]))
}

fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().skip(1).find_map(|line| {
        let (k, v) = line.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim())
    })
}

fn is_chunked(head: &str) -> bool {
    header(head, "transfer-encoding").is_some_and(|v| v.to_ascii_lowercase().contains("chunked"))
}

/// True when the whole reply is in `raw`, so we can stop even if the server
/// keeps the connection open.
fn response_complete(raw: &[u8]) -> bool {
    let Some((head, body)) = split_head(raw) else { return false };
    if is_chunked(head) {
        return decode_chunked(body).is_some();
    }
    if let Some(len) = header(head, "content-length").and_then(|v| v.parse::<usize>().ok()) {
        return body.len() >= len;
    }
    false
}

fn parse_response(raw: &[u8]) -> Result<(u16, String), String> {
    let (head, body) = split_head(raw).ok_or("The server sent an incomplete reply.")?;
    let status_line = head.lines().next().unwrap_or("");
    let code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .ok_or_else(|| format!("The server sent an unexpected reply: {status_line}"))?;
    let body: Vec<u8> = if is_chunked(head) {
        // A cut-off stream still shows what arrived.
        decode_chunked(body).unwrap_or_else(|| decode_chunked_partial(body))
    } else if let Some(len) = header(head, "content-length").and_then(|v| v.parse::<usize>().ok()) {
        body[..len.min(body.len())].to_vec()
    } else {
        body.to_vec()
    };
    Ok((code, String::from_utf8_lossy(&body).into_owned()))
}

/// Decodes a complete chunked body. None when the final chunk is missing.
fn decode_chunked(body: &[u8]) -> Option<Vec<u8>> {
    let (data, complete) = decode_chunks(body);
    complete.then_some(data)
}

fn decode_chunked_partial(body: &[u8]) -> Vec<u8> {
    decode_chunks(body).0
}

fn decode_chunks(mut body: &[u8]) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    loop {
        let Some(line_end) = body.windows(2).position(|w| w == b"\r\n") else { return (out, false) };
        let size_text = std::str::from_utf8(&body[..line_end]).unwrap_or("");
        let size_text = size_text.split(';').next().unwrap_or("").trim();
        let Ok(size) = usize::from_str_radix(size_text, 16) else { return (out, false) };
        body = &body[line_end + 2..];
        if size == 0 {
            return (out, true);
        }
        if body.len() < size {
            out.extend_from_slice(body);
            return (out, false);
        }
        out.extend_from_slice(&body[..size]);
        body = &body[size..];
        body = body.strip_prefix(b"\r\n").unwrap_or(body);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(mode: &str, host: &str, port: u16, socket: &str) -> PublicServerConfig {
        PublicServerConfig { mode: mode.into(), host: host.into(), port, socket_path: socket.into(), autostart: false }
    }

    #[test]
    fn plans_arguments_and_urls() {
        let (target, args) = plan(&cfg("tcp", "0.0.0.0", 1976, "")).unwrap();
        assert_eq!(args, ["serve", "--host", "0.0.0.0", "--port", "1976"]);
        assert!(matches!(target, Target::Tcp { base_url, .. } if base_url == "http://127.0.0.1:1976"));

        let (_, args) = plan(&cfg("socket", "", 0, "/tmp/fm.sock")).unwrap();
        assert_eq!(args, ["serve", "--socket", "/tmp/fm.sock"]);

        assert!(plan(&cfg("socket", "", 0, "  ")).unwrap_err().contains("socket path"));
        let long = format!("/tmp/{}.sock", "x".repeat(120));
        assert!(plan(&cfg("socket", "", 0, &long)).unwrap_err().contains("too long"));
        assert!(plan(&cfg("socket", "", 0, "/no/such/folder/fm.sock")).unwrap_err().contains("does not exist"));
        assert!(plan(&cfg("tcp", "127.0.0.1", 0, "")).is_err());
        assert!(plan(&cfg("udp", "", 1, "")).unwrap_err().contains("Unknown server mode"));
        assert_eq!(url_host("::1"), "[::1]");
    }

    #[test]
    fn parses_plain_and_chunked_replies() {
        let plain = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello";
        assert!(response_complete(plain));
        assert_eq!(parse_response(plain).unwrap(), (200, "hello".to_string()));

        let chunked =
            b"HTTP/1.1 201 Created\r\nTransfer-Encoding: chunked\r\n\r\n4\r\ndata\r\n6;x=y\r\n: more\r\n0\r\n\r\n";
        assert!(response_complete(chunked));
        assert_eq!(parse_response(chunked).unwrap(), (201, "data: more".to_string()));

        let cut = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\ndata\r\n";
        assert!(!response_complete(cut));
        assert_eq!(parse_response(cut).unwrap().1, "data");

        let sse = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\ndata: [DONE]\n\n";
        assert!(!response_complete(sse));
        assert_eq!(parse_response(sse).unwrap().1, "data: [DONE]\n\n");
        assert!(parse_response(b"garbage").is_err());
    }

    #[test]
    fn explains_exit_errors() {
        let lines = vec![
            "Apple Foundation Models Serve".to_string(),
            "Error: POSIXErrorCode(rawValue: 48): Address already in use".into(),
        ];
        assert!(exit_error(&lines, Some(1), Some(1976)).starts_with("Port 1976 is already in use"));
        let lines = vec!["Error: Something broke".to_string()];
        assert_eq!(exit_error(&lines, Some(1), None), "Something broke");
        assert_eq!(exit_error(&[], Some(69), None), super::super::LICENSE_MESSAGE);
        assert_eq!(exit_error(&[], Some(2), None), "fm serve stopped with exit code 2.");
    }

    fn fake_fm(dir: &Path, body: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("fake-fm");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.display().to_string()
    }

    fn collecting_sink() -> (EventSink, Arc<StdMutex<Vec<ServerEvent>>>) {
        let events = Arc::new(StdMutex::new(Vec::new()));
        let e2 = events.clone();
        (Arc::new(move |ev| e2.lock().unwrap().push(ev)), events)
    }

    #[tokio::test]
    async fn early_exit_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let fm = fake_fm(dir.path(), "echo 'Banner'; echo 'Error: \\033[31mBad host\\033[0m' >&2; exit 1");
        let server = PublicServer::default();
        let (sink, events) = collecting_sink();
        let err = server.start_with(&fm, &cfg("tcp", "127.0.0.1", 1, ""), sink).await.unwrap_err();
        assert_eq!(err, "Bad host");
        let status = server.status();
        assert!(!status.running);
        assert_eq!(status.last_error.as_deref(), Some("Bad host"));
        assert!(status.logs.iter().any(|l| l.line == "Banner"));
        assert!(events.lock().unwrap().iter().any(|e| matches!(e, ServerEvent::State(s) if !s.running)));
    }

    #[tokio::test]
    async fn refuses_a_regular_file_as_socket() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("fm.sock");
        std::fs::write(&file, "keep me").unwrap();
        let server = PublicServer::default();
        let (sink, _) = collecting_sink();
        let err =
            server.start_with("/usr/bin/true", &cfg("socket", "", 0, file.to_str().unwrap()), sink).await.unwrap_err();
        assert!(err.contains("is not a socket"), "{err}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "keep me");
    }

    #[tokio::test]
    async fn pid_file_tracks_the_server_and_stops_a_leftover() {
        use std::os::unix::process::CommandExt;
        let dir = tempfile::tempdir().unwrap();
        let fm = fake_fm(dir.path(), "echo 'listening'; exec sleep 60");
        let pid_file = dir.path().join("public-server.pid");
        // A server left running by an earlier run that was killed.
        let mut leftover = std::process::Command::new("/bin/sleep")
            .arg0(format!("{fm} serve --socket {}/old.sock", dir.path().display()))
            .arg("60")
            .spawn()
            .unwrap();
        crate::procs::write_pid_file(&pid_file, leftover.id(), false, &fm, "serve").unwrap();

        let server = PublicServer::with_pid_file(pid_file.clone());
        let (sink, _) = collecting_sink();
        let socket = dir.path().join("s.sock");
        let status =
            server.start_with(&fm, &cfg("socket", "", 0, socket.to_str().unwrap()), sink.clone()).await.unwrap();
        let mut stopped = false;
        for _ in 0..40 {
            if leftover.try_wait().unwrap().is_some() {
                stopped = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(stopped, "the leftover server should be stopped");
        let record: crate::procs::PidRecord = serde_json::from_slice(&std::fs::read(&pid_file).unwrap()).unwrap();
        assert_eq!(Some(record.pid), status.pid);
        server.stop_with(sink).await;
        assert!(!pid_file.exists(), "the pid file is removed when the server stops");
    }

    #[tokio::test]
    async fn requests_with_line_breaks_are_refused() {
        let server = PublicServer::default();
        server.shared.status.lock_safe().running = true;
        let err = server.request("GET", "/health HTTP/1.1\r\nX-Evil: 1", None).await.unwrap_err();
        assert!(err.contains("must not contain"), "{err}");
    }

    #[tokio::test]
    async fn stop_kills_a_running_server() {
        let dir = tempfile::tempdir().unwrap();
        // Stands in for a server that never answers: start times out after 5 s.
        let fm = fake_fm(dir.path(), "echo 'listening'; exec sleep 60");
        let server = PublicServer::default();
        let (sink, _) = collecting_sink();
        let status = server
            .start_with(&fm, &cfg("socket", "", 0, dir.path().join("s.sock").to_str().unwrap()), sink.clone())
            .await
            .unwrap();
        assert!(status.running);
        let pid = status.pid.unwrap();
        let status = server.stop_with(sink).await;
        assert!(!status.running && status.last_error.is_none());
        let alive = std::process::Command::new("/bin/kill").args(["-0", &pid.to_string()]).status().unwrap().success();
        assert!(!alive, "child should be gone");
        assert!(server.request("GET", "/health", None).await.unwrap_err().contains("not running"));
    }
}
