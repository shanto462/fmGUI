//! Tauri commands for skills, mirrored in `src/lib/api.ts`.
//! Skill modes (off / onDemand / always) live in config.skills and are saved with `save_config`.

use super::{Skill, SkillCandidate, SkillInput, SkillStore};
use crate::config::AppConfig;
use crate::state::AppState;
use crate::util::RwLockExt;
use tauri::State;

/// Changes the config and saves it. `change` returns false when nothing changed.
fn update_config(state: &AppState, change: impl FnOnce(&mut AppConfig) -> bool) -> Result<(), String> {
    let mut guard = state.config.write_safe();
    let mut next = guard.clone();
    if !change(&mut next) {
        return Ok(());
    }
    next.save(&state.paths.config_file).map_err(|e| format!("The skill was saved, but the settings were not: {e}"))?;
    *guard = next;
    Ok(())
}

/// Runs blocking file work off the async threads.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.map_err(|e| format!("The task failed: {e}"))?
}

#[tauri::command]
pub async fn skills_list(state: State<'_, AppState>) -> Result<Vec<Skill>, String> {
    let dir = state.skills.dir.clone();
    blocking(move || Ok(SkillStore::new(dir).list())).await
}

#[tauri::command]
pub async fn skill_save(state: State<'_, AppState>, input: SkillInput) -> Result<Skill, String> {
    let dir = state.skills.dir.clone();
    let original = input.original_name.clone().map(|o| o.trim().to_string()).filter(|o| !o.is_empty());
    let skill = blocking(move || SkillStore::new(dir).save(&input)).await?;
    // A renamed skill keeps its mode (off / on demand / always).
    if let Some(original) = original.filter(|o| *o != skill.name) {
        let new_name = skill.name.clone();
        update_config(&state, |cfg| match cfg.skills.remove(&original) {
            Some(prefs) => {
                cfg.skills.insert(new_name, prefs);
                true
            }
            None => false,
        })?;
    }
    Ok(skill)
}

#[tauri::command]
pub async fn skill_delete(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let dir = state.skills.dir.clone();
    let target = name.clone();
    blocking(move || SkillStore::new(dir).delete(&target)).await?;
    update_config(&state, |cfg| cfg.skills.remove(&name).is_some())
}

/// Skills found in `~/.claude/skills` (and other known folders) that can be imported.
#[tauri::command]
pub async fn skills_import_candidates(state: State<'_, AppState>) -> Result<Vec<SkillCandidate>, String> {
    let dir = state.skills.dir.clone();
    blocking(move || Ok(SkillStore::new(dir).import_candidates(&super::default_import_sources()))).await
}

/// Copies a skill folder (or a single SKILL.md file) into the app's skills folder.
#[tauri::command]
pub async fn skill_import(state: State<'_, AppState>, path: String) -> Result<Skill, String> {
    let dir = state.skills.dir.clone();
    blocking(move || SkillStore::new(dir).import(&path)).await
}

/// Exact token count of the skill body with `fm count-tokens`.
#[tauri::command]
pub async fn skill_token_count(state: State<'_, AppState>, name: String) -> Result<u32, String> {
    let dir = state.skills.dir.clone();
    let lookup = name.clone();
    let skill =
        blocking(move || SkillStore::new(dir).get(&lookup).ok_or(format!("There is no skill named \"{lookup}\".")))
            .await?;
    count_tokens(&state.fm_path(), &skill.body).await
}

/// Runs `fm count-tokens --quiet -- <text>` and reads the number.
pub async fn count_tokens(fm_path: &str, text: &str) -> Result<u32, String> {
    if text.trim().is_empty() {
        return Ok(0);
    }
    if text.len() > 500_000 {
        return Err("This skill is too long to count (over 500 KB).".into());
    }
    let args = vec!["count-tokens".to_string(), "--quiet".to_string(), "--".to_string(), text.to_string()];
    let result = crate::fm::run_collect(fm_path, &args).await?;
    if let Some(error) = result.error {
        return Err(error);
    }
    parse_count(&result.stdout).ok_or_else(|| {
        format!(
            "fm count-tokens gave an answer fmGUI could not read: {}",
            crate::util::truncate_chars(result.stdout.trim(), 100)
        )
    })
}

/// The integer in the output: "42" or "Token count: 42".
fn parse_count(stdout: &str) -> Option<u32> {
    let text = crate::util::strip_ansi(stdout);
    let line = text.lines().rev().find(|l| !l.trim().is_empty())?;
    // The first number on the line; thousands separators are allowed.
    let digits: String = line
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit() || *c == ',')
        .filter(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_counts() {
        assert_eq!(parse_count("42\n"), Some(42));
        assert_eq!(parse_count("Token count: 1,234\n"), Some(1234));
        assert_eq!(parse_count("\u{1B}[1m7\u{1B}[0m"), Some(7));
        assert_eq!(parse_count("Token count: 42 of 8192"), Some(42));
        assert_eq!(parse_count(""), None);
    }

    /// Uses the real /usr/bin/fm when it is installed (macOS 27).
    #[tokio::test]
    async fn counts_with_real_fm() {
        if !std::path::Path::new("/usr/bin/fm").exists() {
            eprintln!("skipping: /usr/bin/fm not found");
            return;
        }
        assert_eq!(count_tokens("/usr/bin/fm", "   ").await, Ok(0));
        match count_tokens("/usr/bin/fm", "- starts with a dash\nWrite short, clear answers.").await {
            Ok(n) => assert!(n > 0 && n < 100, "{n}"),
            // Model not available or license not agreed on this machine.
            Err(err) => eprintln!("fm count-tokens failed: {err}"),
        }
        assert!(count_tokens("/no/such/fm", "x").await.is_err());
    }
}
