//! Guided-JSON tool router and the agent loop behind `chat_send`.
//!
//! Why: `fm serve` (macOS 27.0.1) accepts `tools` but never returns
//! `tool_calls`; the model fakes results or prints the arguments as text, and
//! `tool_choice: "required"` gives HTTP 500. So the app routes tools itself:
//! every request with tools uses `response_format: json_schema` with one
//! `anyOf` branch per tool (`{"calculator": {"expression": "..."}}`) plus
//! `{"answer": {}}` ("I can answer now"). The answer is then a separate
//! plain-text streaming request, because answers inside guided JSON arrive
//! in one chunk at the end and lose their Markdown line breaks.
//! Tool results go back as assistant `tool_calls` + role `tool` messages,
//! which `fm serve` understands.

use super::chats::{self, NEW_CHAT_TITLE};
use super::fm_client::{FmError, FmErrorKind};
use super::tools::{self, CatalogTool, ToolKind, DEFAULT_RESULT_CHARS};
use super::{builtin, schema, AgentEvent, AgentStep, Chat, ChatMessage, Usage};
use crate::config::{AppConfig, Approval, SkillMode};
use crate::skills::Skill;
use crate::state::AppState;
use crate::util::{estimate_tokens, new_id, now_ms, truncate_chars};
use serde_json::{json, Value};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

pub type Emit<'a> = &'a (dyn Fn(AgentEvent) + Send + Sync);

/// Rough token cost of one image.
const IMAGE_TOKENS: u32 = 600;
/// Per-message overhead in the prompt.
const MESSAGE_TOKENS: u32 = 4;
const STOPPED: &str = "Stopped";
pub const DENIED: &str = "The user did not allow this tool call.";
/// Sent as a user message when the model answers a tool result with nothing.
const NUDGE: &str = "Use the tool result above to answer my question.";
/// When to use tools (generic: the tool list changes).
const TOOL_POLICY: &str = "Use a tool when the answer needs exact math, the current date or time, data from this Mac, or a service the tools offer. Never do arithmetic in your head. Do not use other tools for writing, chatting or general knowledge.";
/// How on-demand skills are offered to the model.
const SKILL_POLICY: &str = "When the request is about what a skill describes, load that skill first with {\"use_skill\": {\"name\": \"<skill name>\"}}. Never load a skill for other requests.";
/// Tool result for `use_skill`: the skill text itself goes into the system
/// instructions, where the small model follows it far more reliably.
const SKILL_LOADED: &str = "is loaded. Its instructions are now part of your instructions. Follow them in your answer.";
/// At most this many skills are loaded up front for one message.
const MAX_AUTO_SKILLS: usize = 2;
const TOOL_PROTOCOL: &str =
    "To use a tool reply with {\"tool_name\": {arguments}}. When you can answer without a tool, or you have what you need, reply with {\"answer\": {}}.";

// ---------- incremental answer decoder ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecState {
    /// Not sure yet whether the reply starts with `{"answer": "`.
    Detect,
    /// Inside the answer string.
    Answer,
    /// The answer string is closed.
    Closed,
    /// Something else (a tool call, or plain text in plain mode).
    Other,
}

enum Prefix {
    Partial,
    Match(usize),
    NoMatch,
}

/// Streams the `answer` string of a guided-JSON reply while it arrives.
/// In plain mode, text that is not `{"answer": "...` passes through as is.
pub struct AnswerDecoder {
    plain: bool,
    raw: String,
    state: DecState,
    pos: usize,
    text: String,
}

impl AnswerDecoder {
    pub fn new(plain: bool) -> Self {
        Self { plain, raw: String::new(), state: DecState::Detect, pos: 0, text: String::new() }
    }

    /// Adds a chunk; returns the new text to show (never half an escape).
    pub fn push(&mut self, chunk: &str) -> String {
        self.raw.push_str(chunk);
        match self.state {
            DecState::Detect => match detect_prefix(&self.raw) {
                Prefix::Partial => String::new(),
                Prefix::Match(pos) => {
                    self.state = DecState::Answer;
                    self.pos = pos;
                    self.decode()
                }
                Prefix::NoMatch => {
                    self.state = DecState::Other;
                    if self.plain {
                        self.text.push_str(&self.raw);
                        self.raw.clone()
                    } else {
                        String::new()
                    }
                }
            },
            DecState::Answer => self.decode(),
            DecState::Closed => String::new(),
            DecState::Other => {
                if self.plain {
                    self.text.push_str(chunk);
                    chunk.to_string()
                } else {
                    String::new()
                }
            }
        }
    }

    /// End of stream: returns text still held back (plain mode only).
    pub fn finish(&mut self) -> String {
        if self.state == DecState::Detect && self.plain {
            self.state = DecState::Other;
            self.text.push_str(&self.raw);
            return self.raw.clone();
        }
        String::new()
    }

    pub fn is_answer(&self) -> bool {
        matches!(self.state, DecState::Answer | DecState::Closed)
    }

    /// The decoded answer (or the passed-through plain text).
    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn raw(&self) -> &str {
        &self.raw
    }

    fn decode(&mut self) -> String {
        const BAD: char = '\u{FFFD}';
        let mut out = String::new();
        loop {
            let rest = &self.raw[self.pos..];
            let bytes = rest.as_bytes();
            let Some(c) = rest.chars().next() else { break };
            match c {
                '"' => {
                    self.state = DecState::Closed;
                    self.pos += 1;
                    break;
                }
                '\\' => {
                    let Some(e) = rest[1..].chars().next() else { break };
                    if e != 'u' {
                        out.push(match e {
                            'n' => '\n',
                            't' => '\t',
                            'r' => '\r',
                            'b' => '\u{8}',
                            'f' => '\u{c}',
                            other => other,
                        });
                        self.pos += 1 + e.len_utf8();
                        continue;
                    }
                    if bytes.len() < 6 {
                        break;
                    }
                    let Some(unit) = parse_hex4(&bytes[2..6]) else {
                        out.push(BAD);
                        self.pos += 2;
                        continue;
                    };
                    if (0xD800..0xDC00).contains(&unit) {
                        // A high surrogate needs the low one that follows.
                        let has_slash = bytes.get(6).map(|b| *b == b'\\');
                        let has_u = bytes.get(7).map(|b| *b == b'u');
                        if has_slash == Some(false) || has_u == Some(false) {
                            out.push(BAD);
                            self.pos += 6;
                            continue;
                        }
                        if bytes.len() < 12 {
                            break;
                        }
                        match parse_hex4(&bytes[8..12]) {
                            Some(low) if (0xDC00..0xE000).contains(&low) => {
                                let cp = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00);
                                out.push(char::from_u32(cp).unwrap_or(BAD));
                                self.pos += 12;
                            }
                            _ => {
                                out.push(BAD);
                                self.pos += 6;
                            }
                        }
                        continue;
                    }
                    out.push(char::from_u32(unit).unwrap_or(BAD));
                    self.pos += 6;
                }
                other => {
                    out.push(other);
                    self.pos += other.len_utf8();
                }
            }
        }
        self.text.push_str(&out);
        out
    }
}

fn parse_hex4(bytes: &[u8]) -> Option<u32> {
    if bytes.len() != 4 || !bytes.iter().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u32::from_str_radix(std::str::from_utf8(bytes).ok()?, 16).ok()
}

/// Checks for `{ "answer" : "` with any whitespace between the tokens.
fn detect_prefix(raw: &str) -> Prefix {
    let b = raw.as_bytes();
    let mut i = 0;
    for token in [&b"{"[..], b"\"answer\"", b":", b"\""] {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        for &t in token {
            if i >= b.len() {
                return Prefix::Partial;
            }
            if b[i] != t {
                return Prefix::NoMatch;
            }
            i += 1;
        }
    }
    Prefix::Match(i)
}

/// What the model chose in router mode.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Answer(String),
    Tool(String, Value),
    Invalid,
}

/// `Action::Answer("")` means "write the answer now" (plain text request).
pub fn parse_action(raw: &str) -> Action {
    let mut stream = serde_json::Deserializer::from_str(raw.trim()).into_iter::<Value>();
    let Some(Ok(Value::Object(obj))) = stream.next() else { return Action::Invalid };
    match obj.get("answer") {
        Some(Value::String(answer)) => return Action::Answer(answer.clone()),
        Some(_) => return Action::Answer(String::new()),
        None => {}
    }
    let mut entries = obj.into_iter();
    let (Some((name, args)), None) = (entries.next(), entries.next()) else { return Action::Invalid };
    let args = match args {
        Value::Object(_) => args,
        _ => json!({}),
    };
    Action::Tool(name, args)
}

// ---------- prompt building ----------

fn base_instructions(chat_instructions: &str, always: &[&Skill]) -> String {
    let mut text = chat_instructions.trim().to_string();
    for skill in always {
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str(&format!("## Skill: {}\n{}", skill.name, skill.body.trim()));
    }
    text
}

/// The tool part of the router instructions. On-demand skills come first, in
/// their own block: listed after many tools, the model ignored them.
pub fn tool_guide(tools: &[CatalogTool], on_demand: &[&Skill]) -> String {
    if tools.is_empty() {
        return String::new();
    }
    let mut text = String::new();
    if !on_demand.is_empty() {
        text.push_str("Skills (extra instructions for some kinds of requests):\n");
        for s in on_demand {
            text.push_str(&format!("- {}: {}\n", s.name, schema::clean_description_len(&s.description, 160)));
        }
        text.push_str(SKILL_POLICY);
        text.push_str("\n\n");
    }
    text.push_str("You can use these tools:\n");
    for t in tools {
        text.push_str(&t.guide_line());
        text.push('\n');
    }
    text.push('\n');
    text.push_str(TOOL_POLICY);
    text.push(' ');
    text.push_str(TOOL_PROTOCOL);
    text
}

// ---------- on-demand skill matching ----------

/// Words that say nothing about what a skill is for.
const FILLER: &[&str] = &[
    "about",
    "also",
    "and",
    "any",
    "anything",
    "are",
    "ask",
    "asked",
    "asking",
    "asks",
    "can",
    "could",
    "does",
    "for",
    "from",
    "get",
    "give",
    "has",
    "have",
    "help",
    "helps",
    "how",
    "into",
    "its",
    "like",
    "may",
    "must",
    "need",
    "needs",
    "not",
    "only",
    "or",
    "request",
    "requests",
    "said",
    "say",
    "says",
    "should",
    "skill",
    "skills",
    "some",
    "something",
    "task",
    "tasks",
    "tell",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "use",
    "used",
    "user",
    "users",
    "uses",
    "using",
    "want",
    "wants",
    "was",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "will",
    "with",
    "would",
    "you",
    "your",
];

/// A rough English stem, so "fruits" matches "fruit" and "tomatoes" matches "tomato".
fn stem(word: &str) -> String {
    let w = word;
    let n = w.len();
    if n > 5 && w.ends_with("ing") {
        return w[..n - 3].to_string();
    }
    if n > 4 && w.ends_with("ies") {
        return format!("{}y", &w[..n - 3]);
    }
    if n > 4 && (w.ends_with("oes") || w.ends_with("xes") || w.ends_with("shes") || w.ends_with("ches")) {
        return w[..n - 2].to_string();
    }
    if n > 3 && w.ends_with('s') && !w.ends_with("ss") {
        return w[..n - 1].to_string();
    }
    if n > 4 && w.ends_with("ed") {
        return w[..n - 2].to_string();
    }
    w.to_string()
}

/// Topic words of a text: lowercase ASCII words of 3+ letters (or numbers),
/// without filler words, stemmed.
fn topic_words(text: &str) -> std::collections::BTreeSet<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .map(|w| w.to_ascii_lowercase())
        .filter(|w| {
            (w.len() >= 3 || (!w.is_empty() && w.chars().all(|c| c.is_ascii_digit()))) && !FILLER.contains(&w.as_str())
        })
        .map(|w| stem(&w))
        .collect()
}

/// Lowercase words joined by single spaces (for phrase matching).
fn normalize(text: &str) -> String {
    text.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Phrases in quotes inside a skill description, like `"explain like I am 10"`.
fn quoted_phrases(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (open, close) in [('"', '"'), ('“', '”')] {
        let mut rest = text;
        while let Some(start) = rest.find(open) {
            let after = &rest[start + open.len_utf8()..];
            let Some(end) = after.find(close) else { break };
            let phrase = normalize(&after[..end]);
            if phrase.contains(' ') {
                out.push(phrase);
            }
            rest = &after[end + close.len_utf8()..];
        }
    }
    out
}

/// How well `text` (the user's message) matches a skill; 0 means no match.
/// A match needs the skill name or a quoted phrase of its description, or
/// enough topic words of the description (one when it has at most two,
/// else two). Precision matters more than recall here: the model can still
/// load a skill itself when the words differ.
pub fn skill_match_score(text: &str, skill: &Skill) -> usize {
    let message = normalize(text);
    let name = normalize(&skill.name);
    let padded = format!(" {message} ");
    if (name.contains(' ') && padded.contains(&format!(" {name} "))) || padded.contains(&format!(" {} ", skill.name)) {
        return 100;
    }
    if quoted_phrases(&skill.description).iter().any(|p| padded.contains(&format!(" {p} "))) {
        return 50;
    }
    let topics = topic_words(&skill.description);
    if topics.is_empty() {
        return 0;
    }
    let overlap = topic_words(text).intersection(&topics).count();
    let needed = if topics.len() <= 2 { 1 } else { 2 };
    if overlap >= needed {
        overlap
    } else {
        0
    }
}

/// On-demand skills that clearly match the message, best first.
pub fn matching_skills<'a>(text: &str, on_demand: &[&'a Skill]) -> Vec<&'a Skill> {
    let mut scored: Vec<(usize, &Skill)> =
        on_demand.iter().map(|s| (skill_match_score(text, s), *s)).filter(|(score, _)| *score > 0).collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    scored.into_iter().map(|(_, s)| s).collect()
}

fn join_system(base: &str, extra: &str) -> String {
    match (base.trim().is_empty(), extra.trim().is_empty()) {
        (true, _) => extra.trim().to_string(),
        (_, true) => base.trim().to_string(),
        _ => format!("{}\n\n{}", base.trim(), extra.trim()),
    }
}

fn user_value(m: &ChatMessage, with_images: bool) -> Value {
    let images: Vec<&String> = if with_images { m.images.iter().collect() } else { Vec::new() };
    if images.is_empty() {
        let text =
            if m.text.trim().is_empty() && !m.images.is_empty() { "(an image)".to_string() } else { m.text.clone() };
        return json!({"role": "user", "content": text});
    }
    let mut parts = Vec::new();
    if !m.text.trim().is_empty() {
        parts.push(json!({"type": "text", "text": m.text}));
    }
    for url in images {
        parts.push(json!({"type": "image_url", "image_url": {"url": url}}));
    }
    json!({"role": "user", "content": parts})
}

/// Token estimate of a request message.
pub fn message_tokens(m: &Value) -> u32 {
    let content = match m.get("content") {
        Some(Value::String(s)) => estimate_tokens(s),
        Some(Value::Array(parts)) => parts
            .iter()
            .map(|p| match p.get("type").and_then(Value::as_str) {
                Some("image_url") => IMAGE_TOKENS,
                _ => estimate_tokens(p.get("text").and_then(Value::as_str).unwrap_or("")),
            })
            .sum(),
        _ => 0,
    };
    let calls = m.get("tool_calls").map(|c| estimate_tokens(&c.to_string())).unwrap_or(0);
    content + calls + MESSAGE_TOKENS
}

fn messages_tokens(ms: &[Value]) -> u32 {
    ms.iter().map(message_tokens).sum()
}

/// Earlier messages as plain user/assistant text, plus the current user
/// message. Images are kept only for the last two user turns. Failed turns
/// (assistant without text) are left out together with their question.
pub fn build_history(messages: &[ChatMessage]) -> (Vec<Value>, Value) {
    let Some((current, prev)) = messages.split_last() else {
        return (Vec::new(), json!({"role": "user", "content": ""}));
    };
    let last_prev_user = prev.iter().rposition(|m| m.role == "user");
    let mut out = Vec::new();
    let mut i = 0;
    while i < prev.len() {
        let m = &prev[i];
        if m.role == "user" {
            let failed = prev.get(i + 1).map(|n| n.role == "assistant" && n.text.trim().is_empty()).unwrap_or(false);
            if failed {
                i += 2;
                continue;
            }
            out.push(user_value(m, Some(i) == last_prev_user));
        } else if m.role == "assistant" && !m.text.trim().is_empty() {
            out.push(json!({"role": "assistant", "content": m.text}));
        }
        i += 1;
    }
    (out, user_value(current, true))
}

/// Drops the oldest messages until the history fits in `budget` tokens.
/// Never starts the history with an assistant message.
pub fn trim_history(history: &mut Vec<Value>, budget: u32) {
    while !history.is_empty() && messages_tokens(history) > budget {
        history.remove(0);
        drop_leading_assistant(history);
    }
}

fn drop_leading_assistant(history: &mut Vec<Value>) {
    while history.first().and_then(|m| m.get("role")).and_then(Value::as_str) == Some("assistant") {
        history.remove(0);
    }
}

/// Context budget for the prompt: ~75 % of the window minus room for the answer.
pub fn prompt_budget(context_size: u32) -> u32 {
    let ctx = context_size.max(1024);
    (ctx as f64 * 0.75) as u32 - ctx / 8
}

// ---------- the turn ----------

#[derive(Default)]
struct Turn {
    text: String,
    steps: Vec<AgentStep>,
    skills_used: Vec<String>,
    /// Real usage summed over the turn's requests: the largest prompt and
    /// all completions. `None` when the server sent no usage.
    usage: Option<Usage>,
    /// Largest `total_tokens` of one request: how full the context got.
    max_total: u32,
    prompt_estimate: u32,
}

impl Turn {
    fn add_usage(&mut self, u: &Usage) {
        let mut acc = self.usage.clone().unwrap_or_default();
        acc.prompt_tokens = acc.prompt_tokens.max(u.prompt_tokens);
        acc.completion_tokens += u.completion_tokens;
        acc.total_tokens = acc.prompt_tokens + acc.completion_tokens;
        self.usage = Some(acc);
        self.max_total = self.max_total.max(u.total_tokens);
    }

    fn upsert(&mut self, step: &AgentStep, emit: Emit<'_>) {
        match self.steps.iter_mut().find(|s| s.id == step.id) {
            Some(existing) => *existing = step.clone(),
            None => self.steps.push(step.clone()),
        }
        emit(AgentEvent::Step { step: step.clone() });
    }
}

struct RunGuard<'a> {
    state: &'a AppState,
    chat_id: String,
}

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.state.engine.end_run(&self.chat_id);
    }
}

/// One agent turn: saves the user message, runs the model with tools,
/// streams events, saves the assistant message (also on errors) and
/// returns it. Errors during the turn end up in `message.error`.
pub async fn run_turn(
    state: &AppState,
    app: Option<&AppHandle>,
    chat_id: &str,
    text: String,
    images: Vec<String>,
    emit: Emit<'_>,
) -> Result<ChatMessage, String> {
    let text = text.trim().to_string();
    if text.is_empty() && images.is_empty() {
        return Err("Type a message first.".into());
    }
    let cancel = state.engine.begin_run(chat_id)?;
    let _guard = RunGuard { state, chat_id: chat_id.to_string() };
    let started = Instant::now();
    let cfg = state.config();
    let dir = &state.engine.chats_dir;

    let mut chat = chats::load(dir, chat_id)?;
    let user =
        ChatMessage { id: new_id(), role: "user".into(), text, images, created_at: now_ms(), ..Default::default() };
    if chat.title == NEW_CHAT_TITLE && !chat.messages.iter().any(|m| m.role == "user") {
        chat.title = if user.text.is_empty() { "Image".into() } else { chats::title_from(&user.text) };
    }
    chat.messages.push(user.clone());
    chat.updated_at = now_ms();
    chats::save(dir, &chat)?;
    emit(AgentEvent::UserMessage { message: user });

    let message_id = new_id();
    emit(AgentEvent::AssistantStart { message_id: message_id.clone() });
    emit(AgentEvent::Status { text: "Thinking…".into() });

    let mut turn = Turn::default();
    let result = agent_loop(state, app, &cfg, &chat, &mut turn, &cancel, emit).await;
    let error = result.err();

    let usage = turn.usage.clone().unwrap_or_else(|| {
        let completion = estimate_tokens(&turn.text);
        Usage {
            prompt_tokens: turn.prompt_estimate,
            completion_tokens: completion,
            total_tokens: turn.prompt_estimate + completion,
        }
    });
    let message = ChatMessage {
        id: message_id,
        role: "assistant".into(),
        text: turn.text,
        images: Vec::new(),
        steps: turn.steps,
        skills_used: turn.skills_used,
        created_at: now_ms(),
        usage: Some(usage.clone()),
        duration_ms: Some(started.elapsed().as_millis() as u64),
        error,
    };

    // Reload so a rename made during the turn is kept. A chat deleted
    // during the turn stays deleted.
    if let Ok(mut latest) = chats::load(dir, chat_id) {
        latest.messages.push(message.clone());
        latest.updated_at = now_ms();
        if let Err(err) = chats::save(dir, &latest) {
            emit(AgentEvent::Error { message: err });
        }
    }
    let used_tokens = if turn.max_total > 0 { turn.max_total } else { usage.total_tokens };
    emit(AgentEvent::Context { used_tokens, context_size: cfg.context_size });
    if let Some(err) = &message.error {
        emit(AgentEvent::Error { message: err.clone() });
    }
    emit(AgentEvent::Done { message: message.clone() });
    Ok(message)
}

enum StreamFail {
    Cancelled(String),
    Fm { error: FmError, emitted: bool, partial: String },
}

struct Reply {
    answer: Option<String>,
    raw: String,
    usage: Option<Usage>,
}

fn parse_usage(v: &Value) -> Option<Usage> {
    let u = v.get("usage")?;
    if !u.is_object() {
        return None;
    }
    let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0) as u32;
    let (prompt, completion) = (n("prompt_tokens"), n("completion_tokens"));
    let total = match n("total_tokens") {
        0 => prompt + completion,
        t => t,
    };
    Some(Usage { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total })
}

async fn stream_reply(
    state: &AppState,
    body: &Value,
    plain: bool,
    cancel: &CancellationToken,
    emit: Emit<'_>,
) -> Result<Reply, StreamFail> {
    let mut stream = tokio::select! {
        r = state.engine.server.post_stream("/v1/chat/completions", body) => {
            r.map_err(|error| StreamFail::Fm { error, emitted: false, partial: String::new() })?
        }
        _ = cancel.cancelled() => {
            state.engine.server.abort_generation().await;
            return Err(StreamFail::Cancelled(String::new()));
        }
    };
    let mut decoder = AnswerDecoder::new(plain);
    let mut usage = None;
    let mut emitted = false;
    loop {
        let event = tokio::select! {
            ev = stream.next_event() => ev,
            _ = cancel.cancelled() => {
                drop(stream);
                state.engine.server.abort_generation().await;
                return Err(StreamFail::Cancelled(decoder.text().to_string()));
            }
        };
        let event = match event {
            None => break,
            Some(Err(error)) => {
                if error.kind == FmErrorKind::Transport {
                    // A stalled generation keeps the shared model busy.
                    drop(stream);
                    state.engine.server.abort_generation().await;
                }
                return Err(StreamFail::Fm { error, emitted, partial: decoder.text().to_string() });
            }
            Some(Ok(ev)) => ev,
        };
        let Ok(value) = serde_json::from_str::<Value>(&event.data) else { continue };
        if value.get("error").is_some() {
            let error = FmError::from_reply(500, &value);
            return Err(StreamFail::Fm { error, emitted, partial: decoder.text().to_string() });
        }
        if let Some(u) = parse_usage(&value) {
            usage = Some(u);
        }
        if let Some(content) = value.pointer("/choices/0/delta/content").and_then(Value::as_str) {
            let out = decoder.push(content);
            if !out.is_empty() {
                emitted = true;
                emit(AgentEvent::Delta { text: out });
            }
        }
    }
    let rest = decoder.finish();
    if !rest.is_empty() {
        emit(AgentEvent::Delta { text: rest });
    }
    let answer = if plain || decoder.is_answer() { Some(decoder.text().to_string()) } else { None };
    Ok(Reply { answer, raw: decoder.raw().to_string(), usage })
}

fn friendly_error(err: &FmError, cfg: &AppConfig) -> String {
    match err.kind {
        FmErrorKind::ContextOverflow => format!(
            "This chat is too long for the model's context window ({} tokens). Start a new chat, or turn off some tools or skills to save space.",
            cfg.context_size
        ),
        FmErrorKind::Guardrails => "The model's safety guardrails blocked this request. Try rewording your message.".into(),
        _ => err.message.clone(),
    }
}

#[allow(clippy::too_many_arguments)]
async fn agent_loop(
    state: &AppState,
    app: Option<&AppHandle>,
    cfg: &AppConfig,
    chat: &Chat,
    turn: &mut Turn,
    cancel: &CancellationToken,
    emit: Emit<'_>,
) -> Result<(), String> {
    tokio::select! {
        r = state.engine.server.ensure(&cfg.fm_path) => { r?; }
        _ = cancel.cancelled() => return Err(STOPPED.into()),
    }

    // Tools and skills.
    let tools: Vec<CatalogTool> = if cfg.chat_defaults.tools_enabled {
        tools::catalog(state, cfg).await.into_iter().filter(|t| t.info.enabled).collect()
    } else {
        Vec::new()
    };
    let skills = state.skills.list();
    let always: Vec<&Skill> = skills.iter().filter(|s| cfg.skill_mode(&s.name) == SkillMode::Always).collect();
    turn.skills_used = always.iter().map(|s| s.name.clone()).collect();
    let has_use_skill = tools.iter().any(|t| matches!(t.kind, ToolKind::UseSkill { .. }));
    let on_demand: Vec<&Skill> = if has_use_skill {
        skills.iter().filter(|s| cfg.skill_mode(&s.name) == SkillMode::OnDemand).collect()
    } else {
        Vec::new()
    };
    // `use_skill` goes first in the guide and in the schema: the model reads
    // the first choices most carefully.
    let mut tools = tools;
    tools.sort_by_key(|t| !matches!(t.kind, ToolKind::UseSkill { .. }));
    let router = if tools.is_empty() {
        None
    } else {
        let entries: Vec<(String, Value, String)> = tools
            .iter()
            .map(|t| (t.info.name.clone(), t.info.input_schema.clone(), t.info.description.clone()))
            .collect();
        Some(
            json!({"type": "json_schema", "json_schema": {"name": "Action", "schema": schema::router_schema(&entries)}}),
        )
    };

    // On-demand skills that clearly match the message are loaded right away
    // (shown as a normal use_skill step); the model can load others itself.
    // Loaded skills become part of the system instructions.
    let mut loaded: Vec<&Skill> = Vec::new();
    let user_text = chat.messages.last().map(|m| m.text.as_str()).unwrap_or("");
    if let Some(use_skill) = tools.iter().find(|t| matches!(t.kind, ToolKind::UseSkill { .. })) {
        for skill in matching_skills(user_text, &on_demand).into_iter().take(MAX_AUTO_SKILLS) {
            let args = json!({"name": skill.name});
            let content = run_step(state, app, cfg, use_skill, args, turn, cancel, emit, DEFAULT_RESULT_CHARS).await?;
            if !content.starts_with("Error:") {
                loaded.push(skill);
            }
        }
    }
    let instructions = |loaded: &[&Skill]| {
        let in_system: Vec<&Skill> = always.iter().chain(loaded.iter()).copied().collect();
        let pending: Vec<&Skill> =
            on_demand.iter().filter(|s| !loaded.iter().any(|l| l.name == s.name)).copied().collect();
        let base = base_instructions(&chat.instructions, &in_system);
        let router_system = join_system(&base, &tool_guide(&tools, &pending));
        (base, router_system)
    };

    // History, trimmed to the budget.
    let budget = prompt_budget(cfg.context_size);
    let (mut history, current) = build_history(&chat.messages);
    let fixed = estimate_tokens(&instructions(&loaded).1) + MESSAGE_TOKENS + message_tokens(&current);
    trim_history(&mut history, budget.saturating_sub(fixed));

    let max_steps = cfg.chat_defaults.max_tool_steps;
    let mut force_plain = router.is_none() || max_steps == 0;
    let mut exchange: Vec<Value> = Vec::new();
    let mut steps_done: u32 = 0;
    let mut overflow_retries = 0;
    let mut last_call: Option<(String, Value)> = None;
    let mut nudged = false;

    loop {
        let use_router = !force_plain;
        let (base, router_system) = instructions(&loaded);
        let system = if use_router {
            router_system
        } else if steps_done > 0 {
            join_system(&base, "Answer the user now in Markdown. Use the tool results above.")
        } else {
            base.clone()
        };
        let mut messages = Vec::with_capacity(history.len() + exchange.len() + 2);
        if !system.is_empty() {
            messages.push(json!({"role": "system", "content": system}));
        }
        messages.extend(history.iter().cloned());
        messages.push(current.clone());
        messages.extend(exchange.iter().cloned());
        turn.prompt_estimate = messages_tokens(&messages);

        let mut body = json!({
            "model": "system",
            "stream": true,
            "stream_options": {"include_usage": true},
            "messages": messages,
        });
        if use_router {
            // Greedy decoding makes the router pick tools far more reliably.
            body["temperature"] = json!(0);
            body["response_format"] = router.clone().unwrap_or(Value::Null);
        } else if let Some(t) = cfg.chat_defaults.temperature {
            body["temperature"] = json!(t);
        }
        if use_router && steps_done > 0 {
            emit(AgentEvent::Status { text: "Thinking…".into() });
        } else if !use_router && router.is_some() {
            emit(AgentEvent::Status { text: "Writing the answer…".into() });
        }

        // Debug builds only: write the last request body to a file.
        if cfg!(debug_assertions) {
            if let Ok(path) = std::env::var("FMGUI_DUMP_REQUEST") {
                let _ = std::fs::write(path, serde_json::to_vec_pretty(&body).unwrap_or_default());
            }
        }
        let reply = match stream_reply(state, &body, !use_router, cancel, emit).await {
            Ok(reply) => reply,
            Err(StreamFail::Cancelled(partial)) => {
                turn.text = partial;
                return Err(STOPPED.into());
            }
            Err(StreamFail::Fm { error, emitted, partial }) => {
                if error.kind == FmErrorKind::ContextOverflow && overflow_retries < 2 && !emitted {
                    overflow_retries += 1;
                    if !history.is_empty() {
                        let drop = history.len().div_ceil(2).max(2).min(history.len());
                        history.drain(..drop);
                        drop_leading_assistant(&mut history);
                    } else if exchange.iter().any(|m| m["role"] == "tool") {
                        for m in exchange.iter_mut().filter(|m| m["role"] == "tool") {
                            let short = truncate_chars(m["content"].as_str().unwrap_or(""), 600);
                            m["content"] = json!(short);
                        }
                    } else {
                        return Err(friendly_error(&error, cfg));
                    }
                    emit(AgentEvent::Status { text: "The chat is long. Leaving out older messages…".into() });
                    continue;
                }
                turn.text = partial;
                return Err(friendly_error(&error, cfg));
            }
        };
        if let Some(u) = &reply.usage {
            turn.add_usage(u);
        }
        let empty = reply.answer.as_deref().map(|a| a.trim().is_empty()).unwrap_or(reply.raw.trim().is_empty());
        if empty {
            // fm serve can return an empty reply when the last message is
            // not from the user (a tool result). Ask once more, as the user.
            if !nudged && !exchange.is_empty() {
                nudged = true;
                exchange.push(json!({"role": "user", "content": NUDGE}));
                continue;
            }
            if use_router {
                force_plain = true;
                continue;
            }
            return Err("The model returned an empty answer. Try again.".into());
        }
        if let Some(answer) = reply.answer {
            turn.text = answer;
            return Ok(());
        }

        // Router reply that is not a streamed answer: a tool call (or a
        // complete answer object the decoder did not see).
        let (name, args) = match parse_action(&reply.raw) {
            Action::Answer(text) if !text.trim().is_empty() => {
                emit(AgentEvent::Delta { text: text.clone() });
                turn.text = text;
                return Ok(());
            }
            Action::Answer(_) => {
                // The model is ready: stream the answer as plain text.
                force_plain = true;
                continue;
            }
            Action::Tool(name, args) => (name, args),
            Action::Invalid => {
                force_plain = true;
                continue;
            }
        };
        let Some(tool) = tools.iter().find(|t| t.info.name == name) else {
            force_plain = true;
            continue;
        };
        if last_call.as_ref() == Some(&(name.clone(), args.clone())) {
            // The model repeats itself: make it answer with what it has.
            force_plain = true;
            continue;
        }
        last_call = Some((name.clone(), args.clone()));

        let used = messages_tokens(&body["messages"].as_array().cloned().unwrap_or_default());
        let room = budget.saturating_sub(used) as usize;
        let max_chars = (room * 4 / 2).clamp(400, DEFAULT_RESULT_CHARS);
        let mut content = run_step(state, app, cfg, tool, args.clone(), turn, cancel, emit, max_chars).await?;
        if matches!(tool.kind, ToolKind::UseSkill { .. }) && !content.starts_with("Error:") {
            let wanted = args.get("name").and_then(Value::as_str).unwrap_or("").trim();
            if let Some(skill) = on_demand.iter().find(|s| s.name == wanted) {
                if !loaded.iter().any(|l| l.name == skill.name) {
                    loaded.push(skill);
                }
                content = format!("Skill \"{}\" {SKILL_LOADED}", skill.name);
            }
        }

        steps_done += 1;
        let call_id = format!("call_{steps_done}");
        exchange.push(json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [{"id": call_id, "type": "function", "function": {"name": name, "arguments": args.to_string()}}],
        }));
        exchange.push(json!({"role": "tool", "tool_call_id": call_id, "content": content}));
        if steps_done >= max_steps {
            force_plain = true;
        }
    }
}

/// Asks for approval when needed, runs the tool, and returns the text for
/// the `tool` message. `Err` only when the user pressed Stop.
#[allow(clippy::too_many_arguments)]
async fn run_step(
    state: &AppState,
    app: Option<&AppHandle>,
    cfg: &AppConfig,
    tool: &CatalogTool,
    args: Value,
    turn: &mut Turn,
    cancel: &CancellationToken,
    emit: Emit<'_>,
    max_chars: usize,
) -> Result<String, String> {
    let mut step = AgentStep {
        id: new_id(),
        tool_id: tool.info.id.clone(),
        tool_name: tool.info.name.clone(),
        title: tool.info.title.clone(),
        source: tool.info.source.clone(),
        arguments: args.clone(),
        status: "running".into(),
        ..Default::default()
    };

    if tool.approval() == Approval::Ask {
        step.status = "pendingApproval".into();
        let approval_id = new_id();
        let rx = state.engine.register_approval(&approval_id);
        turn.upsert(&step, emit);
        emit(AgentEvent::ApprovalRequired { approval_id: approval_id.clone(), step: step.clone() });
        emit(AgentEvent::Status { text: format!("Waiting for your approval to run {}…", tool.info.title) });
        let decision = tokio::select! {
            d = rx => d.unwrap_or_else(|_| "deny".into()),
            _ = cancel.cancelled() => {
                state.engine.drop_approval(&approval_id);
                step.status = "denied".into();
                step.error = Some(STOPPED.into());
                turn.upsert(&step, emit);
                return Err(STOPPED.into());
            }
        };
        match decision.as_str() {
            "allow" => {}
            "always" => {
                if let Err(err) = persist_always(state, app, tool) {
                    emit(AgentEvent::Status { text: format!("Could not save the approval setting: {err}") });
                }
            }
            _ => {
                step.status = "denied".into();
                step.result = Some(DENIED.into());
                turn.upsert(&step, emit);
                return Ok(DENIED.into());
            }
        }
    }

    step.status = "running".into();
    turn.upsert(&step, emit);
    let status = match &tool.kind {
        ToolKind::UseSkill { .. } => {
            format!("Loading skill {}", args.get("name").and_then(Value::as_str).unwrap_or("").trim())
        }
        _ => format!("Running {}…", tool.info.title),
    };
    emit(AgentEvent::Status { text: status });

    let started = Instant::now();
    let result = tokio::select! {
        r = tools::execute_with_timeout(state, cfg, tool, &args) => r,
        _ = cancel.cancelled() => {
            step.status = "error".into();
            step.error = Some(STOPPED.into());
            step.duration_ms = Some(started.elapsed().as_millis() as u64);
            turn.upsert(&step, emit);
            return Err(STOPPED.into());
        }
    };
    step.duration_ms = Some(started.elapsed().as_millis() as u64);
    let content = match result {
        Ok(out) => {
            let out = truncate_chars(&out, max_chars);
            step.status = "done".into();
            step.result = Some(out.clone());
            if let (ToolKind::UseSkill { .. }, Some(name)) = (&tool.kind, args.get("name").and_then(Value::as_str)) {
                if !turn.skills_used.iter().any(|s| s == name) {
                    turn.skills_used.push(name.to_string());
                }
            }
            out
        }
        Err(err) => {
            let err = truncate_chars(&err, max_chars);
            step.status = "error".into();
            step.error = Some(err.clone());
            format!("Error: {err}")
        }
    };
    turn.upsert(&step, emit);
    Ok(content)
}

/// "Always allow": saves approval=always for the tool (built-in tool,
/// custom tool, or the whole MCP server) and tells the UI.
fn persist_always(state: &AppState, app: Option<&AppHandle>, tool: &CatalogTool) -> Result<(), String> {
    let snapshot = {
        let mut cfg = state.config.write().map_err(|_| "The settings are locked.".to_string())?;
        match &tool.kind {
            ToolKind::Builtin(kind) => {
                let spec = builtin::spec(*kind);
                let mut prefs = cfg.builtin_prefs(spec.name, spec.default_enabled, spec.default_approval);
                prefs.approval = Approval::Always;
                cfg.builtin_tools.insert(spec.name.to_string(), prefs);
            }
            ToolKind::Custom(t) => {
                if let Some(c) = cfg.custom_tools.iter_mut().find(|c| c.id == t.id) {
                    c.approval = Approval::Always;
                }
            }
            ToolKind::Mcp { server_id, .. } => {
                if let Some(s) = cfg.mcp_servers.iter_mut().find(|s| &s.id == server_id) {
                    s.approval = Approval::Always;
                }
            }
            ToolKind::UseSkill { .. } => return Ok(()),
        }
        cfg.clone()
    };
    snapshot.save(&state.paths.config_file)?;
    if let Some(app) = app {
        let _ = app.emit("config-changed", &snapshot);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(dec: &mut AnswerDecoder, chunks: &[&str]) -> Vec<String> {
        chunks.iter().map(|c| dec.push(c)).collect()
    }

    #[test]
    fn streams_answer_progressively() {
        let mut d = AnswerDecoder::new(false);
        let out = feed(&mut d, &["{\"ans", "wer\": \"Hel", "lo\\", "nWorld", "\\\"!\\\\", "\"}"]);
        assert_eq!(out, ["", "Hel", "lo", "\nWorld", "\"!\\", ""]);
        assert!(d.is_answer());
        assert_eq!(d.text(), "Hello\nWorld\"!\\");
    }

    #[test]
    fn handles_unicode_escapes_split_across_chunks() {
        let mut d = AnswerDecoder::new(false);
        // é, then an emoji as a surrogate pair split in the middle.
        let out = feed(&mut d, &["{\"answer\":\"caf\\u00", "e9 \\uD83D", "\\uDE00", " \\/ \\t", "x\"}"]);
        assert_eq!(out.concat(), "café 😀 / \tx");
        assert_eq!(out[0], "caf");
        assert_eq!(out[1], "é ");
        assert_eq!(out[2], "😀");
        assert_eq!(d.text(), "café 😀 / \tx");
    }

    #[test]
    fn whole_answer_in_one_chunk_and_spacing() {
        let mut d = AnswerDecoder::new(false);
        assert_eq!(d.push("  {\n \"answer\" :  \"12 \\u00d7 3 = 36\"}"), "12 × 3 = 36");
        let mut d = AnswerDecoder::new(false);
        assert_eq!(d.push("{\"answer\": \"bad \\uD83D then\"}"), "bad \u{FFFD} then");
    }

    #[test]
    fn tool_calls_are_not_streamed() {
        let mut d = AnswerDecoder::new(false);
        let out = feed(&mut d, &["{\"calc", "ulator\": {\"expression\": \"1+1\"}}"]);
        assert_eq!(out.concat(), "");
        assert!(!d.is_answer());
        assert_eq!(parse_action(d.raw()), Action::Tool("calculator".into(), json!({"expression": "1+1"})));
        // "answe..." that turns into another key.
        let mut d = AnswerDecoder::new(false);
        assert_eq!(d.push("{\"answers_tool\": {}}"), "");
        assert!(!d.is_answer());
    }

    #[test]
    fn plain_mode_passes_text_through() {
        let mut d = AnswerDecoder::new(true);
        assert_eq!(d.push("  "), "");
        assert_eq!(d.push("Hello"), "  Hello");
        assert_eq!(d.push(" there"), " there");
        assert_eq!(d.text(), "  Hello there");
        // A plain reply that still uses the answer object is decoded.
        let mut d = AnswerDecoder::new(true);
        assert_eq!(d.push("{\"answer\": \"Hi\"}"), "Hi");
        // Held text is flushed at the end.
        let mut d = AnswerDecoder::new(true);
        assert_eq!(d.push("{"), "");
        assert_eq!(d.finish(), "{");
    }

    #[test]
    fn parses_actions() {
        assert_eq!(parse_action("{\"answer\": \"x\"}"), Action::Answer("x".into()));
        assert_eq!(parse_action("{\"answer\": {}}"), Action::Answer(String::new()));
        assert_eq!(
            parse_action("{\"get_current_datetime\": {}}"),
            Action::Tool("get_current_datetime".into(), json!({}))
        );
        assert_eq!(parse_action("{\"t\": \"oops\"} trailing"), Action::Tool("t".into(), json!({})));
        assert_eq!(parse_action("not json"), Action::Invalid);
        assert_eq!(parse_action("{\"a\": {}, \"b\": {}}"), Action::Invalid);
    }

    fn msg(role: &str, text: &str, images: usize) -> ChatMessage {
        ChatMessage {
            id: new_id(),
            role: role.into(),
            text: text.into(),
            images: (0..images).map(|_| "data:image/png;base64,AAAA".to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn history_keeps_images_for_last_two_user_turns_and_skips_failures() {
        let messages = vec![
            msg("user", "old picture", 1),
            msg("assistant", "a cat", 0),
            msg("user", "failed question", 0),
            msg("assistant", "", 0),
            msg("user", "second picture", 1),
            msg("assistant", "a dog", 0),
            msg("user", "now this", 1),
        ];
        let (history, current) = build_history(&messages);
        assert_eq!(history.len(), 4);
        assert_eq!(history[0]["content"], "old picture");
        assert!(history[2]["content"].is_array());
        assert_eq!(history[2]["content"][1]["type"], "image_url");
        assert!(current["content"].is_array());
        assert!(!history.iter().any(|m| m["content"] == "failed question"));
    }

    #[test]
    fn trimming_drops_oldest_first() {
        let mut history = vec![
            json!({"role": "user", "content": "a".repeat(400)}),
            json!({"role": "assistant", "content": "b".repeat(400)}),
            json!({"role": "user", "content": "c".repeat(40)}),
            json!({"role": "assistant", "content": "d".repeat(40)}),
        ];
        trim_history(&mut history, 60);
        assert_eq!(history.len(), 2);
        assert_eq!(history[0]["role"], "user");
        trim_history(&mut history, 5);
        assert!(history.is_empty());
    }

    #[test]
    fn budget_leaves_room() {
        assert_eq!(prompt_budget(8192), 6144 - 1024);
        assert_eq!(prompt_budget(4096), 3072 - 512);
    }

    #[test]
    fn usage_adds_up_over_requests() {
        let mut turn = Turn::default();
        turn.add_usage(&Usage { prompt_tokens: 400, completion_tokens: 10, total_tokens: 410 });
        turn.add_usage(&Usage { prompt_tokens: 180, completion_tokens: 30, total_tokens: 210 });
        let u = turn.usage.unwrap();
        assert_eq!((u.prompt_tokens, u.completion_tokens, u.total_tokens), (400, 40, 440));
        assert_eq!(turn.max_total, 410);
    }

    #[test]
    fn always_approval_is_saved() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::new(crate::state::Paths::new(dir.path().to_path_buf()));
        state
            .config
            .write()
            .unwrap()
            .builtin_tools
            .insert("fetch_url".into(), crate::config::ToolPrefs { enabled: true, approval: Approval::Ask });
        let cfg = state.config();
        let cat = tools::build_catalog(&cfg, &[], &[]);
        let fetch = cat.iter().find(|t| t.info.id == "builtin:fetch_url").unwrap();
        let shell = cat.iter().find(|t| t.info.id == "builtin:run_shell_command").unwrap();
        persist_always(&state, None, fetch).unwrap();
        persist_always(&state, None, shell).unwrap();
        let cfg = state.config();
        assert_eq!(cfg.builtin_tools["fetch_url"].approval, Approval::Always);
        assert!(cfg.builtin_tools["fetch_url"].enabled);
        // Not enabled by default: "always" must not switch it on.
        assert_eq!(cfg.builtin_tools["run_shell_command"].approval, Approval::Always);
        assert!(!cfg.builtin_tools["run_shell_command"].enabled);
        let saved = AppConfig::load(&state.paths.config_file);
        assert_eq!(saved.builtin_tools["fetch_url"].approval, Approval::Always);
    }

    #[test]
    fn skills_match_by_name_phrase_or_topic_words() {
        let skill = |name: &str, description: &str| Skill {
            name: name.into(),
            description: description.into(),
            ..Default::default()
        };
        let fruit = skill("fruit-facts", "Use when the user asks about fruit.");
        for q in ["Which fruit has the most vitamin C?", "Is a tomato a fruit?", "Name three tropical fruits."] {
            assert!(skill_match_score(q, &fruit) > 0, "{q}");
        }
        for q in ["What is the capital of France?", "Write a haiku about the sea.", "Tell me facts about Rome", ""] {
            assert_eq!(skill_match_score(q, &fruit), 0, "{q}");
        }
        assert!(skill_match_score("Use fruit-facts for this", &fruit) >= 100);

        let eli10 = skill(
            "explain-like-10",
            "Use when the user asks for a simple explanation, or says \"explain like I am 10\".",
        );
        assert!(skill_match_score("Explain like I am 10: what is a black hole?", &eli10) > 0);
        assert!(skill_match_score("explain   like i am 10, please", &eli10) > 0);
        assert_eq!(skill_match_score("Explain how a car engine works.", &eli10), 0);

        let pdf = skill("pdf", "Fill and read PDF forms.");
        let code = skill("code-review", "Use when reviewing source code changes for bugs and style problems.");
        let all = [&pdf, &code, &fruit];
        assert_eq!(
            matching_skills("Please fill this PDF form", &all).iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["pdf"]
        );
        assert!(matching_skills("Write a haiku", &all).is_empty());
        assert_eq!(stem("tomatoes"), "tomato");
        assert_eq!(stem("berries"), "berry");
        assert_eq!(stem("notes"), "note");
        assert_eq!(stem("glass"), "glass");
    }

    #[test]
    fn guide_lists_tools_and_skills() {
        let cfg = AppConfig::default();
        let skills =
            vec![Skill { name: "pdf-tips".into(), description: "Work with PDFs".into(), ..Default::default() }];
        let tools: Vec<CatalogTool> =
            tools::build_catalog(&cfg, &[], &skills).into_iter().filter(|t| t.info.enabled).collect();
        let refs: Vec<&Skill> = skills.iter().collect();
        let guide = tool_guide(&tools, &refs);
        assert!(guide.contains("- calculator(expression: string): "), "{guide}");
        assert!(guide.contains("- get_current_datetime(): "), "{guide}");
        assert!(guide.contains("- use_skill(name: \"pdf-tips\"): "), "{guide}");
        assert!(guide.contains("- pdf-tips: Work with PDFs"), "{guide}");
        assert!(guide.ends_with(TOOL_PROTOCOL));
        assert!(!guide.contains("read_file"));
    }
}
