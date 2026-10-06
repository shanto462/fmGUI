//! Integration tests for the MCP client against small Python fixtures in
//! `src/mcp/fixtures/`. They need `python3` on the login-shell PATH and are
//! skipped (with a note) when it is missing. The test against the real
//! `@modelcontextprotocol/server-everything` runs only with MCP_NPX=1.

use super::client::{ClientEvent, McpClient};
use super::rpc::LogTail;
use super::*;
use crate::config::{Approval, KeyValue, McpTransport};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/mcp/fixtures");

fn python() -> Option<String> {
    let env = crate::util::login_env();
    match errors::resolve_program("python3", env, None) {
        Ok(p) => Some(p.display().to_string()),
        Err(_) => {
            eprintln!("python3 not found: skipping MCP fixture test");
            None
        }
    }
}

fn server(id: &str, transport: McpTransport) -> McpServerConfig {
    McpServerConfig {
        id: id.into(),
        name: format!("Fixture {id}"),
        enabled: true,
        transport,
        disabled_tools: vec!["fail".into()],
        approval: Approval::Ask,
    }
}

fn stdio_config(id: &str) -> Option<McpServerConfig> {
    let python = python()?;
    Some(server(
        id,
        McpTransport::Stdio {
            command: python,
            args: vec![format!("{FIXTURES}/stdio_server.py")],
            env: vec![KeyValue { key: "FIXTURE_VAR".into(), value: "hello-fixture".into() }],
            cwd: None,
        },
    ))
}

async fn wait_for(
    mgr: &McpManager,
    cfg: &McpServerConfig,
    what: &str,
    ok: impl Fn(&McpServerStatus) -> bool,
) -> McpServerStatus {
    for _ in 0..100 {
        let status = mgr.statuses(std::slice::from_ref(cfg)).await.remove(0);
        if ok(&status) {
            return status;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("timed out waiting for: {what}");
}

#[tokio::test]
async fn stdio_client_round_trip() {
    let Some(cfg) = stdio_config("client") else { return };
    let tail = LogTail::default();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let pid_dir = tempfile::tempdir().unwrap();
    let pid_file = pid_dir.path().join("client.pid");
    let client = McpClient::start(&cfg, tail.clone(), tx, Some(pid_file.clone())).await.unwrap();
    client.initialize().await.unwrap();
    // The process group is recorded while the server runs.
    let record: crate::procs::PidRecord = serde_json::from_slice(&std::fs::read(&pid_file).unwrap()).unwrap();
    assert!(record.group && record.pid > 1 && crate::procs::record_is_live(&record), "{record:?}");

    let info = client.info();
    assert_eq!(info.name.as_deref(), Some("fixture"));
    assert_eq!(info.version.as_deref(), Some("1.2.3"));
    // We asked for 2025-06-18 and accept the older version the server answered.
    assert_eq!(info.protocol_version.as_deref(), Some("2025-03-26"));

    // Two pages, joined.
    let names: Vec<String> = client.list_tools().await.unwrap().into_iter().map(|t| t.name).collect();
    assert_eq!(names, ["add", "fail", "crash", "notify", "echo_env", "rich"]);

    // add() first asks us ping, roots/list and an unknown method; it fails if our replies are wrong.
    assert_eq!(client.call_tool("add", json!({"a": 2, "b": 3})).await, Ok("5".to_string()));
    assert_eq!(client.call_tool("fail", json!({})).await, Err("boom".to_string()));
    assert_eq!(client.call_tool("echo_env", Value::Null).await, Ok("hello-fixture".to_string()));
    assert_eq!(
        client.call_tool("rich", json!({})).await,
        Ok("Here\n[image image/png]\n[link file:///tmp/example.txt]".to_string())
    );
    assert_eq!(client.call_tool("nope", json!({})).await, Err("Unknown tool".to_string()));

    let lines = tail.snapshot();
    assert!(lines.contains(&"fixture ready".to_string()), "{lines:?}");
    assert!(lines.contains(&"[stdout] fixture server starting (not JSON)".to_string()), "{lines:?}");
    assert!(lines.contains(&"[info] fixture: rich called".to_string()), "{lines:?}");

    client.close().await;
    assert!(!pid_file.exists(), "the pid file is removed when the server stops");
    // Closing on purpose is not an error.
    tokio::time::sleep(Duration::from_millis(100)).await;
    while let Ok(event) = rx.try_recv() {
        assert!(!matches!(event, ClientEvent::Closed(_)), "unexpected {event:?}");
    }
    // Requests after close fail at once.
    assert!(client.call_tool("add", json!({"a": 1, "b": 1})).await.is_err());
}

#[tokio::test]
async fn manager_connects_lists_calls_and_reports_a_crash() {
    let Some(cfg) = stdio_config("manager") else { return };
    let mgr = McpManager::default();
    mgr.connect_with(None, &cfg).await.unwrap();

    let status = mgr.statuses(std::slice::from_ref(&cfg)).await.remove(0);
    assert_eq!(status.state, "connected");
    assert_eq!(status.name, "Fixture manager");
    assert_eq!(status.server_name.as_deref(), Some("fixture"));
    assert_eq!(status.server_version.as_deref(), Some("1.2.3"));
    assert_eq!(status.tools.len(), 6);
    assert!(!status.tools.iter().find(|t| t.name == "fail").unwrap().enabled);
    assert!(status.tools.iter().find(|t| t.name == "add").unwrap().enabled);

    let tools = mgr.tools().await;
    assert_eq!(tools.len(), 6);
    assert_eq!(tools[0].server_id, "manager");
    assert_eq!(tools[0].server_name, "Fixture manager");
    assert_eq!(tools[0].input_schema["required"], json!(["a", "b"]));

    assert_eq!(mgr.call_tool("manager", "add", json!({"a": 2, "b": 3})).await, Ok("5".to_string()));
    assert!(mgr.call_tool("other", "add", json!({})).await.unwrap_err().contains("not connected"));

    // notifications/tools/list_changed → the manager lists the tools again.
    assert_eq!(mgr.call_tool("manager", "notify", json!({})).await, Ok("ok".to_string()));
    wait_for(&mgr, &cfg, "the extra tool", |s| s.tools.iter().any(|t| t.name == "extra")).await;

    // The process dies: the pending call fails and the state becomes "error".
    let err = mgr.call_tool("manager", "crash", json!({})).await.unwrap_err();
    assert!(err.contains("exit code 3"), "{err}");
    let status = wait_for(&mgr, &cfg, "error state", |s| s.state == "error").await;
    let message = status.error.unwrap();
    assert!(message.contains("exit code 3") && message.contains("fatal: crashing now"), "{message}");
    assert!(status.stderr_tail.contains(&"fatal: crashing now".to_string()));
    assert!(status.tools.is_empty());
    assert!(mgr.tools().await.is_empty());
    assert!(mgr.call_tool("manager", "add", json!({})).await.unwrap_err().contains("not working"));

    // Reconnect, then disconnect.
    mgr.connect_with(None, &cfg).await.unwrap();
    assert_eq!(mgr.statuses(std::slice::from_ref(&cfg)).await[0].state, "connected");
    mgr.disconnect_with(None, "manager").await;
    assert_eq!(mgr.statuses(std::slice::from_ref(&cfg)).await[0].state, "disconnected");

    // prune() stops servers that were removed from the settings.
    mgr.connect_with(None, &cfg).await.unwrap();
    mgr.prune(&[]).await;
    assert_eq!(mgr.statuses(std::slice::from_ref(&cfg)).await[0].state, "disconnected");
    mgr.shutdown().await;
}

#[tokio::test]
async fn test_reports_tools_and_friendly_errors() {
    let Some(cfg) = stdio_config("wizard") else { return };
    let mgr = McpManager::default();

    let ok = mgr.test(&cfg).await;
    assert!(ok.ok, "{:?}", ok.error);
    assert_eq!(ok.server_name.as_deref(), Some("fixture"));
    assert_eq!(ok.tools.len(), 6);
    assert!(ok.duration_ms > 0);
    // test() does not keep a connection.
    assert_eq!(mgr.statuses(std::slice::from_ref(&cfg)).await[0].state, "disconnected");

    let missing = server(
        "missing",
        McpTransport::Stdio { command: "npx-not-installed-xyz".into(), args: vec![], env: vec![], cwd: None },
    );
    let res = mgr.test(&missing).await;
    assert!(!res.ok);
    assert!(res.error.unwrap().starts_with("Command not found: npx-not-installed-xyz."));

    let bad_cwd = server(
        "cwd",
        McpTransport::Stdio { command: "sh".into(), args: vec![], env: vec![], cwd: Some("/no/such/folder".into()) },
    );
    assert!(mgr.test(&bad_cwd).await.error.unwrap().contains("working folder does not exist"));

    // A server that exits before the handshake (like npx with a wrong package).
    let python = python().unwrap();
    let dies = server(
        "dies",
        McpTransport::Stdio {
            command: python.clone(),
            args: vec!["-c".into(), "import sys; sys.stderr.write('npm error 404 Not Found\\n'); sys.exit(1)".into()],
            env: vec![],
            cwd: None,
        },
    );
    let res = mgr.test(&dies).await;
    let err = res.error.unwrap();
    assert!(err.contains("exit code 1") && err.contains("could not find this package"), "{err}");
    assert_eq!(res.stderr_tail, vec!["npm error 404 Not Found".to_string()]);

    // The whole command typed into the command field still works.
    let one_field = server(
        "one-field",
        McpTransport::Stdio {
            command: format!("{python} {FIXTURES}/stdio_server.py"),
            args: vec![],
            env: vec![],
            cwd: None,
        },
    );
    assert!(mgr.test(&one_field).await.ok);
}

/// Starts the HTTP fixture; returns the child (killed on drop) and its port.
async fn http_fixture() -> Option<(tokio::process::Child, u16)> {
    let python = python()?;
    let mut child = tokio::process::Command::new(python)
        .arg(format!("{FIXTURES}/http_server.py"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let mut lines = BufReader::new(child.stdout.take()?).lines();
    let port = lines.next_line().await.ok()??.trim().parse().ok()?;
    Some((child, port))
}

fn http_config(id: &str, url: String, token: Option<&str>) -> McpServerConfig {
    let headers = token.map(|t| vec![KeyValue { key: "X-Test-Token".into(), value: t.into() }]).unwrap_or_default();
    server(id, McpTransport::Http { url, headers })
}

async fn http_stats(port: u16) -> Value {
    reqwest::get(format!("http://127.0.0.1:{port}/stats")).await.unwrap().json().await.unwrap()
}

#[tokio::test]
async fn http_client_round_trip_with_sse_and_session_expiry() {
    let Some((_child, port)) = http_fixture().await else { return };
    let cfg = http_config("http", format!("http://127.0.0.1:{port}/mcp"), Some("test-token-123"));
    let tail = LogTail::default();
    let (tx, _rx) = mpsc::unbounded_channel();
    let client = McpClient::start(&cfg, tail.clone(), tx, None).await.unwrap();
    client.initialize().await.unwrap();
    assert_eq!(client.info().name.as_deref(), Some("http-fixture"));
    assert_eq!(client.list_tools().await.unwrap().len(), 2);

    // Answered with an SSE stream that also carries a log notification and a ping request.
    assert_eq!(client.call_tool("add", json!({"a": 2, "b": 3})).await, Ok("5".to_string()));
    // The server forgets the session: the next request gets 404, we initialize again and retry.
    assert_eq!(client.call_tool("expire", json!({})).await, Ok("ok".to_string()));
    assert_eq!(client.call_tool("add", json!({"a": 2.5, "b": 0.5})).await, Ok("3".to_string()));

    let stats = http_stats(port).await;
    assert_eq!(stats["inits"], 2, "{stats}");
    assert_eq!(stats["pings"], 2, "{stats}");
    assert_eq!(stats["bad_version"], 0, "{stats}");
    assert!(tail.snapshot().contains(&"[info] adding".to_string()));

    // close() ends the session with DELETE.
    client.close().await;
    let stats = http_stats(port).await;
    assert_eq!(stats["deletes"], 1, "{stats}");
    assert_eq!(stats["sessions"], 0, "{stats}");
}

#[tokio::test]
async fn http_manager_and_friendly_errors() {
    let Some((_child, port)) = http_fixture().await else { return };
    let mgr = McpManager::default();

    let cfg = http_config("http-mgr", format!("http://127.0.0.1:{port}/mcp"), Some("test-token-123"));
    mgr.connect_with(None, &cfg).await.unwrap();
    assert_eq!(mgr.call_tool("http-mgr", "add", json!({"a": 2, "b": 3})).await, Ok("5".to_string()));
    mgr.shutdown().await;

    let old = mgr.test(&http_config("old", format!("http://127.0.0.1:{port}/old"), Some("test-token-123"))).await;
    let err = old.error.unwrap();
    assert!(err.contains("old SSE transport, which fmGUI does not support yet"), "{err}");

    let no_token = mgr.test(&http_config("auth", format!("http://127.0.0.1:{port}/mcp"), None)).await;
    assert!(no_token.error.unwrap().contains("refused access (HTTP 401)"));

    let nothing = mgr.test(&http_config("down", "http://127.0.0.1:9/mcp".into(), None)).await;
    assert!(nothing.error.unwrap().starts_with("Could not reach http://127.0.0.1:9/mcp."));

    let bad_url = mgr.test(&http_config("bad", "localhost:3000/mcp".into(), None)).await;
    assert!(bad_url.error.unwrap().contains("must start with http:// or https://"));
}

/// The real reference server. Run with: MCP_NPX=1 cargo test real_server -- --nocapture
#[tokio::test]
async fn real_server_everything() {
    if std::env::var("MCP_NPX").ok().as_deref() != Some("1") {
        eprintln!("skipping: set MCP_NPX=1 to run npx -y @modelcontextprotocol/server-everything");
        return;
    }
    let cfg = McpServerConfig {
        id: "everything".into(),
        name: "Everything".into(),
        enabled: true,
        transport: McpTransport::Stdio {
            command: "npx".into(),
            args: vec!["-y".into(), "@modelcontextprotocol/server-everything".into()],
            env: vec![],
            cwd: None,
        },
        disabled_tools: vec![],
        approval: Approval::Ask,
    };
    let mgr = McpManager::default();
    let test = mgr.test(&cfg).await;
    eprintln!(
        "test(): ok={} error={:?} server={:?} {:?} tools={:?} in {} ms",
        test.ok,
        test.error,
        test.server_name,
        test.server_version,
        test.tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        test.duration_ms
    );
    assert!(test.ok, "{:?}\n{:?}", test.error, test.stderr_tail);

    mgr.connect_with(None, &cfg).await.unwrap();
    let echo = mgr.call_tool("everything", "echo", json!({"message": "hello from fmGUI"})).await;
    eprintln!("echo → {echo:?}");
    assert!(echo.unwrap().contains("hello from fmGUI"));
    let names: Vec<String> = mgr.tools().await.into_iter().map(|t| t.name).collect();
    for image_tool in ["get-tiny-image", "getTinyImage"] {
        if names.iter().any(|n| n == image_tool) {
            let out = mgr.call_tool("everything", image_tool, json!({})).await;
            eprintln!("{image_tool} → {out:?}");
            assert!(out.unwrap().contains("[image image/png]"));
        }
    }
    for sum_tool in ["get-sum", "add"] {
        if names.iter().any(|n| n == sum_tool) {
            let out = mgr.call_tool("everything", sum_tool, json!({"a": 2, "b": 3})).await;
            eprintln!("{sum_tool} → {out:?}");
            assert!(out.unwrap().contains('5'));
        }
    }
    mgr.shutdown().await;
}

/// A server that ignores the closed stdin: close() stops it and its children.
#[tokio::test]
async fn close_stops_a_stubborn_server_and_its_children() {
    let tail = LogTail::default();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let spec = super::stdio::StdioSpec {
        command: "/bin/sh".into(),
        args: vec!["-c".into(), "sleep 300 & echo child=$! >&2; wait".into()],
        env: vec![],
        cwd: None,
        pid_file: None,
    };
    let transport = super::stdio::StdioTransport::spawn(spec, tail.clone(), tx).await.unwrap();
    let mut child_pid = None;
    for _ in 0..100 {
        child_pid = tail.snapshot().iter().find_map(|l| l.strip_prefix("child=").map(str::to_string));
        if child_pid.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let child_pid = child_pid.expect("the shell printed its child pid");
    let alive =
        |pid: &str| std::process::Command::new("/bin/kill").args(["-0", pid]).output().unwrap().status.success();
    assert!(alive(&child_pid));
    transport.close().await;
    let mut gone = false;
    for _ in 0..50 {
        if !alive(&child_pid) {
            gone = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(gone, "the grandchild survived");
    assert!(rx.try_recv().is_err(), "closing on purpose sends no event");
}
