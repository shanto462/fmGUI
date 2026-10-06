//! Skills: folders with a SKILL.md (front matter `name`, `description`, then
//! a Markdown body). Stored in `<app data>/skills/<name>/SKILL.md`.
//! OWNER: agent "mcp" (also owns skills). Items marked CONTRACT keep their signatures.

pub mod commands;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// CONTRACT
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub description: String,
    /// Markdown body without the front matter.
    pub body: String,
    /// Folder of the skill.
    pub path: String,
    /// Other files in the folder (relative paths), informational.
    pub files: Vec<String>,
    /// Rough token estimate of the body.
    pub token_estimate: u32,
}

/// CONTRACT: create or update a skill.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInput {
    /// Set when renaming an existing skill.
    pub original_name: Option<String>,
    pub name: String,
    pub description: String,
    pub body: String,
}

/// CONTRACT: a skill found outside the app that can be imported.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillCandidate {
    pub name: String,
    pub description: String,
    pub path: String,
    /// e.g. "~/.claude/skills"
    pub source: String,
    pub token_estimate: u32,
    pub already_imported: bool,
}

/// CONTRACT: lives in AppState.
pub struct SkillStore {
    pub dir: PathBuf,
}

impl SkillStore {
    /// CONTRACT
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// CONTRACT: all skills, sorted by name. Broken folders are skipped.
    pub fn list(&self) -> Vec<Skill> {
        Vec::new()
    }

    /// CONTRACT
    pub fn get(&self, name: &str) -> Option<Skill> {
        self.list().into_iter().find(|s| s.name == name)
    }
}
