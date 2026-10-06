//! Runs a child process with a timeout. The child gets its own process
//! group, so a timeout or a cancelled chat also stops what it started.

use crate::util::LockExt;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct ProcOutput {
    /// Exit code; `None` when stopped by a signal.
    pub status: Option<i32>,
    /// UTF-8 (lossy), colors removed.
    pub stdout: String,
    pub stderr: String,
}

/// Kills the whole process group when dropped before the process finished
/// (timeout, or the future was dropped because the user pressed Stop).
struct GroupGuard {
    pid: Option<u32>,
    done: bool,
}

impl Drop for GroupGuard {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        if let Some(pgid) = self.pid.and_then(|p| i32::try_from(p).ok()).filter(|p| *p > 1) {
            // SAFETY: killpg(2) on the group we created for this child. The
            // leader is not reaped yet, so the group id is still ours.
            unsafe {
                libc::killpg(pgid, libc::SIGKILL);
            }
        }
    }
}

/// Max bytes kept from stdout and from stderr.
const MAX_OUTPUT: usize = 4 * 1024 * 1024;
/// After the process exits, how long we keep reading its pipes. Another
/// child spawned at the same moment can inherit our pipe ends (macOS sets
/// CLOEXEC in a second step), so EOF may never come.
const DRAIN_GRACE: Duration = Duration::from_millis(500);

pub async fn run_process(mut cmd: Command, stdin: Option<Vec<u8>>, timeout: Duration) -> Result<ProcOutput, String> {
    let program = cmd.as_std().get_program().to_string_lossy().into_owned();
    cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .process_group(0);
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("{program} was not found.")
        } else {
            format!("Could not start {program}: {e}")
        }
    })?;
    let mut guard = GroupGuard { pid: child.id(), done: false };
    if let (Some(data), Some(mut pipe)) = (stdin, child.stdin.take()) {
        // Write in the background: the process may not read stdin at all.
        tokio::spawn(async move {
            let _ = pipe.write_all(&data).await;
            let _ = pipe.shutdown().await;
        });
    }
    let stdout = Arc::new(StdMutex::new(Vec::new()));
    let stderr = Arc::new(StdMutex::new(Vec::new()));
    let readers = [
        child.stdout.take().map(|p| tokio::spawn(collect(p, stdout.clone()))),
        child.stderr.take().map(|p| tokio::spawn(collect(p, stderr.clone()))),
    ];
    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => return Err(format!("{program} failed: {e}")),
        Err(_) => {
            for r in readers.into_iter().flatten() {
                r.abort();
            }
            return Err(format!("{program} took longer than {} seconds and was stopped.", timeout.as_secs()));
        }
    };
    guard.done = true;
    for reader in readers.into_iter().flatten() {
        let abort = reader.abort_handle();
        if tokio::time::timeout(DRAIN_GRACE, reader).await.is_err() {
            abort.abort();
        }
    }
    let text = |buf: &Arc<StdMutex<Vec<u8>>>| crate::util::strip_ansi(&String::from_utf8_lossy(&buf.lock_safe()));
    Ok(ProcOutput { status: status.code(), stdout: text(&stdout), stderr: text(&stderr) })
}

async fn collect(mut pipe: impl AsyncRead + Unpin, buf: Arc<StdMutex<Vec<u8>>>) {
    let mut chunk = [0u8; 8192];
    loop {
        match pipe.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let mut b = buf.lock_safe();
                let room = MAX_OUTPUT.saturating_sub(b.len());
                b.extend_from_slice(&chunk[..n.min(room)]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn passes_stdin_and_times_out() {
        let mut cmd = Command::new("/bin/cat");
        cmd.arg("-");
        let out = run_process(cmd, Some(b"hello".to_vec()), Duration::from_secs(5)).await.unwrap();
        assert_eq!(out.stdout, "hello");
        assert_eq!(out.status, Some(0));

        let mut cmd = Command::new("/bin/sleep");
        cmd.arg("5");
        let started = std::time::Instant::now();
        let err = run_process(cmd, None, Duration::from_millis(300)).await.unwrap_err();
        assert!(err.contains("took longer"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[tokio::test]
    async fn background_child_holding_the_pipe_does_not_hang() {
        // `sleep` keeps stdout open after the shell exits.
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg("echo done; sleep 5 &");
        let started = std::time::Instant::now();
        let out = run_process(cmd, None, Duration::from_secs(10)).await.unwrap();
        assert_eq!(out.stdout, "done\n");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[tokio::test]
    async fn missing_program() {
        let err = run_process(Command::new("/no/such/program"), None, Duration::from_secs(1)).await.unwrap_err();
        assert!(err.contains("not found"), "{err}");
    }
}
