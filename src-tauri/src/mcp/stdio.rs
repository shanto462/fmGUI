//! stdio transport: the server is a child process; newline-delimited JSON on
//! stdin/stdout, stderr goes to the log tail.
//!
//! The server runs in its own process group (npx starts node as a child), and
//! the group id is written to a pid file while it runs, so a later start of
//! the app can stop a server that was left behind by a crash.

use super::client::{handle_notification, ClientEvent};
use super::errors;
use super::rpc::{self, CallError, Incoming, LogTail, PendingMap};
use crate::util::LockExt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, watch, Mutex};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

/// How the process is started (already resolved).
pub struct StdioSpec {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<String>,
    /// Where the process group id is recorded while the server runs.
    pub pid_file: Option<PathBuf>,
}

/// How long one write to the server's stdin may take. A server that stops
/// reading would otherwise block the caller forever once the pipe is full.
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);

struct Shared {
    pending: PendingMap,
    tail: LogTail,
    events: mpsc::UnboundedSender<ClientEvent>,
    /// We are stopping the server on purpose: no "error" event.
    closing: AtomicBool,
}

impl Shared {
    /// The connection is gone: fail waiting requests and tell the manager once.
    fn finish(&self, reason: String) {
        if self.pending.close(&reason) && !self.closing.load(Ordering::SeqCst) {
            let _ = self.events.send(ClientEvent::Closed(reason));
        }
    }
}

type SharedStdin = Arc<Mutex<Option<ChildStdin>>>;

pub struct StdioTransport {
    stdin: SharedStdin,
    shared: Arc<Shared>,
    stop: CancellationToken,
    supervisor: std::sync::Mutex<Option<JoinHandle<()>>>,
}

/// Writes one JSON message and a newline, waiting at most `limit`.
async fn write_line(stdin: &SharedStdin, msg: &Value, limit: Duration) -> Result<(), String> {
    let mut line = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    line.push(b'\n');
    let write = async {
        let mut guard = stdin.lock().await;
        let Some(pipe) = guard.as_mut() else { return Err("The server is not running.".to_string()) };
        pipe.write_all(&line).await.map_err(|e| format!("Could not send to the server: {e}"))?;
        pipe.flush().await.map_err(|e| format!("Could not send to the server: {e}"))
    };
    tokio::time::timeout(limit, write)
        .await
        .unwrap_or_else(|_| Err("The server stopped reading its input, so the message could not be sent.".into()))
}

/// Sends a signal to the whole process group (npx starts node as a child).
fn signal_group(pid: Option<u32>, signal: i32) {
    if let Some(pgid) = pid.and_then(|p| i32::try_from(p).ok()).filter(|p| *p > 1) {
        // SAFETY: killpg(2) with a positive group id we created.
        unsafe {
            libc::killpg(pgid, signal);
        }
    }
}

impl StdioTransport {
    pub async fn spawn(
        spec: StdioSpec,
        tail: LogTail,
        events: mpsc::UnboundedSender<ClientEvent>,
    ) -> Result<Self, String> {
        // The login shell environment (PATH from nvm, Homebrew, ...). The first
        // call runs the shell, so keep it off the async threads.
        let mut env: HashMap<String, String> = crate::util::login_env_async().await.clone();
        for (k, v) in &spec.env {
            if !k.trim().is_empty() {
                env.insert(k.trim().to_string(), v.clone());
            }
        }

        let cwd = match spec.cwd.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
            Some(dir) => {
                let dir = PathBuf::from(errors::expand_tilde(dir));
                if !dir.is_dir() {
                    return Err(format!("The working folder does not exist: {}", dir.display()));
                }
                Some(dir)
            }
            None => None,
        };

        // Someone may type the whole command line into the command field.
        let (command, args) = if spec.args.is_empty() && spec.command.trim().contains(char::is_whitespace) {
            let mut parts = errors::split_command_line(&spec.command);
            let first = if parts.is_empty() { String::new() } else { parts.remove(0) };
            (first, parts)
        } else {
            (spec.command.trim().to_string(), spec.args.clone())
        };
        let program = errors::resolve_program(&command, &env, cwd.as_deref())?;
        let args: Vec<String> = args.iter().map(|a| errors::expand_tilde(a)).collect();

        let mut cmd = Command::new(&program);
        cmd.args(&args)
            .env_clear()
            .envs(&env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            // Own process group, so stopping it also stops children (npx → node).
            .process_group(0);
        if let Some(dir) = &cwd {
            cmd.current_dir(dir);
        }
        // A server with this id left behind by a crash of an earlier run.
        if let Some(pid_file) = spec.pid_file.clone() {
            let _ = tokio::task::spawn_blocking(move || crate::procs::reap_pid_file(&pid_file)).await;
        }
        let mut child: Child = cmd.spawn().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => errors::command_not_found(&command),
            std::io::ErrorKind::PermissionDenied => {
                format!("fmGUI is not allowed to run {command}. Check that the file is executable.")
            }
            _ => format!("Could not start {command}: {e}"),
        })?;
        let pid = child.id();
        if let (Some(pid_file), Some(pid)) = (spec.pid_file.clone(), pid) {
            let program_text = program.display().to_string();
            let first_arg = args.first().cloned().unwrap_or_default();
            let _ = tokio::task::spawn_blocking(move || {
                crate::procs::write_pid_file(&pid_file, pid, true, &program_text, &first_arg)
            })
            .await;
        }
        let pid_file = spec.pid_file.clone();

        let stdin: SharedStdin = Arc::new(Mutex::new(child.stdin.take()));
        let stdout = child.stdout.take().ok_or("Could not read the server output.")?;
        let stderr = child.stderr.take().ok_or("Could not read the server errors.")?;
        let shared = Arc::new(Shared { pending: PendingMap::default(), tail, events, closing: AtomicBool::new(false) });
        let stop = CancellationToken::new();
        // Cancelled once the child has exited. The readers stop then too: on
        // macOS another child spawned at the same moment can inherit our pipe
        // ends, so EOF may come late or never.
        let done = CancellationToken::new();
        let (exit_tx, exit_rx) = watch::channel::<Option<Option<i32>>>(None);

        // stderr → tail
        let mut stderr_task = {
            let tail = shared.tail.clone();
            let done = done.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    let read = tokio::select! {
                        r = reader.read_until(b'\n', &mut buf) => r,
                        // Child gone: read what is already buffered, then stop.
                        _ = done.cancelled() => {
                            let _ = tokio::time::timeout(Duration::from_millis(50), reader.read_until(b'\n', &mut buf)).await;
                            if !buf.is_empty() {
                                tail.push(&String::from_utf8_lossy(&buf));
                            }
                            break;
                        }
                    };
                    match read {
                        Ok(0) | Err(_) => break,
                        Ok(_) => tail.push(&String::from_utf8_lossy(&buf)),
                    }
                }
            })
        };

        // stdout → responses, server requests, notifications
        {
            let shared = shared.clone();
            let stdin = stdin.clone();
            let mut exit_rx = exit_rx.clone();
            let done = done.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    let read = tokio::select! {
                        r = reader.read_until(b'\n', &mut buf) => r,
                        _ = done.cancelled() => break,
                    };
                    match read {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {}
                    }
                    let text = String::from_utf8_lossy(&buf);
                    let line = text.trim();
                    if line.is_empty() {
                        continue;
                    }
                    let Some(messages) = rpc::parse_messages(line) else {
                        // Some servers print banners on stdout. Keep them for debugging.
                        shared.tail.push(&format!("[stdout] {line}"));
                        continue;
                    };
                    for msg in messages {
                        match msg {
                            Incoming::Response { id, result } => {
                                shared.pending.resolve(id, result);
                            }
                            Incoming::Request { id, method, .. } => {
                                let reply = rpc::reply_to_server_request(&id, &method);
                                if let Err(err) = write_line(&stdin, &reply, WRITE_TIMEOUT).await {
                                    shared.tail.push(&err);
                                }
                            }
                            Incoming::Notification { method, params } => {
                                handle_notification(&method, &params, &shared.tail, &shared.events);
                            }
                            Incoming::Unknown(v) => {
                                if let Some(err) = v.get("error") {
                                    shared.tail.push(&format!("[stdout] server error: {err}"));
                                }
                            }
                        }
                    }
                }
                // Output closed. Normally the process exited; the supervisor
                // reports that with the exit code. If it is still running
                // after a moment, report the closed output ourselves.
                let exited =
                    tokio::time::timeout(Duration::from_secs(2), exit_rx.wait_for(|v| v.is_some())).await.is_ok();
                if !exited {
                    shared.finish("The server closed its output and stopped answering.".into());
                }
            });
        }

        // Owns the child: waits for it to exit, or stops it when asked.
        let supervisor = {
            let shared = shared.clone();
            let stop = stop.clone();
            tokio::spawn(async move {
                // The process exit is the disconnect signal (not stdout EOF).
                let status = tokio::select! {
                    status = child.wait() => status.ok(),
                    _ = stop.cancelled() => {
                        // stdin is closed already; most servers exit on EOF.
                        // The group is signalled only while the leader is not
                        // reaped yet, so its id cannot belong to anyone else.
                        match tokio::time::timeout(Duration::from_millis(1500), child.wait()).await {
                            Ok(s) => s.ok(),
                            Err(_) => {
                                signal_group(pid, libc::SIGTERM);
                                match tokio::time::timeout(Duration::from_millis(1000), child.wait()).await {
                                    Ok(s) => s.ok(),
                                    Err(_) => {
                                        signal_group(pid, libc::SIGKILL);
                                        let _ = child.kill().await;
                                        child.wait().await.ok()
                                    }
                                }
                            }
                        }
                    }
                };
                // Let the last stderr lines arrive before we build the message,
                // then stop both readers.
                let drained = tokio::time::timeout(Duration::from_millis(300), &mut stderr_task).await.is_ok();
                done.cancel();
                if !drained {
                    let _ = tokio::time::timeout(Duration::from_millis(100), stderr_task).await;
                }
                let code = status.and_then(|s| s.code());
                // Children of a server that exited on its own (npx → node) would
                // otherwise keep running without a parent.
                signal_group(pid, libc::SIGTERM);
                if let Some(pid_file) = &pid_file {
                    crate::procs::remove_pid_file(pid_file);
                }
                let _ = exit_tx.send(Some(code));
                let reason = errors::exit_message(code, &shared.tail.last(20));
                shared.finish(reason);
            })
        };

        Ok(Self { stdin, shared, stop, supervisor: std::sync::Mutex::new(Some(supervisor)) })
    }

    pub async fn request(&self, id: u64, method: &str, params: Value, timeout: Duration) -> Result<Value, CallError> {
        let rx = self.shared.pending.insert(id)?;
        if let Err(err) = write_line(&self.stdin, &rpc::request(id, method, params), timeout.min(WRITE_TIMEOUT)).await {
            self.shared.pending.remove(id);
            return Err(CallError::Closed(self.shared.pending.closed_reason().unwrap_or(err)));
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(CallError::Closed("The server stopped.".into())),
            Err(_) => {
                self.shared.pending.remove(id);
                let _ = self
                    .notify("notifications/cancelled", json!({"requestId": id, "reason": "The request timed out."}))
                    .await;
                Err(CallError::Timeout(timeout.as_secs()))
            }
        }
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), CallError> {
        if let Some(reason) = self.shared.pending.closed_reason() {
            return Err(CallError::Closed(reason));
        }
        write_line(&self.stdin, &rpc::notification(method, params), WRITE_TIMEOUT).await.map_err(CallError::Failed)
    }

    /// Stops the server: close stdin, wait a little, then TERM, then KILL.
    pub async fn close(&self) {
        self.shared.closing.store(true, Ordering::SeqCst);
        self.stdin.lock().await.take();
        self.stop.cancel();
        let handle = self.supervisor.lock_safe().take();
        if let Some(handle) = handle {
            let _ = tokio::time::timeout(Duration::from_secs(5), handle).await;
        }
        self.shared.pending.close("The connection was closed.");
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        self.shared.closing.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.stdin.try_lock() {
            guard.take();
        }
        self.stop.cancel();
    }
}
