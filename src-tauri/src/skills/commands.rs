//! Tauri commands for skills. OWNER: agent "mcp". CONTRACT: mirrored in `src/lib/api.ts`.
//! Skill modes (off / onDemand / always) live in config.skills and are saved with `save_config`.

use super::{Skill, SkillCandidate, SkillInput};
use crate::state::AppState;
use tauri::State;

const TODO: &str = "not implemented yet";

#[tauri::command]
pub async fn skills_list(state: State<'_, AppState>) -> Result<Vec<Skill>, String> {
    Ok(state.skills.list())
}

#[tauri::command]
pub async fn skill_save(state: State<'_, AppState>, input: SkillInput) -> Result<Skill, String> {
    let _ = (state, input);
    Err(TODO.into())
}

#[tauri::command]
pub async fn skill_delete(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let _ = (state, name);
    Err(TODO.into())
}

/// Skills found in `~/.claude/skills` (and other known folders) that can be imported.
#[tauri::command]
pub async fn skills_import_candidates(state: State<'_, AppState>) -> Result<Vec<SkillCandidate>, String> {
    let _ = state;
    Ok(Vec::new())
}

/// Copies a skill folder (or a single SKILL.md file) into the app's skills folder.
#[tauri::command]
pub async fn skill_import(state: State<'_, AppState>, path: String) -> Result<Skill, String> {
    let _ = (state, path);
    Err(TODO.into())
}

/// Exact token count of the skill body with `fm count-tokens`.
#[tauri::command]
pub async fn skill_token_count(state: State<'_, AppState>, name: String) -> Result<u32, String> {
    let _ = (state, name);
    Err(TODO.into())
}
