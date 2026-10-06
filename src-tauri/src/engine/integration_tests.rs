//! End-to-end tests against the real `fm serve` (private socket server).
//! Run with: `FM_INTEGRATION=1 cargo test engine::integration_tests -- --nocapture`
//! Optional: `FM_INTEGRATION_REPEAT=5` repeats every scenario and prints the
//! success rate.

use super::{chats, router, AgentEvent, ChatMessage};
use crate::config::{Approval, CustomTool, CustomToolKind, ParamType, ToolParam};
use crate::state::{AppState, Paths};
use crate::util::RwLockExt;
use serde_json::json;
use std::sync::{Arc, Mutex};

fn enabled() -> bool {
    std::env::var("FM_INTEGRATION").as_deref() == Ok("1")
}

fn repeat() -> usize {
    std::env::var("FM_INTEGRATION_REPEAT").ok().and_then(|v| v.parse().ok()).unwrap_or(1).max(1)
}

/// App state in a short temp folder (Unix socket paths must stay short).
fn test_state() -> (tempfile::TempDir, Arc<AppState>) {
    let dir = tempfile::Builder::new().prefix("fmgui-").tempdir_in("/tmp").unwrap();
    let state = AppState::new(Paths::new(dir.path().to_path_buf()));
    {
        let mut cfg = state.config.write_safe();
        cfg.custom_tools.push(CustomTool {
            id: "order-tool".into(),
            name: "lookup_order".into(),
            description: "Look up the shipping status of an order by its order id.".into(),
            params: vec![ToolParam {
                name: "order_id".into(),
                kind: ParamType::String,
                description: "The order id, e.g. A-1234".into(),
                required: true,
            }],
            kind: CustomToolKind::Shell {
                command: r#"echo "Order $FM_ARG_ORDER_ID is in transit""#.into(),
                cwd: None,
                timeout_secs: 10,
            },
            enabled: true,
            approval: Approval::Always,
        });
    }
    (dir, Arc::new(state))
}

struct Outcome {
    message: ChatMessage,
    events: Vec<AgentEvent>,
}

async fn ask(state: &Arc<AppState>, question: &str) -> Outcome {
    let chat = chats::create(&state.engine.chats_dir, &state.config().chat_defaults.instructions).unwrap();
    let events: Arc<Mutex<Vec<AgentEvent>>> = Arc::default();
    let sink = events.clone();
    let approver = state.clone();
    let emit = move |e: AgentEvent| {
        // Tools that ask for approval are denied (the test must not hang).
        if let AgentEvent::ApprovalRequired { approval_id, .. } = &e {
            approver.engine.respond_approval(approval_id, "deny");
        }
        sink.lock().unwrap().push(e);
    };
    let message = router::run_turn(state, None, &chat.id, question.into(), Vec::new(), &emit).await.unwrap();
    let events = events.lock().unwrap().clone();
    Outcome { message, events }
}

fn digits_only(text: &str) -> String {
    text.chars().filter(|c| !matches!(c, ',' | ' ' | '\u{202f}' | '\u{a0}')).collect()
}

fn describe(o: &Outcome) -> String {
    let steps: Vec<String> = o
        .message
        .steps
        .iter()
        .map(|s| {
            format!("{}({}) → {} {:?}", s.tool_name, s.arguments, s.status, s.result.as_deref().or(s.error.as_deref()))
        })
        .collect();
    let deltas = o.events.iter().filter(|e| matches!(e, AgentEvent::Delta { .. })).count();
    format!(
        "{} ms, {deltas} deltas, text={:?} steps={steps:?} error={:?} usage={:?}",
        o.message.duration_ms.unwrap_or(0),
        o.message.text,
        o.message.error,
        o.message.usage.as_ref().map(|u| (u.prompt_tokens, u.completion_tokens))
    )
}

type Check = fn(&Outcome) -> Result<(), String>;

fn check_no_tool(o: &Outcome) -> Result<(), String> {
    if o.message.error.is_some() {
        return Err("error".into());
    }
    if !o.message.steps.is_empty() {
        return Err("used a tool".into());
    }
    if !o.message.text.to_lowercase().contains("paris") {
        return Err("no Paris".into());
    }
    Ok(())
}

fn check_calculator(o: &Outcome) -> Result<(), String> {
    let step = o.message.steps.iter().find(|s| s.tool_name == "calculator").ok_or("no calculator step")?;
    if step.status != "done" {
        return Err(format!("calculator step {}", step.status));
    }
    // 1234.5 * 987.25 = 1218760.125
    if !digits_only(&o.message.text).contains("1218760.1") {
        return Err("answer lacks 1218760.1".into());
    }
    Ok(())
}

fn check_datetime(o: &Outcome) -> Result<(), String> {
    let step = o.message.steps.iter().find(|s| s.tool_name == "get_current_datetime").ok_or("no datetime step")?;
    if step.status != "done" {
        return Err(format!("datetime step {}", step.status));
    }
    let year = chrono::Local::now().format("%Y").to_string();
    if !o.message.text.contains(&year) {
        return Err(format!("answer lacks {year}"));
    }
    Ok(())
}

fn check_order(o: &Outcome) -> Result<(), String> {
    let step = o.message.steps.iter().find(|s| s.tool_name == "lookup_order").ok_or("no lookup_order step")?;
    if step.arguments["order_id"] != json!("A-7781") {
        return Err(format!("wrong args {}", step.arguments));
    }
    if step.result.as_deref() != Some("Order A-7781 is in transit") {
        return Err(format!("wrong result {:?}", step.result));
    }
    if !o.message.text.to_lowercase().contains("transit") {
        return Err("answer lacks transit".into());
    }
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_fm_agent_scenarios() {
    if !enabled() {
        eprintln!("skipped: set FM_INTEGRATION=1 to run against the real fm serve");
        return;
    }
    let (_dir, state) = test_state();
    let scenarios: [(&str, &str, Check); 4] = [
        ("no tool", "What is the capital of France? Answer in one short sentence.", check_no_tool),
        ("calculator", "What is 1234.5 * 987.25? Use the calculator.", check_calculator),
        ("datetime", "What is today's date?", check_datetime),
        ("custom shell tool", "Where is order A-7781?", check_order),
    ];
    let runs = repeat();
    let mut failures = Vec::new();
    for (name, question, check) in scenarios {
        let mut ok = 0;
        for run in 0..runs {
            let outcome = ask(&state, question).await;
            let result = check(&outcome);
            assert!(outcome.events.iter().any(|e| matches!(e, AgentEvent::Done { .. })), "no Done event");
            match &result {
                Ok(()) => ok += 1,
                Err(why) => failures.push(format!("{name} run {run}: {why}: {}", describe(&outcome))),
            }
            eprintln!("[{name} #{run}] {} {}", if result.is_ok() { "PASS" } else { "FAIL" }, describe(&outcome));
        }
        eprintln!("== {name}: {ok}/{runs} passed");
        if runs == 1 {
            continue;
        }
        assert!(ok * 5 >= runs * 4, "{name}: only {ok}/{runs} passed");
    }
    // The chat files were written.
    assert!(chats::list(&state.engine.chats_dir).len() >= 4);
    state.engine.shutdown().await;
    if runs == 1 {
        assert!(failures.is_empty(), "failures:\n{}", failures.join("\n"));
    }
}

/// fm serve may answer with an empty string when the last message is a tool
/// result. Checks the fallback: a short user message after the tool result
/// gets a real answer.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_fm_tool_result_last_then_nudge() {
    if !enabled() {
        eprintln!("skipped: set FM_INTEGRATION=1 to run against the real fm serve");
        return;
    }
    let (_dir, state) = test_state();
    state.engine.server.ensure("/usr/bin/fm").await.unwrap();
    let mut messages = vec![
        json!({"role": "system", "content": "You are a helpful assistant."}),
        json!({"role": "user", "content": "Where is order A-7781?"}),
        json!({"role": "assistant", "content": null, "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "lookup_order", "arguments": "{\"order_id\":\"A-7781\"}"}}]}),
        json!({"role": "tool", "tool_call_id": "call_1", "content": "Order A-7781 is in transit"}),
    ];
    let body = json!({"model": "system", "stream": false, "messages": messages});
    let (status, reply) = state.engine.server.post_json("/v1/chat/completions", &body).await.unwrap();
    assert_eq!(status, 200, "{reply}");
    let text = reply.pointer("/choices/0/message/content").and_then(|v| v.as_str()).unwrap_or("").to_string();
    eprintln!("tool message last → {text:?}");

    messages.push(json!({"role": "user", "content": "Use the tool result above to answer my question."}));
    let body = json!({"model": "system", "stream": false, "messages": messages});
    let (status, reply) = state.engine.server.post_json("/v1/chat/completions", &body).await.unwrap();
    assert_eq!(status, 200, "{reply}");
    let nudged = reply.pointer("/choices/0/message/content").and_then(|v| v.as_str()).unwrap_or("");
    eprintln!("with nudge → {nudged:?}");
    assert!(nudged.to_lowercase().contains("transit"), "{nudged}");

    // Server status, restart and clean shutdown.
    let status = state.engine.server.status().await;
    assert!(status.running && status.pid.is_some());
    state.engine.server.restart("/usr/bin/fm").await.unwrap();
    assert!(state.engine.server.get_json("/health").await.unwrap().0 == 200);
    let socket = state.engine.server.effective_socket();
    state.engine.shutdown().await;
    assert!(!state.engine.server.status().await.running);
    assert!(!socket.exists());
}

/// Router accuracy over varied wording: does the model pick the right tool
/// (or no tool)? Prints the rate; requires at least 80 %.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_fm_router_accuracy() {
    if !enabled() {
        eprintln!("skipped: set FM_INTEGRATION=1 to run against the real fm serve");
        return;
    }
    let (_dir, state) = test_state();
    let cases: &[(&str, Option<&str>)] = &[
        ("Multiply 1234.5 by 987.25.", Some("calculator")),
        ("What is 17% of 2,340?", Some("calculator")),
        ("How much is 98765 divided by 43?", Some("calculator")),
        ("What time is it right now?", Some("get_current_datetime")),
        ("Which day of the week is it today?", Some("get_current_datetime")),
        ("Can you check the status of my order B-1002?", Some("lookup_order")),
        ("Has order Z-5 shipped yet?", Some("lookup_order")),
        ("Write a haiku about the sea.", None),
        ("Hi! How are you?", None),
        ("Explain what a black hole is in two sentences.", None),
        // Held out: not used while tuning the guide wording.
        ("What's 2 to the power of 20?", Some("calculator")),
        ("What year is it?", Some("get_current_datetime")),
        ("Is order Q-77 delivered?", Some("lookup_order")),
        ("Translate 'good morning' into Spanish.", None),
        ("Give me three tips for better sleep as a list.", None),
        ("Find my files about taxes.", Some("spotlight_search")),
    ];
    let mut ok = 0;
    for (question, expected) in cases {
        let o = ask(&state, question).await;
        let first = o.message.steps.first().map(|s| s.tool_name.as_str());
        let pass = first == *expected && o.message.error.is_none() && !o.message.text.trim().is_empty();
        if pass {
            ok += 1;
        }
        eprintln!("[{}] {question:?} expected {expected:?} → {}", if pass { "PASS" } else { "FAIL" }, describe(&o));
    }
    eprintln!("== router accuracy: {ok}/{}", cases.len());
    state.engine.shutdown().await;
    assert!(ok * 5 >= cases.len() * 4, "router accuracy {ok}/{}", cases.len());
}

/// A tool that asks for approval is denied; Stop ends a turn with "Stopped".
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_fm_approval_deny_and_stop() {
    if !enabled() {
        eprintln!("skipped: set FM_INTEGRATION=1 to run against the real fm serve");
        return;
    }
    let (_dir, state) = test_state();
    // fetch_url asks for approval by default; the test emitter denies it.
    let o = ask(&state, "Fetch https://example.com and tell me the page title.").await;
    eprintln!("deny → {}", describe(&o));
    let step = o.message.steps.iter().find(|s| s.tool_name == "fetch_url").expect("fetch_url step");
    assert_eq!(step.status, "denied");
    assert_eq!(step.result.as_deref(), Some(router::DENIED));
    assert!(o.events.iter().any(|e| matches!(e, AgentEvent::ApprovalRequired { .. })));
    assert!(o.message.error.is_none());

    // Stop right after the turn starts.
    let chat = chats::create(&state.engine.chats_dir, "").unwrap();
    let canceller = state.clone();
    let chat_id = chat.id.clone();
    let emit = move |e: AgentEvent| {
        if matches!(e, AgentEvent::AssistantStart { .. }) {
            canceller.engine.cancel_run(&chat_id);
        }
    };
    let msg = router::run_turn(&state, None, &chat.id, "Write a long story about a cat.".into(), Vec::new(), &emit)
        .await
        .unwrap();
    assert_eq!(msg.error.as_deref(), Some("Stopped"));
    let saved = chats::load(&state.engine.chats_dir, &chat.id).unwrap();
    assert_eq!(saved.messages.len(), 2);
    assert_eq!(saved.title, "Write a long story about a cat.");
    // The chat can be used again after Stop.
    let again = ask(&state, "Say hello.").await;
    assert!(again.message.error.is_none(), "{}", describe(&again));
    state.engine.shutdown().await;
}

/// Debug helper: `FM_INTEGRATION=1 FM_DEBUG_PROMPT="..." cargo test real_fm_debug_prompt -- --nocapture`
/// prints every event with its time.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_fm_debug_prompt() {
    let Ok(prompt) = std::env::var("FM_DEBUG_PROMPT") else { return };
    if !enabled() {
        return;
    }
    let (_dir, state) = test_state();
    let started = std::time::Instant::now();
    let chat = chats::create(&state.engine.chats_dir, &state.config().chat_defaults.instructions).unwrap();
    let emit = move |e: AgentEvent| {
        let text = serde_json::to_string(&e).unwrap();
        eprintln!("{:>6} ms {}", started.elapsed().as_millis(), crate::util::truncate_chars(&text, 400));
    };
    let _ = router::run_turn(&state, None, &chat.id, prompt, Vec::new(), &emit).await;
    state.engine.shutdown().await;
}

/// An image message (data URL) gets an answer about the image.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_fm_image_message() {
    if !enabled() {
        eprintln!("skipped: set FM_INTEGRATION=1 to run against the real fm serve");
        return;
    }
    // 64x64 solid red PNG.
    const RED: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC";
    let (_dir, state) = test_state();
    let chat = chats::create(&state.engine.chats_dir, "").unwrap();
    let emit = |_e: AgentEvent| {};
    let msg =
        router::run_turn(&state, None, &chat.id, "What color is this image? One word.".into(), vec![RED.into()], &emit)
            .await
            .unwrap();
    eprintln!("image → {:?} error={:?}", msg.text, msg.error);
    state.engine.shutdown().await;
    assert!(msg.error.is_none());
    assert!(msg.text.to_lowercase().contains("red"), "{}", msg.text);
    let saved = chats::load(&state.engine.chats_dir, &chat.id).unwrap();
    assert_eq!(saved.messages[0].images.len(), 1);
}

/// With a context size set too high, trimming lets a long history through and
/// the real model overflows: the engine must drop old messages and retry.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_fm_context_overflow_retry() {
    if !enabled() {
        eprintln!("skipped: set FM_INTEGRATION=1 to run against the real fm serve");
        return;
    }
    let (_dir, state) = test_state();
    state.config.write_safe().context_size = 40_000;
    let mut chat = chats::create(&state.engine.chats_dir, "Be brief.").unwrap();
    for i in 0..12 {
        let filler: String = (0..60).map(|n| format!("Fact {i}.{n} is about the ocean. ")).collect();
        chat.messages.push(ChatMessage {
            id: format!("u{i}"),
            role: "user".into(),
            text: filler.clone(),
            ..Default::default()
        });
        chat.messages.push(ChatMessage {
            id: format!("a{i}"),
            role: "assistant".into(),
            text: "Noted.".into(),
            ..Default::default()
        });
    }
    chats::save(&state.engine.chats_dir, &chat).unwrap();
    let statuses: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = statuses.clone();
    let emit = move |e: AgentEvent| {
        if let AgentEvent::Status { text } = e {
            sink.lock().unwrap().push(text);
        }
    };
    let msg = router::run_turn(&state, None, &chat.id, "Say hello.".into(), Vec::new(), &emit).await.unwrap();
    let statuses = statuses.lock().unwrap().clone();
    eprintln!("overflow → {:?} error={:?} statuses={statuses:?}", msg.text, msg.error);
    state.engine.shutdown().await;
    assert!(statuses.iter().any(|s| s.contains("older messages")), "{statuses:?}");
    assert!(msg.error.is_none(), "{:?}", msg.error);
    assert!(!msg.text.trim().is_empty());
}

/// A shell tool that only echoes, for a realistic number of tools.
fn echo_tool(name: &str, description: &str, param: &str, approval: Approval) -> CustomTool {
    CustomTool {
        id: format!("{name}-tool"),
        name: name.into(),
        description: description.into(),
        params: vec![ToolParam {
            name: param.into(),
            kind: ParamType::String,
            description: String::new(),
            required: true,
        }],
        kind: CustomToolKind::Shell {
            command: format!("echo \"ok: ${}\"", super::custom::env_name(param)),
            cwd: None,
            timeout_secs: 10,
        },
        enabled: true,
        approval,
    }
}

/// 11 built-in tools, 5 custom tools and one on-demand skill (`use_skill`).
fn skill_state() -> (tempfile::TempDir, Arc<AppState>) {
    use crate::config::{SkillMode, SkillPrefs, ToolPrefs};
    let (dir, state) = test_state();
    {
        let mut cfg = state.config.write_safe();
        for spec in super::builtin::BUILTINS {
            cfg.builtin_tools.insert(spec.name.into(), ToolPrefs { enabled: true, approval: spec.default_approval });
        }
        cfg.custom_tools.push(echo_tool(
            "get_weather",
            "Get the weather forecast for a city.",
            "city",
            Approval::Always,
        ));
        cfg.custom_tools.push(echo_tool(
            "convert_currency",
            "Convert an amount of money to another currency.",
            "amount",
            Approval::Always,
        ));
        cfg.custom_tools.push(echo_tool("send_email", "Send an email to a contact.", "to", Approval::Ask));
        cfg.custom_tools.push(echo_tool("create_note", "Save a note in the Notes app.", "text", Approval::Ask));
        cfg.skills.insert("fruit-facts".into(), SkillPrefs { mode: SkillMode::OnDemand });
        cfg.skills.insert("explain-like-10".into(), SkillPrefs { mode: SkillMode::OnDemand });
    }
    let skills = [
        ("fruit-facts", "Use when the user asks about fruit.", "Always end your answer with the word PINEAPPLE."),
        (
            "explain-like-10",
            "Use when the user asks for a simple explanation, or says \"explain like I am 10\".",
            "Use short words a 10 year old knows. Start your answer with the word KIDDO.",
        ),
    ];
    for (name, description, body) in skills {
        let input = crate::skills::SkillInput {
            original_name: None,
            name: name.into(),
            description: description.into(),
            body: body.into(),
        };
        state.skills.save(&input).unwrap();
    }
    (dir, state)
}

/// On-demand skills: loaded for matching requests, never for unrelated ones.
/// Prints the rates; `FM_INTEGRATION_REPEAT` repeats every prompt.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_fm_on_demand_skill_routing() {
    if !enabled() {
        eprintln!("skipped: set FM_INTEGRATION=1 to run against the real fm serve");
        return;
    }
    let (_dir, state) = skill_state();
    let cfg = state.config();
    let catalog = super::tools::catalog(&state, &cfg).await;
    let enabled_tools = catalog.iter().filter(|t| t.info.enabled).count();
    assert!(enabled_tools >= 16, "{enabled_tools} tools");

    let keyword = ["Which fruit has the most vitamin C?", "Is a tomato a fruit?", "Name three tropical fruits."];
    let semantic = ["Are bananas good for breakfast?", "How should I store ripe mangoes?"];
    let unrelated =
        ["What is the capital of France?", "What is 12 * 7?", "Write a haiku about the sea.", "What time is it?"];
    let loaded = |o: &Outcome| o.message.skills_used.iter().any(|n| n == "fruit-facts");
    // The skill asks for the word in capitals; "pineapple" as a fruit name does not count.
    let pineapple = |o: &Outcome| o.message.text.contains("PINEAPPLE");

    let runs = repeat();
    let mut report = Vec::new();
    let (mut kw_loaded, mut kw_follow, mut sem_loaded, mut sem_follow, mut wrong) = (0, 0, 0, 0, 0);
    for _ in 0..runs {
        for q in keyword {
            let o = ask(&state, q).await;
            kw_loaded += loaded(&o) as usize;
            kw_follow += pineapple(&o) as usize;
            report.push(format!("[keyword] {q:?} → loaded={} {}", loaded(&o), describe(&o)));
        }
        for q in semantic {
            let o = ask(&state, q).await;
            sem_loaded += loaded(&o) as usize;
            sem_follow += pineapple(&o) as usize;
            report.push(format!("[semantic] {q:?} → loaded={} {}", loaded(&o), describe(&o)));
        }
        for q in unrelated {
            let o = ask(&state, q).await;
            wrong += loaded(&o) as usize;
            report.push(format!("[unrelated] {q:?} → loaded={} {}", loaded(&o), describe(&o)));
        }
    }
    // The second skill: its quoted phrase loads it, and only it.
    let o = ask(&state, "Explain like I am 10: what is a black hole?").await;
    report.push(format!("[eli10] → {:?} {}", o.message.skills_used, describe(&o)));
    let eli10_ok = o.message.skills_used == ["explain-like-10"];
    state.engine.shutdown().await;
    for line in &report {
        eprintln!("{line}");
    }
    let (k, s, u) = (keyword.len() * runs, semantic.len() * runs, unrelated.len() * runs);
    eprintln!(
        "== skill routing: keyword loaded {kw_loaded}/{k} (followed {kw_follow}/{k}), \
         semantic loaded {sem_loaded}/{s} (followed {sem_follow}/{s}), unrelated loaded {wrong}/{u}"
    );
    assert_eq!(kw_loaded, k, "matching requests must load the skill");
    assert_eq!(wrong, 0, "unrelated requests must not load the skill");
    assert!(eli10_ok, "the explain-like-10 skill should be the only one loaded");
}
