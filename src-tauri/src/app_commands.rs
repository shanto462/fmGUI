//! App-level commands: config, paths, small file helpers.

use crate::config::AppConfig;
use crate::state::AppState;
use crate::util::RwLockExt;
use base64::Engine as _;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config())
}

/// Replaces the whole config, saves it, and emits "config-changed".
#[tauri::command]
pub async fn save_config(app: AppHandle, state: State<'_, AppState>, config: AppConfig) -> Result<AppConfig, String> {
    config.save(&state.paths.config_file)?;
    *state.config.write_safe() = config.clone();
    // Stop MCP servers that were removed from the config.
    state.mcp.prune(&config.mcp_servers).await;
    let _ = app.emit("config-changed", &config);
    Ok(config)
}

/// Folders shown on the Settings page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsInfo {
    pub data_dir: String,
    pub config_file: String,
    pub chats_dir: String,
    pub skills_dir: String,
    pub tmp_dir: String,
    pub engine_socket: String,
    pub cli_sessions_dir: String,
    pub home_dir: String,
}

#[tauri::command]
pub async fn get_paths(state: State<'_, AppState>) -> Result<PathsInfo, String> {
    let p = &state.paths;
    let s = |path: &std::path::Path| path.display().to_string();
    Ok(PathsInfo {
        data_dir: s(&p.data_dir),
        config_file: s(&p.config_file),
        chats_dir: s(&p.chats_dir),
        skills_dir: s(&p.skills_dir),
        tmp_dir: s(&p.tmp_dir),
        engine_socket: s(&p.engine_socket),
        cli_sessions_dir: s(&p.cli_sessions_dir),
        home_dir: dirs::home_dir().map(|h| s(&h)).unwrap_or_default(),
    })
}

// ---------- files picked by the user ----------
//
// Trust model: these commands accept any path from the webview. The webview
// only runs the app's own bundled code (the CSP in tauri.conf.json blocks
// remote scripts), and the paths come from open/save dialogs the user
// answered, so the user is the one choosing the file. The model never calls
// these commands (its file tools live in `engine::builtin` and are limited to
// the allowed folders). They still refuse folders, devices, pipes and very
// large files, so a wrong pick cannot hang or exhaust the app.

/// Largest text file read or written through these commands.
const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
/// Largest image read (or pasted image saved) through these commands.
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// Runs blocking file work off the async threads.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.map_err(|e| format!("The file task failed: {e}"))?
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    blocking(move || {
        let bytes = crate::util::read_user_file(Path::new(&path), MAX_TEXT_BYTES)?;
        String::from_utf8(bytes).map_err(|_| format!("{path} is not a UTF-8 text file."))
    })
    .await
}

#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    blocking(move || {
        if content.len() as u64 > MAX_TEXT_BYTES {
            return Err("The text is larger than 5 MB, so it was not saved.".into());
        }
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.is_dir() {
                return Err(format!("{path} is a folder, not a file."));
            }
            if !meta.is_file() {
                return Err(format!("{path} is not a regular file."));
            }
        }
        std::fs::write(&path, content).map_err(|e| format!("Could not save {path}: {e}"))
    })
    .await
}

/// A file name for the tmp folder: letters, digits, `.`, `-`, `_` only,
/// never empty, `.` or `..`, at most 100 characters.
fn temp_file_name(name: &str) -> String {
    let safe: String =
        name.chars().take(100).map(|c| if c.is_ascii_alphanumeric() || ".-_".contains(c) { c } else { '_' }).collect();
    if safe.trim_matches('.').is_empty() {
        "file".into()
    } else {
        safe
    }
}

/// Writes data into the app tmp folder and returns the absolute path.
/// `data` is base64, or a data URL (`data:image/png;base64,...`).
/// Used for pasted images the CLI must read.
#[tauri::command]
pub async fn save_temp_file(state: State<'_, AppState>, file_name: String, data: String) -> Result<String, String> {
    let tmp_dir = state.paths.tmp_dir.clone();
    blocking(move || {
        let b64 = data.split_once(";base64,").map(|(_, b)| b).unwrap_or(&data).trim();
        if b64.len() as u64 > MAX_IMAGE_BYTES / 3 * 4 + 4 {
            return Err("The file is larger than 20 MB, so it was not saved.".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|_| "The file data is not valid base64.".to_string())?;
        let path = tmp_dir.join(format!("{}-{}", &crate::util::new_id()[..8], temp_file_name(&file_name)));
        std::fs::write(&path, bytes).map_err(|e| format!("Could not save the file: {e}"))?;
        Ok(path.display().to_string())
    })
    .await
}

/// Same as `save_temp_file` for plain text (schema files for `fm`). The same
/// name replaces the earlier file.
#[tauri::command]
pub async fn save_temp_text(state: State<'_, AppState>, file_name: String, content: String) -> Result<String, String> {
    let tmp_dir = state.paths.tmp_dir.clone();
    blocking(move || {
        if content.len() as u64 > MAX_TEXT_BYTES {
            return Err("The text is larger than 5 MB, so it was not saved.".into());
        }
        let path = tmp_dir.join(temp_file_name(&file_name));
        std::fs::write(&path, content).map_err(|e| format!("Could not save the file: {e}"))?;
        Ok(path.display().to_string())
    })
    .await
}

/// Reads an image file and returns a data URL (for previews and chat attachments).
#[tauri::command]
pub async fn read_image_data_url(path: String) -> Result<String, String> {
    blocking(move || {
        let bytes = crate::util::read_user_file(Path::new(&path), MAX_IMAGE_BYTES)?;
        let ext = Path::new(&path).extension().and_then(|e| e.to_str()).unwrap_or("png").to_ascii_lowercase();
        let mime = match ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "heic" => "image/heic",
            "webp" => "image/webp",
            "tif" | "tiff" => "image/tiff",
            "bmp" => "image/bmp",
            _ => "image/png",
        };
        Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    })
    .await
}

/// Finds a program on the user's login-shell PATH (e.g. "npx", "uvx", "node").
/// Used by the MCP setup wizard to check requirements.
#[tauri::command]
pub async fn which_command(name: String) -> Result<Option<String>, String> {
    let name = name.trim();
    if name.is_empty() || name.contains(['/', '\0']) {
        return Ok(None);
    }
    let path = crate::util::login_env_async().await.get("PATH").cloned().unwrap_or_default();
    for dir in path.split(':').filter(|d| !d.is_empty()) {
        let candidate = Path::new(dir).join(name);
        if let Ok(meta) = std::fs::metadata(&candidate) {
            use std::os::unix::fs::PermissionsExt;
            if meta.is_file() && meta.permissions().mode() & 0o111 != 0 {
                return Ok(Some(candidate.display().to_string()));
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_names_stay_in_the_folder() {
        assert_eq!(temp_file_name("schema.json"), "schema.json");
        assert_eq!(temp_file_name("../../config.json"), ".._.._config.json");
        assert_eq!(temp_file_name(".."), "file");
        assert_eq!(temp_file_name("."), "file");
        assert_eq!(temp_file_name(""), "file");
        assert_eq!(temp_file_name("/etc/passwd"), "_etc_passwd");
        assert_eq!(temp_file_name(&"a".repeat(300)).len(), 100);
    }

    #[tokio::test]
    async fn user_file_commands_refuse_folders_and_devices() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().display().to_string();
        assert!(read_text_file(folder.clone()).await.unwrap_err().contains("is a folder"));
        assert!(write_text_file(folder.clone(), "x".into()).await.unwrap_err().contains("is a folder"));
        assert!(read_image_data_url("/dev/zero".into()).await.unwrap_err().contains("not a regular file"));
        assert!(write_text_file("/dev/null".into(), "x".into()).await.unwrap_err().contains("not a regular file"));
        let file = dir.path().join("note.txt").display().to_string();
        write_text_file(file.clone(), "héllo".into()).await.unwrap();
        assert_eq!(read_text_file(file).await.unwrap(), "héllo");
        let big = "x".repeat(MAX_TEXT_BYTES as usize + 1);
        let err = write_text_file(dir.path().join("big.txt").display().to_string(), big).await.unwrap_err();
        assert!(err.contains("larger than 5 MB"), "{err}");
        assert_eq!(which_command("../bin/sh".into()).await.unwrap(), None);
        assert_eq!(which_command("/bin/sh".into()).await.unwrap(), None);
    }
}
