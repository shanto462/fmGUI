//! Friendly error texts (simple English) and command lookup for MCP servers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// What to install for a well-known launcher.
pub fn install_hint(command: &str) -> &'static str {
    let base = Path::new(command).file_name().and_then(|s| s.to_str()).unwrap_or(command);
    match base {
        "npx" | "node" | "npm" | "pnpm" | "yarn" => {
            "Install Node.js (for example with Homebrew: brew install node) and try again."
        }
        "uvx" | "uv" => "Install uv (for example with Homebrew: brew install uv) and try again.",
        "python" | "python3" | "pip" | "pip3" | "pipx" => {
            "Install Python (for example with Homebrew: brew install python) and try again."
        }
        "bun" | "bunx" => "Install Bun (for example with Homebrew: brew install oven-sh/bun/bun) and try again.",
        "deno" => "Install Deno (for example with Homebrew: brew install deno) and try again.",
        "docker" => "Install Docker Desktop, start it, and try again.",
        "go" => "Install Go (for example with Homebrew: brew install go) and try again.",
        _ => "Check the spelling and that the program is installed. fmGUI looks in the same PATH as your login shell.",
    }
}

pub fn command_not_found(command: &str) -> String {
    format!("Command not found: {command}. {}", install_hint(command))
}

/// Expands a leading `~` to the home folder.
pub fn expand_tilde(text: &str) -> String {
    if text == "~" {
        if let Some(home) = dirs::home_dir() {
            return home.display().to_string();
        }
    }
    if let Some(rest) = text.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).display().to_string();
        }
    }
    text.to_string()
}

fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

/// Finds the program to run. A name without `/` is looked up in `env`'s PATH
/// (the login shell PATH), so `npx` from nvm or Homebrew is found even when
/// the app was opened from Finder.
pub fn resolve_program(command: &str, env: &HashMap<String, String>, cwd: Option<&Path>) -> Result<PathBuf, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("The command is empty. Enter a program to run, for example npx.".into());
    }
    let expanded = expand_tilde(command);
    if expanded.contains('/') {
        let mut path = PathBuf::from(&expanded);
        if path.is_relative() {
            if let Some(dir) = cwd {
                path = dir.join(path);
            }
        }
        if !path.exists() {
            return Err(command_not_found(command));
        }
        if !is_executable(&path) {
            return Err(format!(
                "{command} is not a program fmGUI can run. Check that the file is executable (chmod +x)."
            ));
        }
        return Ok(path);
    }
    let path_var = env.get("PATH").cloned().unwrap_or_default();
    for dir in path_var.split(':').filter(|d| !d.is_empty()) {
        let candidate = Path::new(dir).join(&expanded);
        if is_executable(&candidate) {
            return Ok(candidate);
        }
    }
    Err(command_not_found(command))
}

/// Splits a command line like a shell would (spaces, single and double
/// quotes, backslash escapes). Used when someone types the whole command,
/// for example `npx -y @modelcontextprotocol/server-everything`, into the
/// command field and leaves the arguments empty.
pub fn split_command_line(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_word = false;
    let mut quote: Option<char> = None;
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match quote {
            Some(q) if c == q => quote = None,
            Some('"') if c == '\\' => {
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            Some(_) => cur.push(c),
            None => match c {
                '\'' | '"' => {
                    quote = Some(c);
                    in_word = true;
                }
                '\\' => {
                    if let Some(n) = chars.next() {
                        cur.push(n);
                    }
                    in_word = true;
                }
                c if c.is_whitespace() => {
                    if in_word {
                        out.push(std::mem::take(&mut cur));
                        in_word = false;
                    }
                }
                c => {
                    cur.push(c);
                    in_word = true;
                }
            },
        }
    }
    if in_word {
        out.push(cur);
    }
    out
}

/// A hint from what the server printed before it stopped.
pub fn output_hint(lines: &[String]) -> Option<&'static str> {
    let text = lines.join("\n");
    let has = |needle: &str| text.contains(needle);
    if has("E404") || has("404 Not Found") || has("is not in this registry") {
        Some("npm could not find this package. Check the package name.")
    } else if has("ENOTFOUND") || has("getaddrinfo") || has("ECONNREFUSED") || has("network request") {
        Some("The download failed. Check your internet connection.")
    } else if has("No solution found") || has("not found in the package registry") {
        Some("uv could not find this package. Check the package name.")
    } else if has("EACCES") || has("Permission denied") || has("Operation not permitted") {
        Some("The server was not allowed to read or write a file. Check the folder permissions.")
    } else if has("Cannot connect to the Docker daemon") {
        Some("Docker is not running. Start Docker Desktop and try again.")
    } else if has("ENOENT") || has("No such file or directory") {
        Some("A file or folder was not found. Check the arguments and the working folder.")
    } else {
        None
    }
}

/// Text for a server process that stopped on its own.
pub fn exit_message(code: Option<i32>, tail: &[String]) -> String {
    let mut msg = match code {
        Some(c) => format!("The server stopped (exit code {c})."),
        None => "The server stopped (it was killed by a signal).".to_string(),
    };
    if let Some(hint) = output_hint(tail) {
        msg.push(' ');
        msg.push_str(hint);
    }
    if let Some(last) = tail.iter().rev().find(|l| !l.trim().is_empty()) {
        msg.push_str(" Last output: ");
        msg.push_str(&crate::util::truncate_chars(last.trim(), 300));
    }
    msg
}

/// Text for a failed HTTP connection.
pub fn http_send_error(url: &str, err: &reqwest::Error) -> String {
    let mut root: &dyn std::error::Error = err;
    while let Some(next) = root.source() {
        root = next;
    }
    if err.is_timeout() {
        format!("{url} did not answer in time.")
    } else if err.is_connect() {
        format!("Could not reach {url}. Check the URL and that the server is running. ({root})")
    } else {
        format!("Could not talk to {url}: {root}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friendly_not_found_messages() {
        assert_eq!(
            command_not_found("npx"),
            "Command not found: npx. Install Node.js (for example with Homebrew: brew install node) and try again."
        );
        assert!(command_not_found("/opt/tools/uvx").contains("brew install uv"));
        assert!(command_not_found("my-server").contains("login shell"));
    }

    #[test]
    fn resolves_programs_on_path() {
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), "/nonexistent:/bin:/usr/bin".to_string());
        assert_eq!(resolve_program("sh", &env, None).unwrap(), PathBuf::from("/bin/sh"));
        assert!(resolve_program("definitely-not-a-real-program-xyz", &env, None)
            .unwrap_err()
            .starts_with("Command not found"));
        assert!(resolve_program("  ", &env, None).is_err());
        assert_eq!(resolve_program("/bin/sh", &env, None).unwrap(), PathBuf::from("/bin/sh"));
        assert!(resolve_program("/etc/hosts", &env, None).unwrap_err().contains("executable"));
        assert_eq!(resolve_program("./sh", &env, Some(Path::new("/bin"))).unwrap(), PathBuf::from("/bin/./sh"));
    }

    #[test]
    fn splits_command_lines() {
        assert_eq!(
            split_command_line("npx -y @modelcontextprotocol/server-filesystem '/Users/Ada Lovelace/Docs'"),
            vec!["npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/Ada Lovelace/Docs"]
        );
        assert_eq!(split_command_line(r#"a "b \"c\"" d\ e"#), vec!["a", r#"b "c""#, "d e"]);
        assert_eq!(split_command_line("  "), Vec::<String>::new());
        assert_eq!(split_command_line("x ''"), vec!["x", ""]);
    }

    #[test]
    fn exit_messages_with_hints() {
        let tail = vec![
            "npm error code E404".to_string(),
            "npm error 404 Not Found - GET https://registry.npmjs.org/@x%2fy".to_string(),
        ];
        let msg = exit_message(Some(1), &tail);
        assert!(msg.starts_with("The server stopped (exit code 1)."));
        assert!(msg.contains("could not find this package"));
        assert!(msg.contains("Last output: npm error 404"));
        assert_eq!(exit_message(None, &[]), "The server stopped (it was killed by a signal).");
    }

    #[test]
    fn expands_tilde() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_tilde("~/x"), home.join("x").display().to_string());
        assert_eq!(expand_tilde("a~/x"), "a~/x");
    }
}
