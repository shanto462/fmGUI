//! Small shared helpers: text cleanup, token estimates, the login-shell
//! environment, ids, and poison-tolerant locks.

use std::collections::HashMap;
use std::io::Read;
use std::process::Stdio;
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::{Duration, Instant};

/// `lock()` that keeps working after another thread panicked while holding
/// the lock. Every critical section in this app only reads or replaces plain
/// data, so the data behind a poisoned lock is still consistent.
pub trait LockExt<T> {
    fn lock_safe(&self) -> MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
    fn lock_safe(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Poison-tolerant `read()` / `write()` for `RwLock` (see [`LockExt`]).
pub trait RwLockExt<T> {
    fn read_safe(&self) -> RwLockReadGuard<'_, T>;
    fn write_safe(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T> RwLockExt<T> for RwLock<T> {
    fn read_safe(&self) -> RwLockReadGuard<'_, T> {
        self.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write_safe(&self) -> RwLockWriteGuard<'_, T> {
        self.write().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Removes terminal escape sequences. `fm` colors stderr (and some stdout
/// lines) even when it is not attached to a terminal, and ignores NO_COLOR.
pub fn strip_ansi(text: &str) -> String {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B[@-Z\\-_]")
            .expect("valid regex")
    });
    if !text.contains('\u{1B}') {
        return text.to_string();
    }
    re.replace_all(text, "").into_owned()
}

/// Cleans an `fm` error message: strips colors and the leading "Error: ".
pub fn clean_fm_error(stderr: &str) -> String {
    let text = strip_ansi(stderr);
    let text = text.trim();
    text.strip_prefix("Error:").map(str::trim).unwrap_or(text).to_string()
}

/// Cuts text to at most `max_chars` characters (not bytes), adding a note
/// when something was removed. Used to keep tool output inside the small
/// context window.
pub fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let cut: String = text.chars().take(max_chars).collect();
    format!("{cut}\n…[truncated, {} more characters]", text.chars().count() - max_chars)
}

/// Rough token estimate (about 4 characters per token for English).
/// Use `fm count-tokens` when an exact number matters.
pub fn estimate_tokens(text: &str) -> u32 {
    (text.chars().count() as u32).div_ceil(4)
}

/// How long the login shell may take to print its environment.
const LOGIN_SHELL_TIMEOUT: Duration = Duration::from_secs(10);

/// Environment of the user's login shell (PATH from ~/.zprofile, nvm,
/// Homebrew, ...). Apps opened from Finder only get a minimal PATH, so
/// `npx`, `uvx` or `node` would not be found without this. Computed once;
/// the first call can block for up to 10 seconds (a slow shell profile),
/// so async code should use [`login_env_async`].
pub fn login_env() -> &'static HashMap<String, String> {
    static ENV: OnceLock<HashMap<String, String>> = OnceLock::new();
    ENV.get_or_init(|| {
        let mut env: HashMap<String, String> = std::env::vars().collect();
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        if let Some(raw) = login_shell_output(&shell, LOGIN_SHELL_TIMEOUT) {
            for entry in raw.split(|b| *b == 0) {
                let entry = String::from_utf8_lossy(entry);
                if let Some((k, v)) = entry.split_once('=') {
                    if k == "PATH" || !env.contains_key(k) {
                        env.insert(k.to_string(), v.to_string());
                    }
                }
            }
        }
        // Common tool folders as a safety net.
        let path = env.get("PATH").cloned().unwrap_or_default();
        let mut parts: Vec<String> = path.split(':').filter(|p| !p.is_empty()).map(String::from).collect();
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            if !parts.iter().any(|p| p == extra) {
                parts.push(extra.to_string());
            }
        }
        env.insert("PATH".into(), parts.join(":"));
        env
    })
}

/// [`login_env`] without blocking an async worker thread.
pub async fn login_env_async() -> &'static HashMap<String, String> {
    tokio::task::spawn_blocking(login_env).await.unwrap_or_else(|_| login_env())
}

/// Runs `$SHELL -ilc 'env -0'` (NUL-separated, so values with newlines stay
/// intact). None when the shell fails or does not finish in time; then the
/// shell is killed.
fn login_shell_output(shell: &str, timeout: Duration) -> Option<Vec<u8>> {
    let mut child = std::process::Command::new(shell)
        .args(["-ilc", "env -0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    let output = rx.recv_timeout(timeout).ok();
    // stdout is closed (or we gave up): the shell should be gone very soon.
    let deadline = Instant::now() + if output.is_some() { Duration::from_secs(2) } else { Duration::ZERO };
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return output.filter(|_| status.success()),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// Reads a file the user picked in the UI. Refuses folders, devices, pipes
/// and files larger than `max_bytes` (with a clear message).
pub fn read_user_file(path: &std::path::Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let shown = path.display();
    let meta = std::fs::metadata(path).map_err(|e| format!("Could not read {shown}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{shown} is a folder, not a file."));
    }
    if !meta.is_file() {
        return Err(format!("{shown} is not a regular file."));
    }
    if meta.len() > max_bytes {
        return Err(format!(
            "{shown} is too large ({}). The limit is {}.",
            human_bytes(meta.len()),
            human_bytes(max_bytes)
        ));
    }
    let file = std::fs::File::open(path).map_err(|e| format!("Could not read {shown}: {e}"))?;
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    file.take(max_bytes + 1).read_to_end(&mut bytes).map_err(|e| format!("Could not read {shown}: {e}"))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!("{shown} is too large. The limit is {}.", human_bytes(max_bytes)));
    }
    Ok(bytes)
}

/// "512 B", "1.5 KB", "20 MB".
pub fn human_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < KB * KB {
        format!("{} KB", trim_number(b / KB))
    } else {
        format!("{} MB", trim_number(b / (KB * KB)))
    }
}

fn trim_number(n: f64) -> String {
    let text = format!("{n:.1}");
    text.strip_suffix(".0").map(str::to_string).unwrap_or(text)
}

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// A random UUID (v4) as text. Always ASCII.
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_colors_and_prefix() {
        let raw = "Error: \u{1B}[38;2;255;107;128mInvalid guardrail 'x'.\u{1B}[0m\n";
        assert_eq!(clean_fm_error(raw), "Invalid guardrail 'x'.");
        assert_eq!(strip_ansi("plain"), "plain");
    }

    #[test]
    fn login_shell_output_times_out_and_kills() {
        let dir = tempfile::tempdir().unwrap();
        let slow = dir.path().join("slow-shell");
        std::fs::write(&slow, "#!/bin/sh\nexec sleep 30\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&slow, std::fs::Permissions::from_mode(0o755)).unwrap();
        let started = Instant::now();
        assert!(login_shell_output(slow.to_str().unwrap(), Duration::from_millis(300)).is_none());
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(login_shell_output("/no/such/shell", Duration::from_secs(1)).is_none());
    }

    #[test]
    fn poisoned_locks_still_work() {
        let m = std::sync::Arc::new(Mutex::new(1));
        let m2 = m.clone();
        let _ = std::thread::spawn(move || {
            let _g = m2.lock().unwrap();
            panic!("poison it");
        })
        .join();
        assert!(m.is_poisoned());
        *m.lock_safe() += 1;
        assert_eq!(*m.lock_safe(), 2);
        let rw = RwLock::new(5);
        *rw.write_safe() = 6;
        assert_eq!(*rw.read_safe(), 6);
    }

    #[test]
    fn user_files_are_checked() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "hello").unwrap();
        assert_eq!(read_user_file(&file, 10).unwrap(), b"hello");
        assert!(read_user_file(&file, 4).unwrap_err().contains("too large (5 B). The limit is 4 B."));
        assert!(read_user_file(dir.path(), 10).unwrap_err().contains("is a folder"));
        assert!(read_user_file(std::path::Path::new("/dev/null"), 10).unwrap_err().contains("not a regular file"));
        assert!(read_user_file(&dir.path().join("missing"), 10).is_err());
        assert_eq!(human_bytes(20 * 1024 * 1024), "20 MB");
        assert_eq!(human_bytes(1536), "1.5 KB");
    }

    #[test]
    fn truncates_by_chars() {
        assert_eq!(truncate_chars("héllo", 10), "héllo");
        let t = truncate_chars("ééééé", 2);
        assert!(t.starts_with("éé\n…[truncated, 3 more"));
    }
}
