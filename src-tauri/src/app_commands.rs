//! App-level commands: config, paths, small file helpers. OWNER: lead.

use crate::config::AppConfig;
use crate::state::AppState;
use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config())
}

/// Replaces the whole config, saves it, and emits "config-changed".
#[tauri::command]
pub async fn save_config(app: AppHandle, state: State<'_, AppState>, config: AppConfig) -> Result<AppConfig, String> {
    config.save(&state.paths.config_file)?;
    *state.config.write().unwrap() = config.clone();
    let _ = app.emit("config-changed", &config);
    Ok(config)
}

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

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("{path}: {e}"))
}

/// Writes data into the app tmp folder and returns the absolute path.
/// `data` is base64, or a data URL (`data:image/png;base64,...`).
/// Used for pasted images and generated schema files the CLI must read.
#[tauri::command]
pub async fn save_temp_file(state: State<'_, AppState>, file_name: String, data: String) -> Result<String, String> {
    let b64 = data.split_once(";base64,").map(|(_, b)| b).unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("invalid base64: {e}"))?;
    let safe: String = file_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || ".-_".contains(c) { c } else { '_' })
        .collect();
    let path = state.paths.tmp_dir.join(format!("{}-{}", &crate::util::new_id()[..8], safe));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Same as `save_temp_file` for plain text (schemas).
#[tauri::command]
pub async fn save_temp_text(state: State<'_, AppState>, file_name: String, content: String) -> Result<String, String> {
    let safe: String = file_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || ".-_".contains(c) { c } else { '_' })
        .collect();
    let path = state.paths.tmp_dir.join(safe);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Reads an image file and returns a data URL (for previews and chat attachments).
#[tauri::command]
pub async fn read_image_data_url(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
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
}

/// Finds a program on the user's login-shell PATH (e.g. "npx", "uvx", "node").
/// Used by the MCP setup wizard to check requirements.
#[tauri::command]
pub async fn which_command(name: String) -> Result<Option<String>, String> {
    let path = crate::util::login_env().get("PATH").cloned().unwrap_or_default();
    for dir in path.split(':').filter(|d| !d.is_empty()) {
        let candidate = std::path::Path::new(dir).join(&name);
        if let Ok(meta) = std::fs::metadata(&candidate) {
            use std::os::unix::fs::PermissionsExt;
            if meta.is_file() && meta.permissions().mode() & 0o111 != 0 {
                return Ok(Some(candidate.display().to_string()));
            }
        }
    }
    Ok(None)
}
