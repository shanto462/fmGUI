//! Shared app state. CONTRACT FILE (owned by the lead).

use crate::config::AppConfig;
use std::path::PathBuf;
use std::sync::RwLock;

/// All folders and files the app uses.
#[derive(Debug, Clone)]
pub struct Paths {
    /// `~/Library/Application Support/io.shanto.fmgui`
    pub data_dir: PathBuf,
    /// `<data>/config.json`
    pub config_file: PathBuf,
    /// `<data>/chats/` — agent chats (one JSON file per chat).
    pub chats_dir: PathBuf,
    /// `<data>/skills/` — one folder per skill with a SKILL.md.
    pub skills_dir: PathBuf,
    /// `<data>/tmp/` — pasted images, schemas written for the CLI, etc.
    pub tmp_dir: PathBuf,
    /// `<data>/engine.sock` — private `fm serve` used by the agent engine.
    pub engine_socket: PathBuf,
    /// `~/.fm/sessions/` — CLI chat sessions shared with `fm chat`.
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
            cli_sessions_dir: home.join(".fm").join("sessions"),
            data_dir,
        };
        for dir in [&paths.data_dir, &paths.chats_dir, &paths.skills_dir, &paths.tmp_dir] {
            let _ = std::fs::create_dir_all(dir);
        }
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
            public_server: crate::fm::public_server::PublicServer::default(),
            engine: crate::engine::Engine::new(paths.engine_socket.clone(), paths.chats_dir.clone()),
            mcp: crate::mcp::McpManager::default(),
            skills: crate::skills::SkillStore::new(paths.skills_dir.clone()),
            config: RwLock::new(config),
            paths,
        }
    }

    /// Snapshot of the current config.
    pub fn config(&self) -> AppConfig {
        self.config.read().unwrap().clone()
    }

    pub fn fm_path(&self) -> String {
        self.config.read().unwrap().fm_path.clone()
    }
}
