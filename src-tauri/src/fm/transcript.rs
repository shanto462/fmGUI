//! Parser for FoundationModels transcript JSON (`--save-transcript` files and
//! `~/.fm/sessions/*.json`). Must be lenient: unknown fields and roles are kept
//! as best as possible, never fail on them.
//! OWNER: agent "cli".

use serde::Serialize;

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptMessage {
    pub id: String,
    /// "instructions" | "user" | "response" | anything else found in the file.
    pub role: String,
    pub text: String,
    /// Images as data URLs (`data:image/jpeg;base64,...`).
    pub images: Vec<String>,
}

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTranscript {
    pub model_name: Option<String>,
    pub instructions: Option<String>,
    /// Without the instructions entry.
    pub messages: Vec<TranscriptMessage>,
    pub system_version: Option<String>,
}

/// CONTRACT
pub fn parse(bytes: &[u8]) -> Result<ParsedTranscript, String> {
    let _ = bytes;
    Err("transcript::parse is not implemented yet".into())
}
