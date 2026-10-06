//! Parser for FoundationModels transcript JSON (`--save-transcript` files and
//! `~/.fm/sessions/*.json`). Must be lenient: unknown fields and roles are kept
//! as best as possible, never fail on them.
//! OWNER: agent "cli".
//!
//! Shapes seen in files written by fm 27.0.1:
//! - text:       `{"type":"text","text":"..."}`
//! - image:      `{"type":"image","image":"data:image/jpeg;base64,..."}`
//! - attachment: `{"type":"attachment","attachment":{"type":"image","label":"image_0","data":"data:..."}}`
//!   (images are stored like this when a built-in tool is on)
//! - structure:  `{"type":"structure","structure":{"source":"Person","content":{...}}}`
//! - tool calls: a `response` entry with `toolCalls: [{name, id, arguments}]` and no contents
//! - tool output: a `tool` entry with `toolName` and text contents

use serde::Serialize;
use serde_json::Value;

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
    let root: Value =
        serde_json::from_slice(bytes).map_err(|e| format!("This file is not valid JSON ({e})."))?;
    let entries = find_entries(&root).ok_or_else(|| "This file does not look like an fm transcript.".to_string())?;

    let mut parsed = ParsedTranscript {
        model_name: root.get("modelName").and_then(Value::as_str).map(String::from),
        ..Default::default()
    };
    let mut instructions: Vec<String> = Vec::new();

    for entry in entries {
        let role = entry.get("role").and_then(Value::as_str).unwrap_or("unknown").to_string();
        let (text, images) = read_contents(entry);

        if role == "instructions" {
            if !text.trim().is_empty() {
                instructions.push(text);
            }
            continue;
        }
        if role == "response" && parsed.system_version.is_none() {
            parsed.system_version = entry
                .pointer("/metadata/systemVersion")
                .and_then(Value::as_str)
                .map(String::from);
        }
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(crate::util::new_id);
        parsed.messages.push(TranscriptMessage { id, role, text, images });
    }

    if !instructions.is_empty() {
        parsed.instructions = Some(instructions.join("\n\n"));
    }
    Ok(parsed)
}

/// Entries live at `transcript.transcript.entries` (fm 27); older or other
/// writers may use `transcript.entries` or `entries`.
fn find_entries(root: &Value) -> Option<&Vec<Value>> {
    ["/transcript/transcript/entries", "/transcript/entries", "/entries"]
        .iter()
        .find_map(|p| root.pointer(p).and_then(Value::as_array))
}

/// Text (parts joined by a blank line) and images of one entry.
fn read_contents(entry: &Value) -> (String, Vec<String>) {
    let mut parts: Vec<String> = Vec::new();
    let mut images: Vec<String> = Vec::new();

    if let Some(contents) = entry.get("contents").and_then(Value::as_array) {
        for content in contents {
            read_content(content, &mut parts, &mut images);
        }
    } else if let Some(text) = entry.get("text").and_then(Value::as_str) {
        parts.push(text.to_string());
    }

    // A response that only calls tools has `toolCalls` and no contents.
    if let Some(calls) = entry.get("toolCalls").and_then(Value::as_array) {
        for call in calls {
            let name = call.get("name").and_then(Value::as_str).unwrap_or("tool");
            let args = match call.get("arguments") {
                Some(Value::String(s)) => s.clone(),
                Some(v) => v.to_string(),
                None => String::new(),
            };
            parts.push(format!("Tool call: {name} {args}").trim_end().to_string());
        }
    }

    let text = parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join("\n\n");
    (text, images)
}

fn read_content(content: &Value, parts: &mut Vec<String>, images: &mut Vec<String>) {
    let kind = content.get("type").and_then(Value::as_str).unwrap_or("");
    match kind {
        "text" => {
            if let Some(text) = content.get("text").and_then(Value::as_str) {
                parts.push(text.to_string());
            }
        }
        "image" => {
            if let Some(url) = content.get("image").and_then(image_url) {
                images.push(url);
            }
        }
        "attachment" => {
            let attachment = content.get("attachment").unwrap_or(&Value::Null);
            let attachment_kind = attachment.get("type").and_then(Value::as_str).unwrap_or("image");
            match image_url(attachment) {
                Some(url) if attachment_kind == "image" || url.starts_with("data:image/") => images.push(url),
                _ => parts.push(pretty(attachment)),
            }
        }
        _ => {
            if let Some(text) = content.get("text").and_then(Value::as_str) {
                parts.push(text.to_string());
            } else if let Some(inner) = content.pointer("/structure/content") {
                parts.push(pretty(inner));
            } else if let Some(inner) = content.get("structure") {
                parts.push(pretty(inner));
            } else {
                parts.push(pretty(content));
            }
        }
    }
}

/// A data URL from a string, or from an object with a `data` or `url` field.
fn image_url(value: &Value) -> Option<String> {
    match value {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Object(map) => ["data", "url", "image"]
            .iter()
            .find_map(|k| map.get(*k).and_then(Value::as_str))
            .filter(|s| !s.is_empty())
            .map(String::from),
        _ => None,
    }
}

fn pretty(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_default(),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Shaped like a real fm 27 file. Placeholder text only.
    pub(crate) const FIXTURE: &str = r#"{
      "modelName": "system",
      "transcript": {
        "type": "FoundationModels.Transcript",
        "version": "1.1",
        "transcript": {
          "entries": [
            {"id": "E1", "role": "instructions",
             "contents": [{"id": "C1", "type": "text", "text": "Be brief."}]},
            {"id": "E2", "role": "user", "options": {}, "contextOptions": {},
             "contents": [{"id": "C2", "type": "text", "text": "Hello there,\nfriend"},
                          {"id": "C3", "type": "image", "image": "data:image/jpeg;base64,AAAA"}]},
            {"id": "E3", "role": "response",
             "metadata": {"systemVersion": "Version 27.0.1 (Build 26A434)", "assetIDs": []},
             "assets": [],
             "contents": [{"id": "C4", "type": "text", "text": "Hi, Ada."}]},
            {"id": "E4", "role": "user",
             "contents": [{"id": "C5", "type": "attachment",
                           "attachment": {"label": "image_0", "type": "image", "data": "data:image/png;base64,BBBB"}},
                          {"id": "C6", "type": "text", "text": "Read this"}]},
            {"id": "E5", "role": "response",
             "toolCalls": [{"name": "getText", "id": "T1", "arguments": "{\"image\": {\"attachmentLabel\": \"image_0\"}}"}]},
            {"id": "E6", "role": "tool", "toolName": "getText", "toolCallID": "T1",
             "contents": [{"id": "C7", "type": "text", "text": "Placeholder text"}]},
            {"id": "E7", "role": "response",
             "contents": [{"id": "C8", "type": "structure",
                           "structure": {"source": "Person", "content": {"name": "Ada Lovelace", "age": 36}}}]},
            {"role": "someNewRole", "contents": [{"type": "mystery", "value": 1}]}
          ]
        }
      }
    }"#;

    #[test]
    fn parses_fm_transcript() {
        let t = parse(FIXTURE.as_bytes()).unwrap();
        assert_eq!(t.model_name.as_deref(), Some("system"));
        assert_eq!(t.instructions.as_deref(), Some("Be brief."));
        assert_eq!(t.system_version.as_deref(), Some("Version 27.0.1 (Build 26A434)"));
        assert_eq!(t.messages.len(), 7);

        let m = &t.messages;
        assert_eq!((m[0].id.as_str(), m[0].role.as_str()), ("E2", "user"));
        assert_eq!(m[0].text, "Hello there,\nfriend");
        assert_eq!(m[0].images, vec!["data:image/jpeg;base64,AAAA"]);
        assert_eq!((m[1].role.as_str(), m[1].text.as_str()), ("response", "Hi, Ada."));
        assert_eq!(m[2].images, vec!["data:image/png;base64,BBBB"]);
        assert_eq!(m[2].text, "Read this");
        assert!(m[3].text.starts_with("Tool call: getText {"), "{}", m[3].text);
        assert_eq!((m[4].role.as_str(), m[4].text.as_str()), ("tool", "Placeholder text"));
        let structured: Value = serde_json::from_str(&m[5].text).unwrap();
        assert_eq!(structured["name"], "Ada Lovelace");
        assert_eq!(m[6].role, "someNewRole");
        assert!(m[6].text.contains("\"value\": 1"));
        assert!(!m[6].id.is_empty());
    }

    #[test]
    fn accepts_other_layouts_and_rejects_non_transcripts() {
        let flat = r#"{"entries": [{"role": "user", "contents": [{"type": "text", "text": "Hi"}]}]}"#;
        let t = parse(flat.as_bytes()).unwrap();
        assert_eq!(t.messages[0].text, "Hi");
        assert!(t.model_name.is_none() && t.instructions.is_none());

        let mid = r#"{"transcript": {"entries": [{"role": "user",
            "contents": [{"type": "image", "image": {"data": "data:image/png;base64,CC"}}]}]}}"#;
        assert_eq!(parse(mid.as_bytes()).unwrap().messages[0].images, vec!["data:image/png;base64,CC"]);

        assert!(parse(b"not json").unwrap_err().contains("not valid JSON"));
        assert!(parse(br#"{"hello": 1}"#).unwrap_err().contains("does not look like"));
    }

    #[test]
    fn serializes_camel_case() {
        let t = parse(FIXTURE.as_bytes()).unwrap();
        let v = serde_json::to_value(&t).unwrap();
        assert!(v.get("modelName").is_some() && v.get("systemVersion").is_some());
    }
}
