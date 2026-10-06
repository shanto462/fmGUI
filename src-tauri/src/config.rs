//! Persisted app configuration (`<app data>/config.json`).
//!
//! Mirrored in `src/lib/types.ts`. New fields need `#[serde(default)]` so
//! older config files still load; never rename or remove fields.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    /// Path to the `fm` binary.
    pub fm_path: String,
    /// True once the user finished the setup wizard.
    pub setup_completed: bool,
    /// Context window of the on-device model, in tokens. 8,192 on the dev Mac;
    /// some Macs report 4,096, so the user can change it in Settings.
    pub context_size: u32,
    pub chat_defaults: ChatDefaults,
    /// Built-in tool preferences, keyed by built-in tool name (e.g. "calculator").
    pub builtin_tools: BTreeMap<String, ToolPrefs>,
    pub custom_tools: Vec<CustomTool>,
    pub mcp_servers: Vec<McpServerConfig>,
    /// Skill preferences, keyed by skill name.
    pub skills: BTreeMap<String, SkillPrefs>,
    /// Folders the file tools (read_file, list_directory, write_file) may touch.
    pub allowed_folders: Vec<String>,
    pub public_server: PublicServerConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            fm_path: "/usr/bin/fm".into(),
            setup_completed: false,
            context_size: 8192,
            chat_defaults: ChatDefaults::default(),
            builtin_tools: BTreeMap::new(),
            custom_tools: Vec::new(),
            mcp_servers: Vec::new(),
            skills: BTreeMap::new(),
            allowed_folders: Vec::new(),
            public_server: PublicServerConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatDefaults {
    /// Default instructions (system prompt) for new agent chats.
    pub instructions: String,
    /// Max tool calls in one turn before the model must answer.
    pub max_tool_steps: u32,
    /// Use tools at all in agent chats.
    pub tools_enabled: bool,
    pub temperature: Option<f64>,
}

impl Default for ChatDefaults {
    fn default() -> Self {
        Self {
            instructions: "You are a helpful assistant running on-device on a Mac. Answer clearly and briefly.".into(),
            max_tool_steps: 4,
            tools_enabled: true,
            temperature: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Approval {
    /// Ask the user before every call.
    #[default]
    Ask,
    /// Run without asking.
    Always,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ToolPrefs {
    pub enabled: bool,
    pub approval: Approval,
}

impl Default for ToolPrefs {
    fn default() -> Self {
        Self { enabled: true, approval: Approval::Ask }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ParamType {
    #[default]
    String,
    Integer,
    Number,
    Boolean,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ToolParam {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: ParamType,
    pub description: String,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

/// A user-defined tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTool {
    pub id: String,
    /// Tool name the model sees: lowercase letters, digits and underscores.
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub params: Vec<ToolParam>,
    pub kind: CustomToolKind,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub approval: Approval,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CustomToolKind {
    /// Runs `/bin/zsh -c <command>`. Arguments are passed as env vars
    /// `FM_ARG_<NAME>` (upper case) and as a JSON object on stdin. They are
    /// never spliced into the command text.
    Shell {
        command: String,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default = "default_timeout")]
        timeout_secs: u64,
    },
    /// HTTP request. `{{param}}` placeholders in url (URL-encoded), headers and
    /// body (JSON-escaped when the body is JSON) are replaced with arguments.
    Http {
        method: String,
        url: String,
        #[serde(default)]
        headers: Vec<KeyValue>,
        #[serde(default)]
        body: Option<String>,
        #[serde(default = "default_timeout")]
        timeout_secs: u64,
    },
    /// Runs an Apple Shortcut:
    /// `shortcuts run [--input-path <in>] --output-path <out> -- <name>`.
    /// The input file holds the single argument (or all arguments as JSON);
    /// the output file is the tool result (stdout when it stays empty).
    Shortcut {
        shortcut_name: String,
        #[serde(default = "default_timeout")]
        timeout_secs: u64,
    },
}

fn default_timeout() -> u64 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub transport: McpTransport,
    /// Tools the user switched off for this server.
    #[serde(default)]
    pub disabled_tools: Vec<String>,
    #[serde(default)]
    pub approval: Approval,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum McpTransport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: Vec<KeyValue>,
        #[serde(default)]
        cwd: Option<String>,
    },
    /// MCP Streamable HTTP transport.
    Http {
        url: String,
        #[serde(default)]
        headers: Vec<KeyValue>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SkillMode {
    Off,
    /// Listed to the model; loaded when the model calls `use_skill`.
    #[default]
    OnDemand,
    /// Body is always added to the instructions.
    Always,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SkillPrefs {
    pub mode: SkillMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PublicServerConfig {
    /// "tcp" or "socket".
    pub mode: String,
    pub host: String,
    pub port: u16,
    pub socket_path: String,
    pub autostart: bool,
}

impl Default for PublicServerConfig {
    fn default() -> Self {
        Self { mode: "tcp".into(), host: "127.0.0.1".into(), port: 1976, socket_path: String::new(), autostart: false }
    }
}

impl AppConfig {
    pub fn load(path: &Path) -> Self {
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                eprintln!("config: {} is invalid ({err}); using defaults", path.display());
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    /// Writes atomically (temp file + rename) so a crash never leaves half a file.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let json = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    }

    pub fn builtin_prefs(&self, name: &str, default_enabled: bool, default_approval: Approval) -> ToolPrefs {
        self.builtin_tools
            .get(name)
            .cloned()
            .unwrap_or(ToolPrefs { enabled: default_enabled, approval: default_approval })
    }

    pub fn skill_mode(&self, name: &str) -> SkillMode {
        self.skills.get(name).map(|p| p.mode).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_with_tagged_enums() {
        let mut cfg = AppConfig::default();
        cfg.custom_tools.push(CustomTool {
            id: "t1".into(),
            name: "lookup_order".into(),
            description: "Look up an order".into(),
            params: vec![ToolParam {
                name: "order_id".into(),
                kind: ParamType::String,
                description: "Order id".into(),
                required: true,
            }],
            kind: CustomToolKind::Http {
                method: "GET".into(),
                url: "https://example.com/orders/{{order_id}}".into(),
                headers: vec![],
                body: None,
                timeout_secs: 10,
            },
            enabled: true,
            approval: Approval::Always,
        });
        cfg.mcp_servers.push(McpServerConfig {
            id: "m1".into(),
            name: "Filesystem".into(),
            enabled: true,
            transport: McpTransport::Stdio { command: "npx".into(), args: vec!["-y".into()], env: vec![], cwd: None },
            disabled_tools: vec![],
            approval: Approval::Ask,
        });
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["customTools"][0]["kind"]["type"], "http");
        assert_eq!(json["customTools"][0]["kind"]["timeoutSecs"], 10);
        assert_eq!(json["customTools"][0]["params"][0]["type"], "string");
        assert_eq!(json["mcpServers"][0]["transport"]["type"], "stdio");
        let back: AppConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back.custom_tools[0].name, "lookup_order");
    }

    #[test]
    fn missing_fields_use_defaults() {
        let cfg: AppConfig = serde_json::from_str(r#"{"setupCompleted": true}"#).unwrap();
        assert!(cfg.setup_completed);
        assert_eq!(cfg.fm_path, "/usr/bin/fm");
        assert_eq!(cfg.context_size, 8192);
    }
}
