//! Agent engine: a private `fm serve --socket` instance, a guided-JSON tool
//! router (see decisions.md D5), built-in + custom + MCP tools, skills, and
//! agent chat storage.
//! OWNER: agent "engine". Items marked CONTRACT keep their signatures.

pub mod chats;
pub mod commands;
pub mod fm_client;
pub mod router;
pub mod schema;
pub mod tools;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// CONTRACT: one tool call inside an assistant turn.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentStep {
    pub id: String,
    /// Catalog id, e.g. "builtin:calculator", "custom:<id>", "mcp:<serverId>:<tool>", "skill:use_skill".
    pub tool_id: String,
    /// Name the model used.
    pub tool_name: String,
    /// Human title for the UI.
    pub title: String,
    /// "builtin" | "custom" | "mcp" | "skill"
    pub source: String,
    pub arguments: serde_json::Value,
    /// "pendingApproval" | "running" | "done" | "error" | "denied"
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub duration_ms: Option<u64>,
}

/// CONTRACT
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// CONTRACT
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatMessage {
    pub id: String,
    /// "user" | "assistant"
    pub role: String,
    pub text: String,
    /// Data URLs.
    pub images: Vec<String>,
    /// Tool calls made while producing this assistant message.
    pub steps: Vec<AgentStep>,
    /// Skills loaded or always-on during this turn.
    pub skills_used: Vec<String>,
    pub created_at: i64,
    pub usage: Option<Usage>,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
}

/// CONTRACT
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Chat {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub instructions: String,
    pub messages: Vec<ChatMessage>,
}

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub message_count: u32,
    pub preview: String,
}

/// CONTRACT: streamed to the UI during `chat_send`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AgentEvent {
    /// The saved user message.
    UserMessage { message: ChatMessage },
    AssistantStart { message_id: String },
    /// Short status line, e.g. "Thinking…", "Loading skill pdf-tips".
    Status { text: String },
    /// A step was added or changed (same id → replace).
    Step { step: AgentStep },
    /// The UI must call `approval_respond(approvalId, ...)`.
    ApprovalRequired { approval_id: String, step: AgentStep },
    /// Answer text chunk.
    Delta { text: String },
    /// Context usage after the turn.
    Context { used_tokens: u32, context_size: u32 },
    Done { message: ChatMessage },
    Error { message: String },
}

/// CONTRACT: one entry in the tool catalog (Tools page, chat tool picker).
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub id: String,
    /// Name the model sees (unique across all tools).
    pub name: String,
    pub title: String,
    pub description: String,
    /// "builtin" | "custom" | "mcp" | "skill"
    pub source: String,
    /// e.g. "Built-in", "Shell", "HTTP", "Shortcut", MCP server name.
    pub source_label: String,
    pub enabled: bool,
    /// "ask" | "always"
    pub approval: String,
    /// JSON schema of the arguments (as shown to the model).
    pub input_schema: serde_json::Value,
    /// Approximate tokens this tool adds to every request.
    pub token_estimate: u32,
    /// True for tools that can change things (write files, run commands).
    pub dangerous: bool,
}

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolTestResult {
    pub ok: bool,
    pub output: String,
    pub duration_ms: u64,
}

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub running: bool,
    pub socket_path: String,
    pub pid: Option<u32>,
    pub last_error: Option<String>,
}

/// CONTRACT: lives in AppState. Owns the private `fm serve` child process,
/// pending approvals and cancellation of active chats.
pub struct Engine {
    pub socket_path: PathBuf,
    pub chats_dir: PathBuf,
    // Agent "engine": add fields (server child, approvals map, active runs, ...).
}

impl Engine {
    /// CONTRACT
    pub fn new(socket_path: PathBuf, chats_dir: PathBuf) -> Self {
        Self { socket_path, chats_dir }
    }

    /// CONTRACT: stop the private server. Called on app exit.
    pub async fn shutdown(&self) {}
}
