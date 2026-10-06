//! Agent engine: a private `fm serve --socket` instance, a guided-JSON tool
//! router (see `router`), built-in + custom + MCP tools, skills, and agent
//! chat storage.
//!
//! Types that cross the IPC boundary are mirrored in `src/lib/types.ts`.

pub mod builtin;
pub mod chats;
pub mod commands;
pub mod custom;
pub mod fm_client;
pub mod process;
pub mod router;
pub mod schema;
pub mod tools;

#[cfg(test)]
mod integration_tests;

use crate::util::LockExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

/// One tool call inside an assistant turn.
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

/// Token usage of a turn.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// One message of an agent chat.
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

/// An agent chat, stored as `<data>/chats/<id>.json`.
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

/// A chat in the chat list.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub message_count: u32,
    pub preview: String,
}

/// Streamed to the UI during `chat_send`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AgentEvent {
    /// The saved user message.
    UserMessage {
        message: ChatMessage,
    },
    AssistantStart {
        message_id: String,
    },
    /// Short status line, e.g. "Thinking…", "Loading skill pdf-tips".
    Status {
        text: String,
    },
    /// A step was added or changed (same id → replace).
    Step {
        step: AgentStep,
    },
    /// The UI must call `approval_respond(approvalId, ...)`.
    ApprovalRequired {
        approval_id: String,
        step: AgentStep,
    },
    /// Answer text chunk.
    Delta {
        text: String,
    },
    /// Context usage after the turn.
    Context {
        used_tokens: u32,
        context_size: u32,
    },
    Done {
        message: ChatMessage,
    },
    Error {
        message: String,
    },
}

/// One entry in the tool catalog (Tools page, chat tool picker).
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

/// Result of running a tool from the Tools page.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolTestResult {
    pub ok: bool,
    pub output: String,
    pub duration_ms: u64,
}

/// State of the private `fm serve`.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub running: bool,
    pub socket_path: String,
    pub pid: Option<u32>,
    pub last_error: Option<String>,
}

/// Lives in AppState. Owns the private `fm serve` child process,
/// pending approvals and cancellation of active chats.
pub struct Engine {
    pub socket_path: PathBuf,
    pub chats_dir: PathBuf,
    /// The private `fm serve --socket` child and its HTTP client.
    pub(crate) server: fm_client::FmServer,
    /// Pending approvals: approval id → sender of the decision.
    approvals: Mutex<HashMap<String, oneshot::Sender<String>>>,
    /// Running turns: chat id → cancel token.
    active: Mutex<HashMap<String, CancellationToken>>,
}

impl Engine {
    pub fn new(socket_path: PathBuf, chats_dir: PathBuf) -> Self {
        Self {
            server: fm_client::FmServer::new(socket_path.clone()),
            socket_path,
            chats_dir,
            approvals: Mutex::new(HashMap::new()),
            active: Mutex::new(HashMap::new()),
        }
    }

    /// Stops the private server and every running turn. Called on app exit.
    pub async fn shutdown(&self) {
        let tokens: Vec<CancellationToken> = self.active.lock_safe().drain().map(|(_, t)| t).collect();
        for token in tokens {
            token.cancel();
        }
        self.approvals.lock_safe().clear();
        self.server.stop().await;
    }

    /// Marks a chat as answering. Only one turn per chat at a time.
    pub(crate) fn begin_run(&self, chat_id: &str) -> Result<CancellationToken, String> {
        let mut active = self.active.lock_safe();
        if active.contains_key(chat_id) {
            return Err("This chat is still answering. Wait for it, or press Stop.".into());
        }
        let token = CancellationToken::new();
        active.insert(chat_id.to_string(), token.clone());
        Ok(token)
    }

    pub(crate) fn end_run(&self, chat_id: &str) {
        self.active.lock_safe().remove(chat_id);
    }

    /// Stops a running turn. Returns false when the chat was not answering.
    pub fn cancel_run(&self, chat_id: &str) -> bool {
        match self.active.lock_safe().get(chat_id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    pub(crate) fn register_approval(&self, approval_id: &str) -> oneshot::Receiver<String> {
        let (tx, rx) = oneshot::channel();
        self.approvals.lock_safe().insert(approval_id.to_string(), tx);
        rx
    }

    pub(crate) fn drop_approval(&self, approval_id: &str) {
        self.approvals.lock_safe().remove(approval_id);
    }

    /// Delivers the user's decision. False when nothing waits for it.
    pub fn respond_approval(&self, approval_id: &str, decision: &str) -> bool {
        match self.approvals.lock_safe().remove(approval_id) {
            Some(tx) => tx.send(decision.to_string()).is_ok(),
            None => false,
        }
    }
}
