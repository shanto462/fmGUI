//! Tests against the real `/usr/bin/fm`. They only run with `FM_INTEGRATION=1`
//! (they need macOS 27, the agreed license and the on-device model):
//! `FM_INTEGRATION=1 cargo test fm::integration_tests`

use super::public_server::{EventSink, PublicServer, ServerEvent};
use super::*;
use crate::config::PublicServerConfig;
use std::sync::{Arc, Mutex as StdMutex};

const FM: &str = "/usr/bin/fm";

fn enabled() -> bool {
    let on = std::env::var("FM_INTEGRATION").as_deref() == Ok("1");
    if !on {
        eprintln!("skipped: set FM_INTEGRATION=1 to run tests against the real fm");
    }
    on
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| s.to_string()).collect()
}

fn collecting_sink() -> (EventSink, Arc<StdMutex<Vec<ServerEvent>>>) {
    let events = Arc::new(StdMutex::new(Vec::new()));
    let e2 = events.clone();
    (Arc::new(move |ev| e2.lock().unwrap().push(ev)), events)
}

#[tokio::test]
async fn fm_available() {
    if !enabled() {
        return;
    }
    let r = run_collect(FM, &strings(&["available"])).await.unwrap();
    assert_eq!(r.exit_code, 0, "{r:?}");
    assert!(r.stdout.contains("available"), "{r:?}");
    assert_eq!(r.command, "fm available");
}

#[tokio::test]
async fn fm_count_tokens() {
    if !enabled() {
        return;
    }
    let r = run_collect(FM, &strings(&["count-tokens", "--quiet", "--", "Hello world"])).await.unwrap();
    assert_eq!(r.exit_code, 0, "{r:?}");
    assert_eq!(r.stdout.trim(), "3");
}

#[tokio::test]
async fn fm_status_check() {
    if !enabled() {
        return;
    }
    let s = status::check(FM, 8192).await;
    assert!(s.binary_found && s.model_available && s.license_agreed, "{s:?}");
    assert!(s.macos_version.starts_with("27"), "{s:?}");
}

#[tokio::test]
async fn fm_respond_no_stream_and_stream() {
    if !enabled() {
        return;
    }
    let events = Arc::new(StdMutex::new(Vec::new()));
    let sink = events.clone();
    let args = strings(&["respond", "--no-stream", "-i", "Answer in one short sentence.", "Say hello."]);
    let r = run_streaming(FM, &args, CancellationToken::new(), move |e| sink.lock().unwrap().push(e)).await.unwrap();
    assert_eq!(r.exit_code, 0, "{r:?}");
    assert!(!r.stdout.trim().is_empty());
    assert!(r.error.is_none() && !r.cancelled);
    assert!(r.first_output_ms.is_some());
    {
        let events = events.lock().unwrap();
        assert!(matches!(&events[0], RunEvent::Started { command } if command.starts_with("fm respond --no-stream")));
        assert!(events.iter().any(|e| matches!(e, RunEvent::Stdout { .. })));
    }

    // Default mode streams tokens even through a pipe: expect several chunks.
    let events = Arc::new(StdMutex::new(Vec::new()));
    let sink = events.clone();
    let args = strings(&["respond", "Write four short sentences about the sea."]);
    let r = run_streaming(FM, &args, CancellationToken::new(), move |e| sink.lock().unwrap().push(e)).await.unwrap();
    assert_eq!(r.exit_code, 0, "{r:?}");
    let chunks = events.lock().unwrap().iter().filter(|e| matches!(e, RunEvent::Stdout { .. })).count();
    assert!(chunks > 1, "expected streamed chunks, got {chunks}");
}

#[tokio::test]
async fn fm_respond_cancel() {
    if !enabled() {
        return;
    }
    let token = CancellationToken::new();
    let t2 = token.clone();
    let args = strings(&["respond", "Write a long story about a lighthouse keeper, at least 600 words."]);
    let r = run_streaming(FM, &args, token, move |e| {
        if matches!(e, RunEvent::Stdout { .. }) {
            t2.cancel();
        }
    })
    .await
    .unwrap();
    assert!(r.cancelled, "{r:?}");
    assert!(r.error.is_none());
    assert!(r.duration_ms < 20_000, "{r:?}");
}

#[tokio::test]
async fn fm_usage_error_is_short() {
    if !enabled() {
        return;
    }
    // No prompt and stdin is /dev/null: fm prints an error plus its help screen.
    let r = run_collect(FM, &strings(&["respond"])).await.unwrap();
    assert_ne!(r.exit_code, 0);
    let err = r.error.unwrap();
    assert!(err.starts_with("Missing prompt."), "{err}");
    assert!(!err.contains("OPTIONS"), "{err}");
}

#[tokio::test]
async fn fm_license_show() {
    if !enabled() {
        return;
    }
    let text = commands::license_text(FM).await.unwrap();
    assert!(text.contains("LEGAL NOTICE"), "{text}");
    assert!(!text.contains('\u{1B}'));
}

#[tokio::test]
async fn public_server_on_socket() {
    if !enabled() {
        return;
    }
    // TMPDIR keeps the socket path well under the 103-byte macOS limit.
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fm.sock");
    // A stale socket file from a crashed server must not block the start.
    // (Made by a killed `fm serve`, not by a listener in this process: a
    // listener here could leak into a child spawned by a parallel test.)
    let mut crashed = std::process::Command::new(FM)
        .args(["serve", "--socket", socket.to_str().unwrap()])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    for _ in 0..50 {
        if socket.exists() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    crashed.kill().unwrap(); // SIGKILL: fm cannot remove its socket
    crashed.wait().unwrap();
    assert!(socket.exists(), "stale socket should be left behind");

    let server = PublicServer::default();
    let (sink, events) = collecting_sink();
    let config =
        PublicServerConfig { mode: "socket".into(), socket_path: socket.display().to_string(), ..Default::default() };
    let status = server.start_with(FM, &config, sink.clone()).await.unwrap();
    let result = async {
        assert!(status.running && status.pid.is_some(), "{status:?}");
        assert_eq!(status.socket_path.as_deref(), Some(socket.to_str().unwrap()));

        let health = server.request("GET", "/health", None).await.unwrap();
        assert_eq!(health.status, 200, "{health:?}");
        assert!(health.body.contains("fm serve is running"), "{health:?}");

        let body = r#"{"model":"system","stream":false,"messages":[{"role":"user","content":"Say hi"}]}"#;
        let reply = server.request("post", "v1/chat/completions", Some(body.into())).await.unwrap();
        assert_eq!(reply.status, 200, "{reply:?}");
        let json: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
        assert!(json.pointer("/choices/0/message/content").is_some(), "{json}");

        let body = r#"{"model":"system","messages":[{"role":"user","content":"Say hi"}]}"#;
        let streamed = server.request("POST", "/v1/chat/completions", Some(body.into())).await.unwrap();
        assert_eq!(streamed.status, 200);
        assert!(streamed.body.contains("data: [DONE]"), "{streamed:?}");

        // Logs arrive live (NSUnbufferedIO), not only at exit.
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let logs = server.status().logs;
        assert!(logs.iter().any(|l| l.line.contains("/health")), "{logs:?}");
    }
    .await;

    let stopped = server.stop_with(sink).await;
    assert!(!stopped.running && stopped.last_error.is_none(), "{stopped:?}");
    assert!(!socket.exists(), "fm removes its socket on exit");
    assert!(events.lock().unwrap().iter().any(|e| matches!(e, ServerEvent::Log(_))));
    result
}

#[tokio::test]
async fn public_server_on_tcp() {
    if !enabled() {
        return;
    }
    let port = free_port();
    let server = PublicServer::default();
    let (sink, _) = collecting_sink();
    let config = PublicServerConfig { mode: "tcp".into(), host: "127.0.0.1".into(), port, ..Default::default() };
    let status = server.start_with(FM, &config, sink.clone()).await.unwrap();
    let url = status.url.clone();
    let health = server.request("GET", "/health", None).await;

    // A second server on the same port fails with a clear message.
    let second = PublicServer::default();
    let clash = second.start_with(FM, &config, sink.clone()).await;

    server.stop_with(sink).await;
    assert_eq!(url, Some(format!("http://127.0.0.1:{port}")));
    let health = health.unwrap();
    assert_eq!(health.status, 200, "{health:?}");
    assert!(clash.unwrap_err().contains("already in use"));
}

/// A port in 20000..40000 (below the macOS ephemeral range) where nothing
/// listens. Found by connecting, not binding, for the same leak reason as above.
fn free_port() -> u16 {
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos();
    (0..200u32)
        .map(|i| 20000 + ((seed / 1000 + i * 7919) % 20000) as u16)
        .find(|p| {
            let addr = std::net::SocketAddr::from(([127, 0, 0, 1], *p));
            std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(200)).is_err()
        })
        .expect("no free port found")
}
