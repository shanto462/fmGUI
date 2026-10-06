//! Finds and stops child processes left behind by an earlier run.
//!
//! When the app is killed (Force Quit, a crash, `kill -9`, a `tauri dev`
//! restart), it cannot stop its children, and they keep running with parent
//! pid 1. On the next start we look for them in two ways:
//!
//! - The private engine server is `fm serve --socket <path in our data folder>`,
//!   so a scan of `ps` finds it by its command line. No pid file is needed.
//! - The public server (its TCP address is not unique to us) and stdio MCP
//!   servers write a pid file when they start. The file holds the pid, the
//!   process start time and the command, and a process is only stopped when
//!   all of them still match. A pid that was reused by another program is
//!   never touched.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long a process gets after SIGTERM before SIGKILL.
pub const KILL_GRACE: Duration = Duration::from_secs(1);

/// What a pid file holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PidRecord {
    pub pid: u32,
    /// The pid is a process group id (the whole group is stopped).
    pub group: bool,
    /// Start time as printed by `ps -o lstart=`. Empty when unknown.
    pub started: String,
    /// The program we started (absolute path).
    pub program: String,
    /// Its first argument (often the script or subcommand).
    pub first_arg: String,
}

/// Runs `/bin/ps` with `args` and returns its output.
fn ps(args: &[&str]) -> Option<String> {
    let out = Command::new("/bin/ps").args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The full command line of a running process.
pub fn process_command(pid: u32) -> Option<String> {
    let text = ps(&["-ww", "-o", "command=", "-p", &pid.to_string()])?;
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// When a process started (one-second resolution), used with the pid to make
/// sure it is still the same process.
pub fn process_start_time(pid: u32) -> Option<String> {
    let text = ps(&["-o", "lstart=", "-p", &pid.to_string()])?;
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// True while the process (or, with `group`, any process of the group) runs.
/// Zombies (exited, not yet reaped) count as gone.
pub fn is_running(pid: u32, group: bool) -> bool {
    let Ok(id) = i32::try_from(pid) else { return false };
    if id <= 1 {
        return false;
    }
    let target = if group { -id } else { id };
    // SAFETY: kill(2) with signal 0 only checks that the target exists.
    let exists =
        unsafe { libc::kill(target, 0) } == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
    if !exists {
        return false;
    }
    if group {
        return true;
    }
    match ps(&["-o", "stat=", "-p", &pid.to_string()]) {
        Some(stat) => !stat.trim().starts_with('Z'),
        None => false,
    }
}

/// Sends `signal` to the process or its group. Refuses pids 0 and 1.
fn send_signal(pid: u32, group: bool, signal: i32) {
    let Ok(id) = i32::try_from(pid) else { return };
    if id <= 1 {
        return;
    }
    // SAFETY: plain kill(2)/killpg(2) calls with a checked, positive id.
    unsafe {
        if group {
            libc::killpg(id, signal);
        } else {
            libc::kill(id, signal);
        }
    }
}

/// SIGTERM, wait up to `grace`, then SIGKILL. `still_ours` is checked again
/// right before SIGKILL, so a pid reused during the wait is left alone.
pub fn terminate(pid: u32, group: bool, grace: Duration, still_ours: impl Fn() -> bool) {
    send_signal(pid, group, libc::SIGTERM);
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if !is_running(pid, group) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if is_running(pid, group) && still_ours() {
        send_signal(pid, group, libc::SIGKILL);
    }
}

// ---------- engine servers found by command line ----------

/// Pids from `ps -axo pid=,command=` output that are `<fm> serve ...` runs
/// whose command line contains one of `markers` (our data folder, our socket
/// path). Other `fm` processes (the user's own `fm chat` or `fm serve`) are
/// never selected, and neither is `own_pid`.
pub fn stale_servers(ps_output: &str, fm_paths: &[String], markers: &[String], own_pid: u32) -> Vec<u32> {
    let markers: Vec<&String> = markers.iter().filter(|m| !m.trim().is_empty()).collect();
    if markers.is_empty() {
        return Vec::new();
    }
    ps_output
        .lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let (pid, command) = line.split_once(char::is_whitespace)?;
            let pid: u32 = pid.parse().ok()?;
            let command = command.trim();
            let is_fm_serve = fm_paths.iter().filter(|fm| !fm.trim().is_empty()).any(|fm| {
                command.strip_prefix(fm.as_str()).is_some_and(|rest| rest == " serve" || rest.starts_with(" serve "))
            });
            let ours = markers.iter().any(|m| command.contains(m.as_str()));
            (pid != own_pid && pid > 1 && is_fm_serve && ours).then_some(pid)
        })
        .collect()
}

/// Stops every `fm serve` left over from an earlier run (see [`stale_servers`]).
/// Returns how many were found.
pub fn kill_stale_servers(fm_paths: &[String], markers: &[String]) -> usize {
    let Some(output) = ps(&["-axww", "-o", "pid=,command="]) else { return 0 };
    let pids = stale_servers(&output, fm_paths, markers, std::process::id());
    for &pid in &pids {
        let still_ours = || {
            process_command(pid)
                .map(|cmd| !stale_servers(&format!("{pid} {cmd}"), fm_paths, markers, 0).is_empty())
                .unwrap_or(false)
        };
        terminate(pid, false, KILL_GRACE, still_ours);
    }
    pids.len()
}

// ---------- pid files ----------

/// True when `command` (a live command line) looks like the program of `record`.
/// Scripts run through an interpreter (`node /path/npx -y pkg`, a python shim)
/// show another program first, so the first argument also counts.
pub fn command_matches(command: &str, record: &PidRecord) -> bool {
    let program = record.program.trim();
    let base = Path::new(program).file_name().and_then(|n| n.to_str()).unwrap_or("");
    let first_arg = record.first_arg.trim();
    (!program.is_empty() && command.contains(program))
        || (!base.is_empty() && command.contains(base))
        || (!first_arg.is_empty() && command.contains(first_arg))
}

/// True when the process in `record` still runs and is still the one we started.
pub fn record_is_live(record: &PidRecord) -> bool {
    if !is_running(record.pid, record.group) {
        return false;
    }
    // The group leader may be gone while its children still run; then only
    // the start time of the leader could prove identity, and it is lost.
    // Without a live leader we cannot prove the group is ours: leave it.
    let Some(command) = process_command(record.pid) else { return false };
    if !command_matches(&command, record) {
        return false;
    }
    record.started.is_empty() || process_start_time(record.pid).as_deref() == Some(record.started.as_str())
}

/// Writes a pid file for a child we just started.
pub fn write_pid_file(path: &Path, pid: u32, group: bool, program: &str, first_arg: &str) -> std::io::Result<()> {
    let record = PidRecord {
        pid,
        group,
        started: process_start_time(pid).unwrap_or_default(),
        program: program.to_string(),
        first_arg: first_arg.to_string(),
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec(&record).map_err(std::io::Error::other)?;
    std::fs::write(path, json)
}

pub fn remove_pid_file(path: &Path) {
    let _ = std::fs::remove_file(path);
}

/// Stops the process of a leftover pid file (when it is still ours) and
/// removes the file. Returns true when a process was stopped.
pub fn reap_pid_file(path: &Path) -> bool {
    let Ok(bytes) = std::fs::read(path) else { return false };
    let record: Option<PidRecord> = serde_json::from_slice(&bytes).ok();
    let mut stopped = false;
    if let Some(record) = record {
        if record_is_live(&record) {
            terminate(record.pid, record.group, KILL_GRACE, || record_is_live(&record));
            stopped = true;
        } else if orphaned_group(&record) {
            terminate(record.pid, true, KILL_GRACE, || orphaned_group(&record));
            stopped = true;
        }
    }
    remove_pid_file(path);
    stopped
}

/// The leader of a recorded process group is gone, but members of the group
/// still run (npx exited, its node child did not). The system never hands
/// out a group id again while the group exists, and no process can have the
/// leader's pid while that pid is a live group id, so these members are the
/// server's own children.
fn orphaned_group(record: &PidRecord) -> bool {
    let Ok(id) = i32::try_from(record.pid) else { return false };
    if !record.group || id <= 1 {
        return false;
    }
    // SAFETY: kill(2) with signal 0 only checks that the target exists.
    let leader_exists =
        unsafe { libc::kill(id, 0) } == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
    !leader_exists && is_running(record.pid, true)
}

/// [`reap_pid_file`] for every `*.pid` file in `dir`.
pub fn reap_pid_dir(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("pid"))
        .filter(|p| reap_pid_file(p))
        .count()
}

/// A file name for `id` (letters, digits, `-` and `_` only, at most 64).
pub fn pid_file_name(id: &str) -> String {
    let clean: String =
        id.chars().take(64).map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    if clean.is_empty() {
        "server.pid".into()
    } else {
        format!("{clean}.pid")
    }
}

/// Everything to clean up when the app starts, before any child is started.
pub struct Leftovers {
    /// fm binaries whose `serve` runs may be ours.
    pub fm_paths: Vec<String>,
    /// Text that only our engine servers have on their command line.
    pub markers: Vec<String>,
    pub pid_files: Vec<PathBuf>,
    pub pid_dirs: Vec<PathBuf>,
}

impl Leftovers {
    /// Stops everything found. Returns how many processes were stopped.
    pub fn clean(&self) -> usize {
        let mut count = kill_stale_servers(&self.fm_paths, &self.markers);
        count += self.pid_files.iter().filter(|p| reap_pid_file(p)).count();
        count += self.pid_dirs.iter().map(|d| reap_pid_dir(d)).sum::<usize>();
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn selects_only_our_fm_serve_processes() {
        let data = "/Users/ada/Library/Application Support/io.shanto.fmgui/";
        let ps = format!(
            "  101 /usr/bin/fm serve --socket {data}engine.sock\n\
             102 /usr/bin/fm serve --socket /tmp/fm.sock\n\
             103 /usr/bin/fm chat --resume {data}x\n\
             104 /usr/bin/fm serve --host 127.0.0.1 --port 1976\n\
             105 /bin/zsh -c /usr/bin/fm serve --socket {data}engine.sock\n\
             106 /opt/fm/bin/fm serve --socket {data}engine.sock\n\
             107 /usr/bin/fm serveX --socket {data}engine.sock\n\
             108 /usr/bin/fm serve --socket /Users/ada/Library/Application Support/io.shanto.fmgui2/engine.sock\n\
             109 /usr/bin/fm serve --socket /var/folders/xy/T/fmgui-00ff.sock\n\
             not-a-pid /usr/bin/fm serve --socket {data}engine.sock\n\
             1 /usr/bin/fm serve --socket {data}engine.sock\n\
             555 /usr/bin/fm serve --socket {data}engine.sock\n"
        );
        let fm = strings(&["/usr/bin/fm"]);
        let markers = strings(&[data, "/var/folders/xy/T/fmgui-00ff.sock"]);
        assert_eq!(stale_servers(&ps, &fm, &markers, 555), vec![101, 109]);
        // A custom fm path from the settings.
        let both = strings(&["/usr/bin/fm", "/opt/fm/bin/fm"]);
        assert_eq!(stale_servers(&ps, &both, &markers, 555), vec![101, 106, 109]);
        // No markers: nothing is ever selected.
        assert!(stale_servers(&ps, &fm, &strings(&["", " "]), 555).is_empty());
    }

    #[test]
    fn command_match_rules() {
        let record = |program: &str, first_arg: &str| PidRecord {
            pid: 1,
            group: true,
            started: String::new(),
            program: program.into(),
            first_arg: first_arg.into(),
        };
        let npx = record("/opt/homebrew/bin/npx", "-y");
        assert!(command_matches("node /opt/homebrew/bin/npx -y @scope/server", &npx));
        let py = record("/usr/bin/python3", "/Users/ada/server.py");
        assert!(command_matches("/Library/Frameworks/Python.app/Contents/MacOS/Python /Users/ada/server.py", &py));
        assert!(!command_matches("/usr/bin/vim notes.txt", &py));
        assert!(!command_matches("anything", &record("", "")));
        assert_eq!(pid_file_name("a1-b_2"), "a1-b_2.pid");
        assert_eq!(pid_file_name("../../etc/x"), "______etc_x.pid");
        assert_eq!(pid_file_name(""), "server.pid");
    }

    /// A harmless `sleep 60` whose command line (argv[0]) looks like `title`.
    fn fake_process(title: &str) -> std::process::Child {
        Command::new("/bin/sleep")
            .arg0(title)
            .arg("60")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
    }

    /// True once `child` exited (reaps it).
    fn exited(child: &mut std::process::Child) -> bool {
        for _ in 0..60 {
            if child.try_wait().unwrap().is_some() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn kills_matching_engine_servers_only() {
        let dir = tempfile::tempdir().unwrap();
        let fm = dir.path().join("fm").display().to_string();
        let data = format!("{}/data/", dir.path().display());
        let mut ours = fake_process(&format!("{fm} serve --socket {data}engine.sock"));
        let mut other = fake_process(&format!("{fm} serve --socket /tmp/someone-else.sock"));
        let mut chat = fake_process(&format!("{fm} chat {data}x"));
        std::thread::sleep(Duration::from_millis(100));

        let found = kill_stale_servers(std::slice::from_ref(&fm), std::slice::from_ref(&data));
        assert_eq!(found, 1);
        assert!(exited(&mut ours), "our server should be stopped");
        assert!(other.try_wait().unwrap().is_none(), "another server must keep running");
        assert!(chat.try_wait().unwrap().is_none(), "fm chat must keep running");
        for child in [&mut other, &mut chat] {
            child.kill().unwrap();
            child.wait().unwrap();
        }
    }

    #[test]
    fn pid_files_stop_only_matching_processes() {
        let dir = tempfile::tempdir().unwrap();

        // Ours: pid, start time and command match.
        let mut ours = fake_process("/usr/local/bin/my-mcp-server --stdio");
        let file = dir.path().join("mcp").join("ours.pid");
        write_pid_file(&file, ours.id(), false, "/usr/local/bin/my-mcp-server", "--stdio").unwrap();
        assert!(reap_pid_file(&file));
        assert!(exited(&mut ours));
        assert!(!file.exists());

        // The pid now belongs to another program: never touched.
        let mut stranger = fake_process("/usr/bin/some-other-tool");
        let file = dir.path().join("stranger.pid");
        write_pid_file(&file, stranger.id(), false, "/usr/local/bin/my-mcp-server", "--stdio").unwrap();
        assert!(!reap_pid_file(&file));
        assert!(stranger.try_wait().unwrap().is_none());
        assert!(!file.exists());

        // Same command, but another start time (a reused pid): not touched.
        let mut reused = fake_process("/usr/local/bin/my-mcp-server --stdio");
        let record = PidRecord {
            pid: reused.id(),
            group: false,
            started: "Mon Jan  1 00:00:00 2001".into(),
            program: "/usr/local/bin/my-mcp-server".into(),
            first_arg: "--stdio".into(),
        };
        let file = dir.path().join("reused.pid");
        std::fs::write(&file, serde_json::to_vec(&record).unwrap()).unwrap();
        assert!(!reap_pid_file(&file));
        assert!(reused.try_wait().unwrap().is_none());

        // Broken and stale files are just removed.
        std::fs::write(dir.path().join("broken.pid"), "not json").unwrap();
        assert_eq!(reap_pid_dir(dir.path()), 0);
        assert!(!dir.path().join("broken.pid").exists());

        for child in [&mut stranger, &mut reused] {
            child.kill().unwrap();
            child.wait().unwrap();
        }
    }

    #[test]
    fn children_of_a_dead_group_leader_are_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let mut leader = Command::new("/bin/sh")
            .args(["-c", "sleep 60 & sleep 0.5"])
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let pgid = leader.id();
        let file = dir.path().join("orphans.pid");
        write_pid_file(&file, pgid, true, "/bin/sh", "-c").unwrap();
        leader.wait().unwrap(); // the leader exits; its `sleep 60` keeps running
        assert!(is_running(pgid, true));
        assert!(reap_pid_file(&file));
        std::thread::sleep(Duration::from_millis(200));
        assert!(!is_running(pgid, true), "the orphaned child should be stopped");
    }

    #[test]
    fn process_groups_are_stopped_together() {
        let dir = tempfile::tempdir().unwrap();
        // A shell (group leader) with a background child in the same group.
        let mut leader = Command::new("/bin/sh")
            .args(["-c", "sleep 60 & wait"])
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(150));
        let file = dir.path().join("group.pid");
        write_pid_file(&file, leader.id(), true, "/bin/sh", "-c").unwrap();
        assert!(reap_pid_file(&file));
        assert!(exited(&mut leader));
        std::thread::sleep(Duration::from_millis(100));
        assert!(!is_running(leader.id(), true), "the background sleep should be gone too");
    }
}
