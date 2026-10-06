//! User-defined tools: shell command, HTTP request, Apple Shortcut.
//!
//! Model arguments are never spliced into a shell command: a shell tool gets
//! them as `FM_ARG_<NAME>` environment variables and as JSON on stdin, so
//! text like `$(rm -rf ~)` stays plain text. HTTP placeholders are escaped
//! for the place they go (URL, JSON, form body).

use super::builtin::{
    body_to_text, describe_output, describe_reqwest_error, expand_tilde, http_client, read_limited, run_shortcut,
    shell_command,
};
use super::process::run_process;
use crate::config::{CustomTool, CustomToolKind};
use serde_json::Value;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

pub fn timeout_of(tool: &CustomTool) -> Duration {
    let secs = match &tool.kind {
        CustomToolKind::Shell { timeout_secs, .. }
        | CustomToolKind::Http { timeout_secs, .. }
        | CustomToolKind::Shortcut { timeout_secs, .. } => *timeout_secs,
    };
    Duration::from_secs(secs.clamp(1, 600))
}

pub async fn run(tool: &CustomTool, args: &Value, tmp_dir: &Path) -> Result<String, String> {
    let args = match args {
        Value::Object(_) => args.clone(),
        Value::Null => Value::Object(Default::default()),
        _ => return Err("The arguments must be a JSON object.".into()),
    };
    let timeout = timeout_of(tool);
    match &tool.kind {
        CustomToolKind::Shell { command, cwd, .. } => run_shell(command, cwd.as_deref(), &args, timeout).await,
        CustomToolKind::Http { method, url, headers, body, .. } => {
            let headers: Vec<(String, String)> = headers.iter().map(|h| (h.key.clone(), h.value.clone())).collect();
            run_http(method, url, &headers, body.as_deref(), &args, timeout).await
        }
        CustomToolKind::Shortcut { shortcut_name, .. } => {
            let input = shortcut_input(tool, &args);
            run_shortcut(shortcut_name, input.as_deref().map(str::as_bytes), tmp_dir, timeout).await
        }
    }
}

/// Text form of an argument value (strings without quotes).
pub fn value_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// `order_id` → `FM_ARG_ORDER_ID`.
pub fn env_name(param: &str) -> String {
    let upper: String =
        param.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' }).collect();
    format!("FM_ARG_{upper}")
}

async fn run_shell(command: &str, cwd: Option<&str>, args: &Value, timeout: Duration) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("This tool has no command.".into());
    }
    let mut cmd = shell_command(command);
    if let Some(map) = args.as_object() {
        for (k, v) in map {
            cmd.env(env_name(k), value_text(v));
        }
    }
    let dir = cwd.map(str::trim).filter(|c| !c.is_empty()).map(expand_tilde).or_else(dirs::home_dir);
    if let Some(dir) = dir {
        if !dir.is_dir() {
            return Err(format!("The working folder {} does not exist.", dir.display()));
        }
        cmd.current_dir(dir);
    }
    let stdin = serde_json::to_vec(args).unwrap_or_default();
    let out = run_process(cmd, Some(stdin), timeout).await?;
    describe_output(&out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Escape {
    /// Percent-encoded (URLs).
    Url,
    /// JSON string content, without the quotes.
    Json,
    /// As is.
    Raw,
}

/// Replaces `{{name}}` placeholders with argument values. Unknown names
/// become empty text.
pub fn fill_template(template: &str, args: &Value, escape: Escape) -> String {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}").expect("valid regex"));
    re.replace_all(template, |caps: &regex::Captures| {
        let value = args.get(&caps[1]).map(value_text).unwrap_or_default();
        match escape {
            Escape::Url => percent_encode(&value),
            Escape::Json => {
                let quoted = serde_json::to_string(&value).unwrap_or_default();
                quoted.strip_prefix('"').and_then(|q| q.strip_suffix('"')).unwrap_or_default().to_string()
            }
            Escape::Raw => value,
        }
    })
    .into_owned()
}

/// RFC 3986 percent-encoding: only unreserved characters stay.
pub fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The body template is JSON when it starts with `{` or `[`.
pub fn body_is_json(body: &str) -> bool {
    matches!(body.trim_start().chars().next(), Some('{') | Some('['))
}

pub async fn run_http(
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: Option<&str>,
    args: &Value,
    timeout: Duration,
) -> Result<String, String> {
    let url_text = fill_template(url.trim(), args, Escape::Url);
    let parsed = reqwest::Url::parse(&url_text).map_err(|_| format!("\"{url_text}\" is not a valid URL."))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http and https URLs are allowed.".into());
    }
    let method = reqwest::Method::from_bytes(method.trim().to_ascii_uppercase().as_bytes())
        .map_err(|_| format!("\"{method}\" is not a valid HTTP method."))?;
    let client = http_client(timeout)?;
    let mut req = client.request(method, parsed);
    let mut content_type: Option<String> = None;
    for (key, value) in headers {
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        // Header values with line breaks are refused by the HTTP library,
        // so a placeholder cannot add headers.
        let value = fill_template(value, args, Escape::Raw);
        if key.eq_ignore_ascii_case("content-type") {
            content_type = Some(value.to_ascii_lowercase());
        }
        req = req.header(key, value);
    }
    let has_content_type = content_type.is_some();
    if let Some(body) = body.filter(|b| !b.trim().is_empty()) {
        let json = body_is_json(body);
        let form = content_type.as_deref().is_some_and(|ct| ct.contains("x-www-form-urlencoded"));
        // Escape for the place the value goes, so `a&admin=1` stays one value.
        let escape = if json {
            Escape::Json
        } else if form {
            Escape::Url
        } else {
            Escape::Raw
        };
        let filled = fill_template(body, args, escape);
        if json && !has_content_type {
            req = req.header("content-type", "application/json");
        }
        req = req.body(filled);
    }
    let resp = req.send().await.map_err(|e| describe_reqwest_error(&e))?;
    let status = resp.status();
    let content_type = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let (bytes, cut) = read_limited(resp).await?;
    let mut text = body_to_text(&content_type, &bytes).unwrap_or_else(|e| e);
    if cut {
        text.push_str("\n…[reply cut at 2 MB]");
    }
    let out = format!("HTTP {}\n\n{}", status.as_u16(), text);
    if status.is_success() {
        Ok(out)
    } else {
        Err(out)
    }
}

/// Shortcut input: the single argument's value, or all arguments as JSON.
pub fn shortcut_input(tool: &CustomTool, args: &Value) -> Option<String> {
    let map = args.as_object()?;
    if map.is_empty() {
        return None;
    }
    if tool.params.len() <= 1 && map.len() == 1 {
        return map.values().next().map(value_text);
    }
    Some(Value::Object(map.clone()).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Approval, KeyValue, ParamType, ToolParam};
    use serde_json::json;

    fn shell_tool(command: &str) -> CustomTool {
        CustomTool {
            id: "t1".into(),
            name: "lookup_order".into(),
            description: "Look up an order".into(),
            params: vec![ToolParam {
                name: "order_id".into(),
                kind: ParamType::String,
                description: String::new(),
                required: true,
            }],
            kind: CustomToolKind::Shell { command: command.into(), cwd: None, timeout_secs: 10 },
            enabled: true,
            approval: Approval::Always,
        }
    }

    #[test]
    fn templates_escape_per_place() {
        let args = json!({"q": "a b&c/é", "n": 3, "quote": "say \"hi\"\n"});
        assert_eq!(
            fill_template("https://x.test/s?q={{q}}&n={{ n }}", &args, Escape::Url),
            "https://x.test/s?q=a%20b%26c%2F%C3%A9&n=3"
        );
        assert_eq!(fill_template("Bearer {{q}}", &args, Escape::Raw), "Bearer a b&c/é");
        assert_eq!(
            fill_template(r#"{"text": "{{quote}}", "n": {{n}}}"#, &args, Escape::Json),
            r#"{"text": "say \"hi\"\n", "n": 3}"#
        );
        assert_eq!(fill_template("x={{missing}}", &args, Escape::Raw), "x=");
        assert!(body_is_json("  {\"a\": 1}"));
        assert!(body_is_json("[1]"));
        assert!(!body_is_json("a={{q}}"));
        // JSON values cannot break out of their string or add keys.
        let evil = json!({"v": "x\", \"admin\": true, \"y\": \""});
        let body = fill_template(r#"{"name": "{{v}}"}"#, &evil, Escape::Json);
        let parsed: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed.as_object().unwrap().len(), 1);
        assert_eq!(parsed["name"], evil["v"]);
        // URL values cannot add path parts, query parameters or fragments.
        let evil = json!({"v": "../admin?x=1&y=2#z /\r\n"});
        assert_eq!(fill_template("{{v}}", &evil, Escape::Url), "..%2Fadmin%3Fx%3D1%26y%3D2%23z%20%2F%0D%0A");
    }

    #[test]
    fn env_names() {
        assert_eq!(env_name("order_id"), "FM_ARG_ORDER_ID");
        assert_eq!(env_name("city-name"), "FM_ARG_CITY_NAME");
    }

    #[tokio::test]
    async fn shell_tool_gets_env_and_stdin() {
        let tmp = tempfile::tempdir().unwrap();
        let tool = shell_tool(r#"echo "Order $FM_ARG_ORDER_ID is in transit"; cat"#);
        let out = run(&tool, &json!({"order_id": "A-7781"}), tmp.path()).await.unwrap();
        assert_eq!(out, "Order A-7781 is in transit\n{\"order_id\":\"A-7781\"}");
    }

    #[tokio::test]
    async fn shell_tool_never_splices_arguments() {
        let tmp = tempfile::tempdir().unwrap();
        let tool = shell_tool(r#"printf '%s' "$FM_ARG_ORDER_ID""#);
        let out = run(&tool, &json!({"order_id": "$(echo pwned); `id`"}), tmp.path()).await.unwrap();
        assert_eq!(out, "$(echo pwned); `id`");
    }

    #[tokio::test]
    async fn shell_tool_reports_exit_code() {
        let tmp = tempfile::tempdir().unwrap();
        let tool = shell_tool("echo nope >&2; exit 2");
        assert_eq!(run(&tool, &json!({}), tmp.path()).await.unwrap_err(), "Exit code 2\nnope");
    }

    #[test]
    fn shortcut_input_shapes() {
        let mut tool = shell_tool("");
        tool.kind = CustomToolKind::Shortcut { shortcut_name: "Hello".into(), timeout_secs: 10 };
        assert_eq!(shortcut_input(&tool, &json!({"order_id": "A-1"})).as_deref(), Some("A-1"));
        assert_eq!(shortcut_input(&tool, &json!({})), None);
        tool.params.push(ToolParam { name: "b".into(), ..Default::default() });
        assert_eq!(
            shortcut_input(&tool, &json!({"order_id": "A-1", "b": 2})).as_deref(),
            Some(r#"{"b":2,"order_id":"A-1"}"#)
        );
    }

    /// A tiny one-shot HTTP server on 127.0.0.1 for the HTTP tool test.
    async fn serve_once(reply: &'static str) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let mut req = Vec::new();
            loop {
                let n = sock.read(&mut buf).await.unwrap();
                req.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&req).to_string();
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let len = text
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if req.len() >= head_end + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            sock.write_all(reply.as_bytes()).await.unwrap();
            let _ = sock.shutdown().await;
            String::from_utf8_lossy(&req).to_string()
        });
        (format!("http://{addr}"), handle)
    }

    #[tokio::test]
    async fn http_tool_fills_templates_and_converts_html() {
        let (base, handle) = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 46\r\nConnection: close\r\n\r\n<html><body><p>Order shipped</p></body></html>",
        )
        .await;
        let out = run_http(
            "post",
            &format!("{base}/orders/{{{{order_id}}}}"),
            &[("X-Token".into(), "t-{{order_id}}".into())],
            Some(r#"{"id": "{{order_id}}"}"#),
            &json!({"order_id": "A 77\"81"}),
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        assert_eq!(out, "HTTP 200\n\nOrder shipped");
        let req = handle.await.unwrap();
        assert!(req.starts_with("POST /orders/A%2077%2281 HTTP/1.1"), "{req}");
        assert!(req.to_ascii_lowercase().contains("x-token: t-a 77\"81"), "{req}");
        assert!(req.to_ascii_lowercase().contains("content-type: application/json"), "{req}");
        assert!(req.ends_with(r#"{"id": "A 77\"81"}"#), "{req}");
    }

    #[tokio::test]
    async fn http_tool_escapes_form_bodies_and_refuses_header_injection() {
        let (base, handle) = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
        )
        .await;
        let headers = [("Content-Type".to_string(), "application/x-www-form-urlencoded".to_string())];
        let args = json!({"q": "a&admin=1"});
        run_http("POST", &base, &headers, Some("q={{q}}"), &args, Duration::from_secs(5)).await.unwrap();
        let req = handle.await.unwrap();
        assert!(req.ends_with("q=a%26admin%3D1"), "{req}");

        // A line break in a header value is refused before anything is sent.
        let headers = [("X-Token".to_string(), "{{t}}".to_string())];
        let args = json!({"t": "ok\r\nX-Admin: 1"});
        let err = run_http("GET", "http://127.0.0.1:9/", &headers, None, &args, Duration::from_secs(5)).await;
        let err = err.unwrap_err();
        assert!(err.starts_with("Request failed") && !err.contains("connect"), "{err}");
    }

    #[tokio::test]
    async fn http_tool_reports_errors() {
        let (base, _h) = serve_once("HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 7\r\nConnection: close\r\n\r\nmissing").await;
        let err = run_http("GET", &base, &[], None, &json!({}), Duration::from_secs(5)).await.unwrap_err();
        assert_eq!(err, "HTTP 404\n\nmissing");
        let _ = KeyValue::default();
    }
}
