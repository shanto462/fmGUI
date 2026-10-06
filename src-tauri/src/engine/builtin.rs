//! Built-in tools: date/time, calculator, fetch_url, Spotlight, file tools,
//! shell, clipboard, open_url, Shortcuts.

use super::process::{run_process, ProcOutput};
use crate::config::{Approval, ParamType};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Builtin {
    CurrentDatetime,
    Calculator,
    FetchUrl,
    SpotlightSearch,
    ReadFile,
    ListDirectory,
    WriteFile,
    RunShellCommand,
    ReadClipboard,
    OpenUrl,
    RunShortcut,
}

/// One parameter: (name, type, description, required).
pub type ParamSpec = (&'static str, ParamType, &'static str, bool);

pub struct BuiltinSpec {
    pub kind: Builtin,
    pub name: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub default_enabled: bool,
    pub default_approval: Approval,
    pub dangerous: bool,
    pub params: &'static [ParamSpec],
    pub timeout_secs: u64,
}

use Approval::{Always, Ask};
use ParamType::String as Str;

pub const BUILTINS: &[BuiltinSpec] = &[
    BuiltinSpec {
        kind: Builtin::CurrentDatetime,
        name: "get_current_datetime",
        title: "Current date and time",
        description: "Get the current local date, time, weekday and time zone.",
        default_enabled: true,
        default_approval: Always,
        dangerous: false,
        params: &[],
        timeout_secs: 5,
    },
    BuiltinSpec {
        kind: Builtin::Calculator,
        name: "calculator",
        title: "Calculator",
        description: "Calculate a math expression exactly, e.g. (12.5 * 4) / 3, 2^10 or sqrt(2). Use it for all arithmetic.",
        default_enabled: true,
        default_approval: Always,
        dangerous: false,
        params: &[("expression", Str, "The math expression to calculate.", true)],
        timeout_secs: 5,
    },
    BuiltinSpec {
        kind: Builtin::FetchUrl,
        name: "fetch_url",
        title: "Fetch web page",
        description: "Download a web page (http or https) and return its readable text.",
        default_enabled: true,
        default_approval: Ask,
        dangerous: false,
        params: &[("url", Str, "Full URL starting with https://", true)],
        timeout_secs: 20,
    },
    BuiltinSpec {
        kind: Builtin::SpotlightSearch,
        name: "spotlight_search",
        title: "Spotlight search",
        description: "Search the user's own files and documents on this Mac (Spotlight). Use it only when the user asks to find a file. Returns up to 20 file paths.",
        default_enabled: true,
        default_approval: Always,
        dangerous: false,
        params: &[("query", Str, "Words to search for, e.g. a file name or topic.", true)],
        timeout_secs: 20,
    },
    BuiltinSpec {
        kind: Builtin::ReadFile,
        name: "read_file",
        title: "Read file",
        description: "Read a text file. Only files inside the folders the user allowed.",
        default_enabled: false,
        default_approval: Always,
        dangerous: false,
        params: &[("path", Str, "Absolute path or ~/path of the file.", true)],
        timeout_secs: 10,
    },
    BuiltinSpec {
        kind: Builtin::ListDirectory,
        name: "list_directory",
        title: "List folder",
        description: "List the files in a folder. Only inside the folders the user allowed.",
        default_enabled: false,
        default_approval: Always,
        dangerous: false,
        params: &[("path", Str, "Absolute path or ~/path of the folder.", true)],
        timeout_secs: 10,
    },
    BuiltinSpec {
        kind: Builtin::WriteFile,
        name: "write_file",
        title: "Write file",
        description: "Write text to a file (creates or replaces it). Only inside the folders the user allowed.",
        default_enabled: false,
        default_approval: Ask,
        dangerous: true,
        params: &[
            ("path", Str, "Absolute path or ~/path of the file.", true),
            ("content", Str, "The full text to write.", true),
        ],
        timeout_secs: 10,
    },
    BuiltinSpec {
        kind: Builtin::RunShellCommand,
        name: "run_shell_command",
        title: "Run shell command",
        description: "Run a zsh command on this Mac and return its output.",
        default_enabled: false,
        default_approval: Ask,
        dangerous: true,
        params: &[("command", Str, "The zsh command line to run.", true)],
        timeout_secs: 30,
    },
    BuiltinSpec {
        kind: Builtin::ReadClipboard,
        name: "read_clipboard",
        title: "Read clipboard",
        description: "Read the text that is on the clipboard.",
        default_enabled: false,
        default_approval: Ask,
        dangerous: false,
        params: &[],
        timeout_secs: 5,
    },
    BuiltinSpec {
        kind: Builtin::OpenUrl,
        name: "open_url",
        title: "Open link",
        description: "Open a web link in the default browser.",
        default_enabled: false,
        default_approval: Ask,
        dangerous: false,
        params: &[("url", Str, "Full URL starting with https://", true)],
        timeout_secs: 10,
    },
    BuiltinSpec {
        kind: Builtin::RunShortcut,
        name: "run_shortcut",
        title: "Run shortcut",
        description: "Run an Apple Shortcut by its name, with optional text input. Returns its output.",
        default_enabled: false,
        default_approval: Ask,
        dangerous: true,
        params: &[
            ("name", Str, "Exact name of the shortcut.", true),
            ("input", Str, "Text input for the shortcut.", false),
        ],
        timeout_secs: 60,
    },
];

pub fn spec(kind: Builtin) -> &'static BuiltinSpec {
    // Not input-dependent: the `every_builtin_has_one_spec` test checks it.
    BUILTINS.iter().find(|s| s.kind == kind).expect("every builtin has a spec")
}

/// What a built-in tool needs from the app.
pub struct BuiltinEnv<'a> {
    pub allowed_folders: &'a [String],
    pub tmp_dir: &'a Path,
}

pub async fn run(kind: Builtin, args: &Value, env: &BuiltinEnv<'_>) -> Result<String, String> {
    match kind {
        Builtin::CurrentDatetime => Ok(current_datetime()),
        Builtin::Calculator => calculate(arg_str(args, "expression")?),
        Builtin::FetchUrl => fetch_url(arg_str(args, "url")?).await,
        Builtin::SpotlightSearch => spotlight(arg_str(args, "query")?).await,
        Builtin::ReadFile => read_file(arg_str(args, "path")?, env.allowed_folders),
        Builtin::ListDirectory => list_directory(arg_str(args, "path")?, env.allowed_folders),
        Builtin::WriteFile => {
            write_file(arg_str(args, "path")?, arg_str(args, "content").unwrap_or(""), env.allowed_folders)
        }
        Builtin::RunShellCommand => run_shell(arg_str(args, "command")?).await,
        Builtin::ReadClipboard => read_clipboard().await,
        Builtin::OpenUrl => open_url(arg_str(args, "url")?).await,
        Builtin::RunShortcut => {
            let input = args.get("input").and_then(Value::as_str).filter(|s| !s.is_empty());
            run_shortcut(arg_str(args, "name")?, input.map(str::as_bytes), env.tmp_dir, Duration::from_secs(60)).await
        }
    }
}

/// A required string argument.
pub fn arg_str<'v>(args: &'v Value, name: &str) -> Result<&'v str, String> {
    args.get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("The argument \"{name}\" is missing."))
}

// ---------- date and time ----------

pub fn current_datetime() -> String {
    let now = chrono::Local::now();
    let zone = std::fs::read_link("/etc/localtime")
        .ok()
        .and_then(|p| p.to_str().and_then(|s| s.split("zoneinfo/").nth(1)).map(str::to_string))
        .unwrap_or_default();
    let offset = now.format("UTC%:z").to_string();
    let zone = if zone.is_empty() { offset } else { format!("{zone}, {offset}") };
    format!(
        "Date: {}\nTime: {} ({zone})\nISO 8601: {}",
        now.format("%A, %-d %B %Y"),
        now.format("%H:%M:%S"),
        now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false)
    )
}

// ---------- calculator ----------

pub fn calculate(expression: &str) -> Result<String, String> {
    use evalexpr::{ContextWithMutableVariables, DefaultNumericTypes, HashMapContext, Value as EV};
    let prepared = prepare_expression(expression);
    let mut ctx = HashMapContext::<DefaultNumericTypes>::new();
    let _ = ctx.set_value("pi".into(), EV::Float(std::f64::consts::PI));
    let _ = ctx.set_value("e".into(), EV::Float(std::f64::consts::E));
    let value = evalexpr::eval_with_context(&prepared, &ctx)
        .map_err(|e| format!("Could not calculate \"{expression}\": {e}"))?;
    let result = match value {
        EV::Float(f) => format_number(f),
        EV::Int(i) => i.to_string(),
        EV::Boolean(b) => b.to_string(),
        EV::Tuple(items) => items
            .iter()
            .map(|v| match v {
                EV::Float(f) => format_number(*f),
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join(", "),
        EV::String(s) => s,
        EV::Empty => return Err(format!("\"{expression}\" has no value.")),
    };
    Ok(format!("{} = {result}", expression.trim()))
}

/// Makes common math notation work with evalexpr: ×, ÷, **, π, sqrt(),
/// thousands separators, and float division (7/2 = 3.5, not 3).
pub fn prepare_expression(expr: &str) -> String {
    static FUNCS: OnceLock<regex::Regex> = OnceLock::new();
    static THOUSANDS: OnceLock<regex::Regex> = OnceLock::new();
    let mut s = expr
        .trim()
        .replace(['×', '·', '∙'], "*")
        .replace('÷', "/")
        .replace(['−', '–'], "-")
        .replace("**", "^")
        .replace('π', "pi");
    if !s.contains('(') {
        let re = THOUSANDS.get_or_init(|| regex::Regex::new(r"(\d),(\d{3})").unwrap());
        loop {
            let next = re.replace_all(&s, "$1$2").into_owned();
            if next == s {
                break;
            }
            s = next;
        }
    }
    let re = FUNCS.get_or_init(|| {
        regex::Regex::new(
            r"(^|[^:\w])(sqrt|cbrt|abs|ln|log|log2|log10|exp|exp2|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|hypot)\s*\(",
        )
        .unwrap()
    });
    // Run twice: adjacent matches share the separator character.
    for _ in 0..2 {
        s = re.replace_all(&s, "${1}math::${2}(").into_owned();
    }
    integers_to_floats(&s)
}

/// `7 / 2` → `7.0 / 2.0` so evalexpr does not use integer division.
fn integers_to_floats(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len() + 8);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let prev = if i > 0 { Some(chars[i - 1]) } else { None };
        let part_of_word = prev.map(|p| p.is_alphanumeric() || p == '_' || p == '.').unwrap_or(false);
        if c.is_ascii_digit() && !part_of_word {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            out.extend(&chars[start..i]);
            let next = chars.get(i).copied();
            let continues = next.map(|n| n == '.' || n.is_alphanumeric() || n == '_').unwrap_or(false);
            if !continues {
                out.push_str(".0");
            }
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Up to 12 significant digits, no trailing zeros.
pub fn format_number(f: f64) -> String {
    if f.is_nan() {
        return "not a number".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "infinity".into() } else { "-infinity".into() };
    }
    if f == 0.0 {
        return "0".into();
    }
    if f.fract() == 0.0 && f.abs() < 1e15 {
        return format!("{f:.0}");
    }
    let magnitude = f.abs().log10().floor() as i32 + 1;
    if f.abs() < 1e-6 || f.abs() >= 1e15 {
        return format!("{f:e}");
    }
    let decimals = (12 - magnitude).clamp(0, 12) as usize;
    let text = format!("{f:.decimals$}");
    let text = if text.contains('.') { text.trim_end_matches('0').trim_end_matches('.').to_string() } else { text };
    if text == "-0" {
        "0".into()
    } else {
        text
    }
}

// ---------- web ----------

const MAX_DOWNLOAD: usize = 2 * 1024 * 1024;

pub fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) fmGUI/0.1")
        .build()
        .map_err(|e| e.to_string())
}

fn check_web_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| format!("\"{url}\" is not a valid URL."))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("Only http and https links are allowed, not {other}.")),
    }
}

/// Reads at most 2 MB of a response body.
pub async fn read_limited(mut resp: reqwest::Response) -> Result<(Vec<u8>, bool), String> {
    let mut body = Vec::new();
    let mut cut = false;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Download failed: {e}"))? {
        let room = MAX_DOWNLOAD - body.len();
        if chunk.len() > room {
            body.extend_from_slice(&chunk[..room]);
            cut = true;
            break;
        }
        body.extend_from_slice(&chunk);
    }
    Ok((body, cut))
}

/// Turns a response body into text for the model (HTML → readable text).
pub fn body_to_text(content_type: &str, body: &[u8]) -> Result<String, String> {
    let ct = content_type.to_ascii_lowercase();
    let is_text = ct.is_empty()
        || ct.starts_with("text/")
        || ct.contains("json")
        || ct.contains("xml")
        || ct.contains("javascript")
        || ct.contains("x-www-form-urlencoded");
    if !is_text {
        return Err(format!("The link returned a {content_type} file, not text."));
    }
    let text = String::from_utf8_lossy(body);
    let looks_html = ct.contains("html") || {
        let head: String = text.chars().take(512).collect::<String>().to_ascii_lowercase();
        head.contains("<html") || head.contains("<!doctype html")
    };
    Ok(if looks_html { html_to_text(&text) } else { text.trim().to_string() })
}

pub async fn fetch_url(url: &str) -> Result<String, String> {
    let url = check_web_url(url)?;
    let client = http_client(Duration::from_secs(15))?;
    let resp = client.get(url.clone()).send().await.map_err(|e| describe_reqwest_error(&e))?;
    let status = resp.status();
    let content_type = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let (body, cut) = read_limited(resp).await?;
    let mut text = body_to_text(&content_type, &body)?;
    if cut {
        text.push_str("\n…[page cut at 2 MB]");
    }
    if text.trim().is_empty() {
        text = "The page has no readable text.".into();
    }
    if status.is_success() {
        Ok(text)
    } else {
        Err(format!("HTTP {}\n\n{text}", status.as_u16()))
    }
}

pub fn describe_reqwest_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "The request timed out.".into()
    } else if e.is_connect() {
        format!("Could not connect: {e}")
    } else {
        format!("Request failed: {e}")
    }
}

/// Very small HTML → text converter: drops script/style/nav/head, turns
/// block tags into line breaks, strips tags, decodes entities, collapses
/// whitespace.
pub fn html_to_text(html: &str) -> String {
    static DROP: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    static TITLE: OnceLock<regex::Regex> = OnceLock::new();
    static COMMENT: OnceLock<regex::Regex> = OnceLock::new();
    static BLOCK: OnceLock<regex::Regex> = OnceLock::new();
    static LI: OnceLock<regex::Regex> = OnceLock::new();
    static TAG: OnceLock<regex::Regex> = OnceLock::new();

    let title = TITLE
        .get_or_init(|| regex::Regex::new(r"(?is)<title[^>]*>(.*?)</title\s*>").unwrap())
        .captures(html)
        .map(|c| decode_entities(c[1].trim()))
        .filter(|t| !t.is_empty());

    let mut s =
        COMMENT.get_or_init(|| regex::Regex::new(r"(?s)<!--.*?-->").unwrap()).replace_all(html, " ").into_owned();
    let drops = DROP.get_or_init(|| {
        ["script", "style", "nav", "noscript", "svg", "template", "iframe", "head"]
            .iter()
            .map(|t| regex::Regex::new(&format!(r"(?is)<{t}\b[^>]*>.*?</{t}\s*>")).unwrap())
            .collect()
    });
    for re in drops {
        s = re.replace_all(&s, " ").into_owned();
    }
    s = LI.get_or_init(|| regex::Regex::new(r"(?i)<li\b[^>]*>").unwrap()).replace_all(&s, "\n- ").into_owned();
    s = BLOCK
        .get_or_init(|| {
            regex::Regex::new(
                r"(?i)</?(p|div|br|hr|h[1-6]|ul|ol|tr|table|section|article|header|footer|main|aside|blockquote|pre|dl|dt|dd|figure|figcaption|form|fieldset|address)\b[^>]*>",
            )
            .unwrap()
        })
        .replace_all(&s, "\n")
        .into_owned();
    s = TAG.get_or_init(|| regex::Regex::new(r"(?s)<[^>]*>").unwrap()).replace_all(&s, "").into_owned();
    let s = decode_entities(&s);
    let body = collapse_whitespace(&s);
    match title {
        Some(t) if !body.starts_with(&t) => format!("{t}\n\n{body}"),
        _ => body,
    }
}

/// Collapses runs of spaces, trims lines, keeps at most one blank line.
pub fn collapse_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut blank = 0;
    for line in s.lines() {
        let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            blank += 1;
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
            if blank > 0 {
                out.push('\n');
            }
        }
        blank = 0;
        out.push_str(&line);
    }
    out
}

pub fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find('&') {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + 1..];
        let end = after.find(';').filter(|e| *e > 0 && *e <= 10);
        let decoded = end.and_then(|e| {
            let name = &after[..e];
            let ch = if let Some(num) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
                u32::from_str_radix(num, 16).ok().and_then(char::from_u32).map(String::from)
            } else if let Some(num) = name.strip_prefix('#') {
                num.parse::<u32>().ok().and_then(char::from_u32).map(String::from)
            } else {
                named_entity(name).map(String::from)
            };
            ch.map(|c| (c, e))
        });
        match decoded {
            Some((text, e)) => {
                out.push_str(&text);
                rest = &after[e + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn named_entity(name: &str) -> Option<&'static str> {
    Some(match name {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => " ",
        "ndash" => "–",
        "mdash" => "—",
        "hellip" => "…",
        "lsquo" => "‘",
        "rsquo" => "’",
        "ldquo" => "“",
        "rdquo" => "”",
        "copy" => "©",
        "reg" => "®",
        "trade" => "™",
        "euro" => "€",
        "pound" => "£",
        "yen" => "¥",
        "cent" => "¢",
        "deg" => "°",
        "times" => "×",
        "divide" => "÷",
        "middot" => "·",
        "bull" => "•",
        "laquo" => "«",
        "raquo" => "»",
        _ => return None,
    })
}

// ---------- Spotlight ----------

async fn spotlight(query: &str) -> Result<String, String> {
    // mdfind has no `--`: a query that starts with "-" would be read as an
    // option (for example -live, which never ends).
    let query = query.trim_start_matches(['-', ' ']).trim();
    if query.is_empty() {
        return Err("The search words are empty.".into());
    }
    let mut cmd = tokio::process::Command::new("/usr/bin/mdfind");
    cmd.arg(query);
    let out = run_process(cmd, None, Duration::from_secs(15)).await?;
    let lines: Vec<&str> = out.stdout.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        if out.status != Some(0) && !out.stderr.trim().is_empty() {
            return Err(out.stderr.trim().to_string());
        }
        return Ok(format!("No files found for \"{query}\"."));
    }
    let total = lines.len();
    let mut text = lines.iter().take(20).copied().collect::<Vec<_>>().join("\n");
    if total > 20 {
        text.push_str(&format!("\n…and {} more", total - 20));
    }
    Ok(text)
}

// ---------- files (allowed folders only) ----------

const MAX_READ: usize = 200 * 1024;

pub fn expand_tilde(path: &str) -> PathBuf {
    let path = path.trim();
    if path == "~" {
        return dirs::home_dir().unwrap_or_default();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn allowed_roots(allowed: &[String]) -> Vec<PathBuf> {
    allowed.iter().filter(|a| !a.trim().is_empty()).filter_map(|a| expand_tilde(a).canonicalize().ok()).collect()
}

fn outside_error(allowed: &[String]) -> String {
    format!("This path is outside the allowed folders. Allowed folders: {}", allowed.join(", "))
}

/// Resolves `path` (with `~`, relative to the first allowed folder) and makes
/// sure it is inside an allowed folder. Symlinks and `..` are resolved first,
/// so a link inside an allowed folder that points outside is refused. With
/// `must_exist = false` (writing) only the parent folder must exist; the new
/// name may not be `..` or a symlink (a dangling link could point anywhere).
pub fn resolve_allowed(path: &str, allowed: &[String], must_exist: bool) -> Result<PathBuf, String> {
    let roots = allowed_roots(allowed);
    if roots.is_empty() {
        return Err("No folders are allowed for file tools yet. The user can add one in Settings.".into());
    }
    if path.contains('\0') {
        return Err("The path is not valid.".into());
    }
    let mut p = expand_tilde(path);
    if p.is_relative() {
        p = roots[0].join(p);
    }
    let resolved = match std::fs::symlink_metadata(&p) {
        // Exists (maybe as a symlink): follow every link. A dangling link fails here.
        Ok(_) => p.canonicalize().map_err(|_| format!("{} does not exist.", p.display()))?,
        Err(_) if must_exist => return Err(format!("{} does not exist.", p.display())),
        Err(_) => {
            let name = p.file_name().ok_or_else(|| "This path has no file name.".to_string())?;
            let parent = p.parent().ok_or_else(|| "This path has no folder.".to_string())?;
            let parent =
                parent.canonicalize().map_err(|_| format!("The folder {} does not exist.", parent.display()))?;
            parent.join(name)
        }
    };
    if roots.iter().any(|root| resolved.starts_with(root)) {
        Ok(resolved)
    } else {
        Err(outside_error(allowed))
    }
}

/// Opens with O_NOFOLLOW: if the last part of the path became a symlink after
/// the check (a race), the open fails instead of following it. O_NONBLOCK
/// keeps a pipe swapped in at that moment from blocking the open.
fn open_no_follow(path: &Path, write: bool) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = std::fs::OpenOptions::new();
    if write {
        options.write(true).create(true).truncate(true).mode(0o644);
    } else {
        options.read(true);
    }
    options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK).open(path)
}

pub fn read_file(path: &str, allowed: &[String]) -> Result<String, String> {
    let p = resolve_allowed(path, allowed, true)?;
    let meta = std::fs::metadata(&p).map_err(|e| format!("{}: {e}", p.display()))?;
    if meta.is_dir() {
        return Err(format!("{} is a folder. Use list_directory.", p.display()));
    }
    if !meta.is_file() {
        return Err(format!("{} is not a regular file.", p.display()));
    }
    use std::io::Read;
    let file = open_no_follow(&p, false).map_err(|e| format!("{}: {e}", p.display()))?;
    let mut buf = Vec::new();
    file.take(MAX_READ as u64).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    if buf.iter().take(8192).any(|b| *b == 0) {
        return Err(format!("{} is not a text file.", p.display()));
    }
    let mut text = String::from_utf8_lossy(&buf).into_owned();
    if meta.len() as usize > MAX_READ {
        text.push_str(&format!("\n…[file cut at 200 KB of {} KB]", meta.len() / 1024));
    }
    Ok(text)
}

pub fn list_directory(path: &str, allowed: &[String]) -> Result<String, String> {
    let p = resolve_allowed(path, allowed, true)?;
    if !p.is_dir() {
        return Err(format!("{} is not a folder.", p.display()));
    }
    let mut entries: Vec<(String, bool, u64)> = std::fs::read_dir(&p)
        .map_err(|e| format!("{}: {e}", p.display()))?
        .flatten()
        .filter(|e| e.file_name() != ".DS_Store")
        .map(|e| {
            let meta = e.metadata().ok();
            let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            (e.file_name().to_string_lossy().into_owned(), is_dir, meta.map(|m| m.len()).unwrap_or(0))
        })
        .collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase())));
    if entries.is_empty() {
        return Ok(format!("{} is empty.", p.display()));
    }
    let total = entries.len();
    let mut lines = vec![format!("{} ({total} items)", p.display())];
    for (name, is_dir, size) in entries.into_iter().take(200) {
        lines.push(if is_dir { format!("{name}/") } else { format!("{name} ({})", human_size(size)) });
    }
    if total > 200 {
        lines.push(format!("…and {} more", total - 200));
    }
    Ok(lines.join("\n"))
}

pub fn write_file(path: &str, content: &str, allowed: &[String]) -> Result<String, String> {
    let p = resolve_allowed(path, allowed, false)?;
    match std::fs::symlink_metadata(&p) {
        Ok(meta) if meta.is_dir() => return Err(format!("{} is a folder.", p.display())),
        Ok(meta) if !meta.is_file() => return Err(format!("{} is not a regular file.", p.display())),
        _ => {}
    }
    use std::io::Write;
    let mut file = open_no_follow(&p, true).map_err(|e| format!("Could not write {}: {e}", p.display()))?;
    file.write_all(content.as_bytes()).map_err(|e| format!("Could not write {}: {e}", p.display()))?;
    Ok(format!("Wrote {} characters to {}.", content.chars().count(), p.display()))
}

fn human_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

// ---------- shell, clipboard, open, shortcuts ----------

pub fn shell_command(command: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("/bin/zsh");
    cmd.arg("-c").arg(command).envs(crate::util::login_env());
    cmd
}

/// stdout, then stderr, then the exit code when it is not 0.
pub fn describe_output(out: &ProcOutput) -> Result<String, String> {
    let stdout = out.stdout.trim_end();
    let stderr = out.stderr.trim_end();
    if out.status == Some(0) {
        let mut text = stdout.to_string();
        if !stderr.is_empty() {
            if !text.is_empty() {
                text.push_str("\n\n");
            }
            text.push_str("stderr:\n");
            text.push_str(stderr);
        }
        if text.is_empty() {
            text = "The command finished with no output.".into();
        }
        Ok(text)
    } else {
        let code = out.status.map(|c| c.to_string()).unwrap_or_else(|| "unknown (stopped by a signal)".into());
        let mut text = format!("Exit code {code}");
        if !stderr.is_empty() {
            text.push('\n');
            text.push_str(stderr);
        }
        if !stdout.is_empty() {
            text.push_str("\n\nstdout:\n");
            text.push_str(stdout);
        }
        Err(text)
    }
}

async fn run_shell(command: &str) -> Result<String, String> {
    let mut cmd = shell_command(command);
    if let Some(home) = dirs::home_dir() {
        cmd.current_dir(home);
    }
    let out = run_process(cmd, None, Duration::from_secs(30)).await?;
    describe_output(&out)
}

async fn read_clipboard() -> Result<String, String> {
    let out = run_process(tokio::process::Command::new("/usr/bin/pbpaste"), None, Duration::from_secs(5)).await?;
    if out.stdout.trim().is_empty() {
        Ok("The clipboard is empty or holds no text.".into())
    } else {
        Ok(out.stdout)
    }
}

async fn open_url(url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| format!("\"{url}\" is not a valid URL."))?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("Only http, https and mailto links can be opened.".into());
    }
    let mut cmd = tokio::process::Command::new("/usr/bin/open");
    cmd.arg(parsed.as_str());
    let out = run_process(cmd, None, Duration::from_secs(10)).await?;
    if out.status == Some(0) {
        Ok(format!("Opened {}.", parsed.as_str()))
    } else {
        Err(format!("Could not open the link. {}", out.stderr.trim()))
    }
}

/// `shortcuts run <name> [--input-path <file>] --output-path <file>`.
pub async fn run_shortcut(
    name: &str,
    input: Option<&[u8]>,
    tmp_dir: &Path,
    timeout: Duration,
) -> Result<String, String> {
    let _ = std::fs::create_dir_all(tmp_dir);
    let id = crate::util::new_id();
    let in_path = tmp_dir.join(format!("shortcut-{id}-in.txt"));
    let out_path = tmp_dir.join(format!("shortcut-{id}-out"));
    let mut cmd = tokio::process::Command::new("/usr/bin/shortcuts");
    cmd.arg("run");
    if let Some(data) = input {
        std::fs::write(&in_path, data).map_err(|e| format!("Could not write the shortcut input: {e}"))?;
        cmd.arg("--input-path").arg(&in_path);
    }
    // `--` so a name that starts with "-" is never read as an option.
    cmd.arg("--output-path").arg(&out_path).arg("--").arg(name);
    let result = run_process(cmd, None, timeout).await;
    let output = std::fs::read(&out_path).ok();
    let _ = std::fs::remove_file(&in_path);
    let _ = std::fs::remove_file(&out_path);
    let out = result?;
    if out.status != Some(0) {
        let msg = out.stderr.trim();
        return Err(if msg.is_empty() {
            format!("The shortcut \"{name}\" failed (exit code {}).", out.status.unwrap_or(-1))
        } else {
            format!("The shortcut \"{name}\" failed: {msg}")
        });
    }
    let text = output.map(|b| String::from_utf8_lossy(&b).trim().to_string()).unwrap_or_default();
    if text.is_empty() {
        let stdout = out.stdout.trim();
        Ok(if stdout.is_empty() { "The shortcut finished with no output.".into() } else { stdout.to_string() })
    } else {
        Ok(text)
    }
}

/// Names from `shortcuts list`.
pub async fn shortcuts_list() -> Result<Vec<String>, String> {
    let mut cmd = tokio::process::Command::new("/usr/bin/shortcuts");
    cmd.arg("list");
    let out = run_process(cmd, None, Duration::from_secs(20)).await?;
    if out.status != Some(0) {
        return Err(format!("Could not list shortcuts. {}", out.stderr.trim()));
    }
    let mut names: Vec<String> =
        out.stdout.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculator_handles_common_notation() {
        assert_eq!(calculate("1234.5 * 987.25").unwrap(), "1234.5 * 987.25 = 1218760.125");
        assert_eq!(calculate("7 / 2").unwrap(), "7 / 2 = 3.5");
        assert_eq!(calculate("2^10").unwrap(), "2^10 = 1024");
        assert_eq!(calculate("2 ** 3").unwrap(), "2 ** 3 = 8");
        assert_eq!(calculate("sqrt(16) + abs(-2)").unwrap(), "sqrt(16) + abs(-2) = 6");
        assert_eq!(calculate("0.1 + 0.2").unwrap(), "0.1 + 0.2 = 0.3");
        assert_eq!(calculate("1,234,567 + 1").unwrap(), "1,234,567 + 1 = 1234568");
        assert_eq!(calculate("12 × 3 ÷ 4").unwrap(), "12 × 3 ÷ 4 = 9");
        assert!(calculate("2 * pi").unwrap().starts_with("2 * pi = 6.28318530718"));
        assert_eq!(calculate("log10(1000)").unwrap(), "log10(1000) = 3");
        assert_eq!(calculate("max(3, 9, 4)").unwrap(), "max(3, 9, 4) = 9");
        assert_eq!(calculate("10 % 4").unwrap(), "10 % 4 = 2");
        assert!(calculate("2 +").is_err());
        assert!(calculate("hello").is_err());
    }

    #[test]
    fn numbers_are_formatted() {
        assert_eq!(format_number(1218760.125), "1218760.125");
        assert_eq!(format_number(1.0 / 3.0), "0.333333333333");
        assert_eq!(format_number(-4.0), "-4");
        assert_eq!(format_number(1e20), "1e20");
        assert_eq!(format_number(0.0), "0");
    }

    #[test]
    fn html_becomes_readable_text() {
        let html = r#"<!DOCTYPE html><html><head><title>Ada &amp; Co</title><style>p{color:red}</style>
            <script>var x = "<p>no</p>";</script></head>
            <body><nav><a href="/">Home</a> | <a href="/a">About</a></nav>
            <h1>Hello&nbsp;world</h1><!-- hidden -->
            <p>First   line<br>Second&#8212;line &lt;tag&gt; &#x41;</p>
            <ul><li>One</li><li>Two</li></ul></body></html>"#;
        let text = html_to_text(html);
        assert!(text.starts_with("Ada & Co\n\nHello world"), "{text}");
        assert!(text.contains("First line\nSecond\u{2014}line <tag> A"), "{text}");
        assert!(text.contains("- One\n- Two"), "{text}");
        assert!(!text.contains("color"));
        assert!(!text.contains("var x"));
        assert!(!text.contains("About"));
        assert!(!text.contains("hidden"));
        assert!(!text.contains("\n\n\n"));
    }

    #[test]
    fn entities_decode_and_unknown_stay() {
        assert_eq!(decode_entities("a &amp; b &unknown; &#65;&#x42; & c"), "a & b &unknown; AB & c");
    }

    #[test]
    fn body_types() {
        assert_eq!(body_to_text("application/json", br#"{"a":1}"#).unwrap(), r#"{"a":1}"#);
        assert!(body_to_text("image/png", b"\x89PNG").is_err());
        assert_eq!(body_to_text("", b"<html><body><p>x</p></body></html>").unwrap(), "x");
    }

    #[test]
    fn allowed_folder_checks() {
        let root = tempfile::tempdir().unwrap();
        let allowed_dir = root.path().join("allowed");
        let other = root.path().join("other");
        std::fs::create_dir_all(allowed_dir.join("sub")).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(allowed_dir.join("sub/note.txt"), "hello").unwrap();
        std::fs::write(other.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(other.join("secret.txt"), allowed_dir.join("link.txt")).unwrap();
        // A sibling whose name starts with the allowed folder name.
        std::fs::create_dir_all(root.path().join("allowed2")).unwrap();
        std::fs::write(root.path().join("allowed2/x.txt"), "x").unwrap();

        let allowed = vec![allowed_dir.display().to_string()];
        assert_eq!(read_file(&allowed_dir.join("sub/note.txt").display().to_string(), &allowed).unwrap(), "hello");
        assert_eq!(read_file("sub/note.txt", &allowed).unwrap(), "hello");
        assert!(read_file(&other.join("secret.txt").display().to_string(), &allowed).is_err());
        assert!(read_file(&allowed_dir.join("../other/secret.txt").display().to_string(), &allowed).is_err());
        assert!(read_file(&allowed_dir.join("link.txt").display().to_string(), &allowed)
            .unwrap_err()
            .contains("outside"));
        assert!(read_file(&root.path().join("allowed2/x.txt").display().to_string(), &allowed).is_err());
        assert!(read_file("/etc/hosts", &[]).unwrap_err().contains("No folders"));

        let listing = list_directory(&allowed_dir.display().to_string(), &allowed).unwrap();
        assert!(listing.contains("sub/"), "{listing}");

        write_file(&allowed_dir.join("new.txt").display().to_string(), "data", &allowed).unwrap();
        assert_eq!(std::fs::read_to_string(allowed_dir.join("new.txt")).unwrap(), "data");
        assert!(write_file(&other.join("x.txt").display().to_string(), "no", &allowed).is_err());
        assert!(write_file(&allowed_dir.join("missing/x.txt").display().to_string(), "no", &allowed).is_err());
        // Writing through a symlink that points outside is refused.
        assert!(write_file(&allowed_dir.join("link.txt").display().to_string(), "no", &allowed).is_err());
        assert_eq!(std::fs::read_to_string(other.join("secret.txt")).unwrap(), "secret");
    }

    #[test]
    fn every_builtin_has_one_spec() {
        use Builtin::*;
        let all = [
            CurrentDatetime,
            Calculator,
            FetchUrl,
            SpotlightSearch,
            ReadFile,
            ListDirectory,
            WriteFile,
            RunShellCommand,
            ReadClipboard,
            OpenUrl,
            RunShortcut,
        ];
        assert_eq!(all.len(), BUILTINS.len());
        for kind in all {
            assert_eq!(BUILTINS.iter().filter(|s| s.kind == kind).count(), 1, "{kind:?}");
            assert_eq!(spec(kind).kind, kind);
        }
    }

    #[test]
    fn symlink_and_special_file_escapes_are_refused() {
        let root = tempfile::tempdir().unwrap();
        let allowed_dir = root.path().join("allowed");
        let outside = root.path().join("outside");
        std::fs::create_dir_all(&allowed_dir).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        let allowed = vec![allowed_dir.display().to_string()];
        let inside = |name: &str| allowed_dir.join(name).display().to_string();

        // A dangling symlink inside the allowed folder that points outside:
        // writing through it would create a file outside.
        std::os::unix::fs::symlink(outside.join("new.txt"), allowed_dir.join("dangling")).unwrap();
        assert!(write_file(&inside("dangling"), "x", &allowed).is_err());
        assert!(!outside.join("new.txt").exists(), "nothing may be written outside");

        // A symlinked folder that points outside.
        std::os::unix::fs::symlink(&outside, allowed_dir.join("door")).unwrap();
        assert!(list_directory(&inside("door"), &allowed).unwrap_err().contains("outside"));
        assert!(read_file(&inside("door/secret.txt"), &allowed).unwrap_err().contains("outside"));
        assert!(write_file(&inside("door/x.txt"), "x", &allowed).unwrap_err().contains("outside"));
        assert!(!outside.join("x.txt").exists());

        // `..` in every form.
        assert!(write_file(&inside("../outside/y.txt"), "x", &allowed).unwrap_err().contains("outside"));
        assert!(write_file(&inside(".."), "x", &allowed).is_err());
        assert!(write_file("../outside/z.txt", "x", &allowed).unwrap_err().contains("outside"));
        assert!(read_file("sub/../../outside/secret.txt", &allowed).is_err());
        assert!(read_file("a\0b", &allowed).is_err());

        // A named pipe would block a read forever; a folder is not a file.
        let fifo = allowed_dir.join("pipe");
        let c_path = std::ffi::CString::new(fifo.display().to_string()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);
        assert!(read_file(&inside("pipe"), &allowed).unwrap_err().contains("not a regular file"));
        assert!(write_file(&inside("pipe"), "x", &allowed).unwrap_err().contains("not a regular file"));
        std::fs::create_dir_all(allowed_dir.join("dir")).unwrap();
        assert!(write_file(&inside("dir"), "x", &allowed).unwrap_err().contains("is a folder"));

        // A symlink to a file inside the allowed folder is fine.
        std::fs::write(allowed_dir.join("real.txt"), "real").unwrap();
        std::os::unix::fs::symlink(allowed_dir.join("real.txt"), allowed_dir.join("alias.txt")).unwrap();
        assert_eq!(read_file(&inside("alias.txt"), &allowed).unwrap(), "real");
        write_file(&inside("alias.txt"), "changed", &allowed).unwrap();
        assert_eq!(std::fs::read_to_string(allowed_dir.join("real.txt")).unwrap(), "changed");
        assert_eq!(std::fs::read_to_string(outside.join("secret.txt")).unwrap(), "secret");
    }

    #[test]
    fn binary_files_are_refused() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("bin.dat"), [0u8, 1, 2, 3]).unwrap();
        let allowed = vec![root.path().display().to_string()];
        assert!(read_file("bin.dat", &allowed).unwrap_err().contains("not a text file"));
    }

    #[tokio::test]
    async fn shell_output_and_exit_codes() {
        let out = run_process(shell_command("echo hi; echo oops >&2"), None, Duration::from_secs(10)).await.unwrap();
        assert_eq!(describe_output(&out).unwrap(), "hi\n\nstderr:\noops");
        let out = run_process(shell_command("echo bad >&2; exit 3"), None, Duration::from_secs(10)).await.unwrap();
        assert_eq!(describe_output(&out).unwrap_err(), "Exit code 3\nbad");
    }

    #[test]
    fn datetime_has_parts() {
        let t = current_datetime();
        assert!(t.contains("Date: ") && t.contains("Time: ") && t.contains("ISO 8601: "), "{t}");
    }
}
