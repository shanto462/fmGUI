//! Shared app state and the folders the app uses.

use crate::config::AppConfig;
use crate::util::RwLockExt;
use std::path::PathBuf;
use std::sync::RwLock;

/// All folders and files the app uses.
#[derive(Debug, Clone)]
pub struct Paths {
    /// `~/Library/Application Support/io.shanto.fmgui`
    pub data_dir: PathBuf,
    /// `<data>/config.json`
    pub config_file: PathBuf,
    /// `<data>/chats/`: agent chats (one JSON file per chat).
    pub chats_dir: PathBuf,
    /// `<data>/skills/`: one folder per skill with a SKILL.md.
    pub skills_dir: PathBuf,
    /// `<data>/tmp/`: pasted images, schemas written for the CLI, etc.
    pub tmp_dir: PathBuf,
    /// `<data>/engine.sock`: private `fm serve` used by the agent engine.
    pub engine_socket: PathBuf,
    /// `<data>/public-server.pid`: the user-facing `fm serve`, for cleanup
    /// after a crash.
    pub public_server_pid: PathBuf,
    /// `<data>/mcp/`: one `<server id>.pid` per running stdio MCP server.
    pub mcp_pid_dir: PathBuf,
    /// `~/.fm/sessions/`: CLI chat sessions shared with `fm chat`.
    pub cli_sessions_dir: PathBuf,
}

impl Paths {
    pub fn new(data_dir: PathBuf) -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        let paths = Self {
            config_file: data_dir.join("config.json"),
            chats_dir: data_dir.join("chats"),
            skills_dir: data_dir.join("skills"),
            tmp_dir: data_dir.join("tmp"),
            engine_socket: data_dir.join("engine.sock"),
            public_server_pid: data_dir.join("public-server.pid"),
            mcp_pid_dir: data_dir.join("mcp"),
            cli_sessions_dir: home.join(".fm").join("sessions"),
            data_dir,
        };
        for dir in [&paths.data_dir, &paths.chats_dir, &paths.skills_dir, &paths.tmp_dir, &paths.mcp_pid_dir] {
            let _ = std::fs::create_dir_all(dir);
        }
        // Chats, the engine socket and settings are private: owner only.
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&paths.data_dir, std::fs::Permissions::from_mode(0o700));
        paths
    }
}

pub struct AppState {
    pub paths: Paths,
    pub config: RwLock<AppConfig>,
    pub runs: crate::fm::RunRegistry,
    pub public_server: crate::fm::public_server::PublicServer,
    pub engine: crate::engine::Engine,
    pub mcp: crate::mcp::McpManager,
    pub skills: crate::skills::SkillStore,
}

impl AppState {
    pub fn new(paths: Paths) -> Self {
        let config = AppConfig::load(&paths.config_file);
        Self {
            runs: crate::fm::RunRegistry::default(),
            public_server: crate::fm::public_server::PublicServer::with_pid_file(paths.public_server_pid.clone()),
            engine: crate::engine::Engine::new(paths.engine_socket.clone(), paths.chats_dir.clone()),
            mcp: crate::mcp::McpManager::with_pid_dir(paths.mcp_pid_dir.clone()),
            skills: crate::skills::SkillStore::new(paths.skills_dir.clone()),
            config: RwLock::new(config),
            paths,
        }
    }

    /// Snapshot of the current config.
    pub fn config(&self) -> AppConfig {
        self.config.read_safe().clone()
    }

    pub fn fm_path(&self) -> String {
        self.config.read_safe().fm_path.clone()
    }

    /// Leftover child processes of an earlier run of the app (see `procs`).
    pub fn leftovers(paths: &Paths, fm_path: &str) -> crate::procs::Leftovers {
        let mut fm_paths = vec![fm_path.to_string()];
        if fm_path != "/usr/bin/fm" {
            fm_paths.push("/usr/bin/fm".into());
        }
        let mut markers = vec![format!("{}/", paths.data_dir.display())];
        let socket = crate::engine::fm_client::effective_socket_path(&paths.engine_socket);
        if !socket.starts_with(&paths.data_dir) {
            markers.push(socket.display().to_string());
        }
        crate::procs::Leftovers {
            fm_paths,
            markers,
            pid_files: vec![paths.public_server_pid.clone()],
            pid_dirs: vec![paths.mcp_pid_dir.clone()],
        }
    }
}
