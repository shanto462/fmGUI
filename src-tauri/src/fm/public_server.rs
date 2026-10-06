//! The user-facing `fm serve` instance (Server page), for other apps to use.
//! OWNER: agent "cli".
//! Events: "public-server-log" (LogLine) for each output line,
//!         "public-server-state" (PublicServerStatus) on start/stop/exit.

use serde::Serialize;

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub ts: i64,
    pub line: String,
}

/// CONTRACT
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

/// CONTRACT: holds the child process. Must kill it on `stop` and on app exit.
#[derive(Default)]
pub struct PublicServer {
    // Agent "cli": add fields (tokio Mutex<Option<Child>>, log ring buffer, ...).
}

impl PublicServer {
    /// CONTRACT: kill the child if running. Called on app exit.
    pub async fn shutdown(&self) {}
}
