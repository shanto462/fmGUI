//! Skills: folders with a SKILL.md (front matter `name`, `description`, then
//! a Markdown body). Stored in `<app data>/skills/<name>/SKILL.md`.
//! OWNER: agent "mcp" (also owns skills). Items marked CONTRACT keep their signatures.

pub mod commands;
pub mod frontmatter;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

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

const SKILL_FILE: &str = "SKILL.md";
const MAX_LISTED_FILES: usize = 50;
const MAX_IMPORT_FILES: usize = 200;
const MAX_IMPORT_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DESCRIPTION_CHARS: usize = 1024;
/// Folders never copied on import.
const SKIP_DIRS: &[&str] = &[".git", "node_modules", "__pycache__", ".venv", ".DS_Store"];

/// Skill names: lowercase letters, digits and hyphens, 1 to 64 characters.
pub fn validate_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.chars().count() <= 64
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok {
        Ok(())
    } else if name.is_empty() {
        Err("Enter a name for the skill, for example pdf-tools.".into())
    } else if name.chars().count() > 64 {
        Err("The name is too long. Use at most 64 characters.".into())
    } else {
        Err("Use only lowercase letters, digits and hyphens in the name, for example pdf-tools.".into())
    }
}

/// Turns any text into a valid skill name ("My PDF_Tools!" → "my-pdf-tools").
pub fn sanitize_name(raw: &str) -> String {
    let mut out = String::new();
    for c in raw.trim().chars() {
        let c = c.to_ascii_lowercase();
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(64).collect();
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "imported-skill".into()
    } else {
        out
    }
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// The SKILL.md file of a folder (exact name first, then any letter case).
pub fn find_skill_file(dir: &Path) -> Option<PathBuf> {
    let exact = dir.join(SKILL_FILE);
    if exact.is_file() {
        return Some(exact);
    }
    fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
        p.is_file() && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.eq_ignore_ascii_case(SKILL_FILE))
    })
}

fn sorted_entries(dir: &Path) -> Vec<fs::DirEntry> {
    let mut entries: Vec<fs::DirEntry> = fs::read_dir(dir).map(|rd| rd.flatten().collect()).unwrap_or_default();
    entries.sort_by_key(|e| e.file_name());
    entries
}

/// Other files in a skill folder, relative, sorted, at most 50.
fn list_files(root: &Path, skill_file: &Path) -> Vec<String> {
    fn walk(root: &Path, dir: &Path, skill_file: &Path, depth: usize, out: &mut Vec<String>) {
        if depth > 6 {
            return;
        }
        for entry in sorted_entries(dir) {
            if out.len() >= MAX_LISTED_FILES {
                return;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if is_hidden(&name) || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                walk(root, &path, skill_file, depth + 1, out);
            } else if path != skill_file {
                if let Ok(rel) = path.strip_prefix(root) {
                    out.push(rel.to_string_lossy().to_string());
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, skill_file, 0, &mut out);
    out
}

fn read_text(path: &Path) -> Option<String> {
    fs::read(path).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

/// Reads one skill folder. None when it has no readable SKILL.md.
pub fn load_skill_folder(dir: &Path) -> Option<Skill> {
    let file = find_skill_file(dir)?;
    let text = read_text(&file)?;
    let (fm, body) = frontmatter::parse_skill_md(&text);
    let folder_name = dir.file_name()?.to_string_lossy().to_string();
    Some(Skill {
        name: fm.name.unwrap_or(folder_name),
        description: fm.description.unwrap_or_default(),
        token_estimate: crate::util::estimate_tokens(&body),
        body,
        path: dir.display().to_string(),
        files: list_files(dir, &file),
    })
}

/// Writes a file through a temp file + rename, so a crash never leaves half a SKILL.md.
fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let tmp = path.with_file_name(format!(".{}.tmp", path.file_name().and_then(|n| n.to_str()).unwrap_or("file")));
    fs::write(&tmp, text).map_err(|e| format!("Could not save {}: {e}", path.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not save {}: {e}", path.display())
    })
}

fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

struct CopyState {
    files: usize,
}

/// Copies a folder: skips hidden junk folders, symlinked folders, files over
/// 2 MB, and everything after 200 files.
fn copy_tree(src: &Path, dst: &Path, depth: usize, state: &mut CopyState) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Could not create {}: {e}", dst.display()))?;
    if depth > 10 {
        return Ok(());
    }
    let mut entries = sorted_entries(src);
    // SKILL.md first, so the 200-file limit never drops it.
    entries.sort_by_key(|e| !e.file_name().to_string_lossy().eq_ignore_ascii_case(SKILL_FILE));
    for entry in entries {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if SKIP_DIRS.contains(&name_str.as_ref()) {
            continue;
        }
        let path = entry.path();
        let Ok(link_meta) = fs::symlink_metadata(&path) else { continue };
        let Ok(meta) = fs::metadata(&path) else { continue }; // broken symlink
        if meta.is_dir() {
            if link_meta.file_type().is_symlink() {
                continue; // avoid loops
            }
            copy_tree(&path, &dst.join(&name), depth + 1, state)?;
        } else if meta.is_file() {
            if state.files >= MAX_IMPORT_FILES || meta.len() > MAX_IMPORT_FILE_BYTES {
                continue;
            }
            fs::copy(&path, dst.join(&name)).map_err(|e| format!("Could not copy {}: {e}", path.display()))?;
            state.files += 1;
        }
    }
    Ok(())
}

impl SkillStore {
    /// CONTRACT
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// CONTRACT: all skills, sorted by name. Broken folders are skipped.
    pub fn list(&self) -> Vec<Skill> {
        let mut skills: Vec<(bool, Skill)> = sorted_entries(&self.dir)
            .into_iter()
            .filter(|e| !is_hidden(&e.file_name().to_string_lossy()) && e.path().is_dir())
            .filter_map(|e| {
                let folder = e.file_name().to_string_lossy().to_string();
                load_skill_folder(&e.path()).map(|s| (s.name != folder, s))
            })
            .collect();
        // Same name twice: keep the one whose folder matches the name.
        skills.sort_by(|a, b| a.1.name.cmp(&b.1.name).then(a.0.cmp(&b.0)));
        skills.dedup_by(|a, b| a.1.name == b.1.name);
        skills.into_iter().map(|(_, s)| s).collect()
    }

    /// CONTRACT
    pub fn get(&self, name: &str) -> Option<Skill> {
        // Fast path: the folder has the skill's name.
        if validate_name(name).is_ok() {
            if let Some(skill) = load_skill_folder(&self.dir.join(name)) {
                if skill.name == name {
                    return Some(skill);
                }
            }
        }
        self.list().into_iter().find(|s| s.name == name)
    }

    /// Creates, updates or renames a skill (files only; the command moves
    /// the config entry).
    pub fn save(&self, input: &SkillInput) -> Result<Skill, String> {
        let name = input.name.trim();
        validate_name(name)?;
        let description = input.description.trim();
        if description.is_empty() {
            return Err("Add a description. The model reads it to decide when to use the skill.".into());
        }
        let count = description.chars().count();
        if count > MAX_DESCRIPTION_CHARS {
            return Err(format!("The description is too long ({count} characters). Keep it under 1,024 characters."));
        }
        fs::create_dir_all(&self.dir).map_err(|e| format!("Could not create the skills folder: {e}"))?;

        let original = input.original_name.as_deref().map(str::trim).filter(|o| !o.is_empty() && *o != name);
        let same_name = self.get(name);
        let renamed_from = original.and_then(|o| self.get(o));

        let folder = match (renamed_from, same_name) {
            (Some(_), Some(_)) => {
                return Err(format!("A skill named \"{name}\" already exists. Pick another name."));
            }
            (Some(old), None) => {
                let target = self.dir.join(name);
                if target.exists() {
                    return Err(format!("A folder named \"{name}\" already exists in the skills folder. Pick another name."));
                }
                fs::rename(&old.path, &target).map_err(|e| format!("Could not rename the skill: {e}"))?;
                target
            }
            (None, Some(existing)) => PathBuf::from(existing.path),
            (None, None) => {
                let target = self.dir.join(name);
                if target.exists() && !target.is_dir() {
                    return Err(format!("A file named \"{name}\" is in the way in the skills folder."));
                }
                fs::create_dir_all(&target).map_err(|e| format!("Could not create the skill folder: {e}"))?;
                target
            }
        };

        let file = find_skill_file(&folder).unwrap_or_else(|| folder.join(SKILL_FILE));
        let previous = read_text(&file);
        let text = frontmatter::render_skill_md(name, description, &input.body, previous.as_deref());
        write_atomic(&file, &text)?;
        load_skill_folder(&folder).ok_or_else(|| "The skill was saved but could not be read back.".into())
    }

    /// Removes the skill's folder.
    pub fn delete(&self, name: &str) -> Result<(), String> {
        let skill = self.get(name).ok_or_else(|| format!("There is no skill named \"{name}\"."))?;
        let path = PathBuf::from(&skill.path);
        // Only ever remove a direct child of the skills folder.
        let parent_ok = path.parent().map(|p| canonical(p) == canonical(&self.dir)).unwrap_or(false);
        if !parent_ok {
            return Err("This skill is not inside the skills folder, so fmGUI will not delete it.".into());
        }
        let is_link = fs::symlink_metadata(&path).map(|m| m.file_type().is_symlink()).unwrap_or(false);
        let result = if is_link { fs::remove_file(&path) } else { fs::remove_dir_all(&path) };
        result.map_err(|e| format!("Could not delete the skill: {e}"))
    }

    /// Skills in other folders (for example ~/.claude/skills) that can be imported.
    pub fn import_candidates(&self, sources: &[(PathBuf, String)]) -> Vec<SkillCandidate> {
        let mut out = Vec::new();
        for (root, label) in sources {
            if !root.is_dir() {
                continue;
            }
            for entry in sorted_entries(root) {
                if is_hidden(&entry.file_name().to_string_lossy()) || !entry.path().is_dir() {
                    continue;
                }
                let Some(skill) = load_skill_folder(&entry.path()) else { continue };
                let name = import_name(&skill.name);
                out.push(SkillCandidate {
                    already_imported: self.get(&name).is_some(),
                    name,
                    description: skill.description,
                    path: skill.path,
                    source: label.clone(),
                    token_estimate: skill.token_estimate,
                });
            }
        }
        out
    }

    /// Copies a skill folder (or a single .md file) into the skills folder.
    pub fn import(&self, path: &str) -> Result<Skill, String> {
        let path = PathBuf::from(crate::mcp::errors::expand_tilde(path.trim()));
        let meta = fs::metadata(&path).map_err(|_| format!("Nothing was found at {}.", path.display()))?;
        let (src_dir, single_file) = if meta.is_dir() {
            if find_skill_file(&path).is_none() {
                return Err("This folder has no SKILL.md file.".into());
            }
            (path.clone(), None)
        } else {
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
            if file_name.eq_ignore_ascii_case(SKILL_FILE) {
                (parent, None)
            } else if path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("md")) {
                (parent, Some(path.clone()))
            } else {
                return Err("Pick a skill folder or a SKILL.md file.".into());
            }
        };

        let skills_dir = canonical(&self.dir);
        let src_canon = canonical(&src_dir);
        if single_file.is_none() {
            if src_canon.starts_with(&skills_dir) {
                return Err("This skill is already in fmGUI.".into());
            }
            if skills_dir.starts_with(&src_canon) {
                return Err("Pick the skill folder itself, not a folder that contains fmGUI's data.".into());
            }
        }

        let skill_file = match &single_file {
            Some(f) => f.clone(),
            None => find_skill_file(&src_dir).ok_or("This folder has no SKILL.md file.")?,
        };
        let text = read_text(&skill_file).ok_or("Could not read the SKILL.md file.")?;
        let (fm, _) = frontmatter::parse_skill_md(&text);
        let fallback = match &single_file {
            Some(f) => f.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
            None => src_dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
        };
        let raw_name = fm.name.clone().unwrap_or(fallback);
        let name = import_name(&raw_name);
        let target = self.dir.join(&name);
        if self.get(&name).is_some() || target.exists() {
            return Err(format!("A skill named \"{name}\" already exists. Delete or rename it first."));
        }

        fs::create_dir_all(&self.dir).map_err(|e| format!("Could not create the skills folder: {e}"))?;
        let staging = self.dir.join(format!(".import-{}", crate::util::new_id()));
        let result = (|| -> Result<(), String> {
            match &single_file {
                Some(file) => {
                    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
                    fs::copy(file, staging.join(SKILL_FILE)).map_err(|e| format!("Could not copy the file: {e}"))?;
                }
                None => copy_tree(&src_dir, &staging, 0, &mut CopyState { files: 0 })?,
            }
            // The file must be called exactly SKILL.md.
            let copied = find_skill_file(&staging).ok_or("The SKILL.md file was not copied (is it larger than 2 MB?).")?;
            let exact = staging.join(SKILL_FILE);
            if copied.file_name() != exact.file_name() {
                let tmp = staging.join(".skill-rename.tmp");
                fs::rename(&copied, &tmp).and_then(|_| fs::rename(&tmp, &exact)).map_err(|e| e.to_string())?;
            }
            // Make the front matter name match the folder.
            if fm.name.as_deref() != Some(name.as_str()) {
                let text = read_text(&exact).unwrap_or_default();
                write_atomic(&exact, &frontmatter::set_name(&text, &name))?;
            }
            fs::rename(&staging, &target).map_err(|e| format!("Could not move the skill into place: {e}"))
        })();
        if let Err(err) = result {
            let _ = fs::remove_dir_all(&staging);
            return Err(err);
        }
        load_skill_folder(&target).ok_or_else(|| "The skill was imported but could not be read back.".into())
    }
}

/// The name a skill gets when imported: its own name when valid, else a cleaned-up one.
fn import_name(raw: &str) -> String {
    let raw = raw.trim();
    if validate_name(raw).is_ok() {
        raw.to_string()
    } else {
        sanitize_name(raw)
    }
}

/// Folders that `skills_import_candidates` scans.
pub fn default_import_sources() -> Vec<(PathBuf, String)> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    vec![
        (home.join(".claude").join("skills"), "~/.claude/skills".to_string()),
        (home.join(".agents").join("skills"), "~/.agents/skills".to_string()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, description: &str, body: &str, original: Option<&str>) -> SkillInput {
        SkillInput {
            original_name: original.map(str::to_string),
            name: name.into(),
            description: description.into(),
            body: body.into(),
        }
    }

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn validates_names() {
        assert!(validate_name("pdf-tools").is_ok());
        assert!(validate_name("a").is_ok());
        assert!(validate_name("v2-notes-3").is_ok());
        assert!(validate_name(&"a".repeat(64)).is_ok());
        assert!(validate_name(&"a".repeat(65)).unwrap_err().contains("64"));
        assert!(validate_name("").is_err());
        for bad in ["PDF", "pdf_tools", "pdf tools", "../x", "é", "a/b", "a.b"] {
            assert!(validate_name(bad).is_err(), "{bad}");
        }
        assert_eq!(sanitize_name("My PDF_Tools!"), "my-pdf-tools");
        assert_eq!(sanitize_name("engineering:debug"), "engineering-debug");
        assert_eq!(sanitize_name("***"), "imported-skill");
        assert_eq!(sanitize_name(&"ab".repeat(40)).len(), 64);
    }

    #[test]
    fn save_list_get_rename_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let store = SkillStore::new(tmp.path().join("skills"));
        assert!(store.list().is_empty());

        let skill = store.save(&input("notes", "Takes meeting notes.", "# Notes\nWrite bullets.", None)).unwrap();
        assert_eq!(skill.name, "notes");
        assert_eq!(skill.body, "# Notes\nWrite bullets.");
        assert_eq!(skill.token_estimate, crate::util::estimate_tokens("# Notes\nWrite bullets."));
        assert!(skill.path.ends_with("/skills/notes"));
        let text = fs::read_to_string(tmp.path().join("skills/notes/SKILL.md")).unwrap();
        assert_eq!(text, "---\nname: notes\ndescription: Takes meeting notes.\n---\n\n# Notes\nWrite bullets.\n");

        // Validation.
        assert!(store.save(&input("Bad Name", "d", "b", None)).is_err());
        assert!(store.save(&input("ok", "  ", "b", None)).unwrap_err().contains("description"));
        assert!(store.save(&input("ok", &"x".repeat(1025), "b", None)).unwrap_err().contains("too long"));

        // Update in place keeps extra files and extra front matter keys.
        write(&tmp.path().join("skills/notes/scripts/run.sh"), "echo hi");
        let mut text = fs::read_to_string(tmp.path().join("skills/notes/SKILL.md")).unwrap();
        text = text.replacen("---\n\n", "license: MIT\n---\n\n", 1);
        fs::write(tmp.path().join("skills/notes/SKILL.md"), text).unwrap();
        let skill = store.save(&input("notes", "Takes notes: short ones.", "New body", Some("notes"))).unwrap();
        assert_eq!(skill.description, "Takes notes: short ones.");
        assert_eq!(skill.files, vec!["scripts/run.sh".to_string()]);
        assert!(fs::read_to_string(tmp.path().join("skills/notes/SKILL.md")).unwrap().contains("license: MIT"));

        // Rename moves the folder.
        store.save(&input("other", "Another skill.", "x", None)).unwrap();
        assert!(store.save(&input("other", "d", "b", Some("notes"))).unwrap_err().contains("already exists"));
        let renamed = store.save(&input("meeting-notes", "Takes notes.", "Body", Some("notes"))).unwrap();
        assert!(renamed.path.ends_with("/meeting-notes"));
        assert!(!tmp.path().join("skills/notes").exists());
        assert_eq!(renamed.files, vec!["scripts/run.sh".to_string()]);
        let names: Vec<String> = store.list().into_iter().map(|s| s.name).collect();
        assert_eq!(names, ["meeting-notes", "other"]);
        assert!(store.get("meeting-notes").is_some());
        assert!(store.get("notes").is_none());

        // Broken folders are skipped.
        fs::create_dir_all(tmp.path().join("skills/empty-folder")).unwrap();
        assert_eq!(store.list().len(), 2);

        store.delete("other").unwrap();
        assert!(!tmp.path().join("skills/other").exists());
        assert!(store.delete("other").unwrap_err().contains("no skill"));
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn name_comes_from_front_matter_or_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let store = SkillStore::new(tmp.path().to_path_buf());
        write(&tmp.path().join("folder-name/SKILL.md"), "Just a body, no front matter.");
        write(&tmp.path().join("x/skill.md"), "---\nname: from-front-matter\ndescription: >\n  Folded\n  text.\n---\nBody");
        let skills = store.list();
        assert_eq!(skills[0].name, "folder-name");
        assert_eq!(skills[0].description, "");
        assert_eq!(skills[1].name, "from-front-matter");
        assert_eq!(skills[1].description, "Folded text.");
        // get() finds it even though the folder name differs.
        assert_eq!(store.get("from-front-matter").unwrap().body, "Body");
    }

    #[test]
    fn imports_folders_and_files() {
        let tmp = tempfile::tempdir().unwrap();
        let store = SkillStore::new(tmp.path().join("skills"));
        let src = tmp.path().join("claude/skills/pdf");
        write(&src.join("SKILL.md"), "---\nname: pdf\ndescription: Work with PDF files.\nlicense: MIT\n---\nUse pdftotext.");
        write(&src.join("scripts/fill.py"), "print('fill')");
        write(&src.join(".git/HEAD"), "ref");
        fs::write(src.join("big.bin"), vec![0u8; (MAX_IMPORT_FILE_BYTES + 1) as usize]).unwrap();

        // Candidates.
        let sources = vec![(tmp.path().join("claude/skills"), "~/.claude/skills".to_string())];
        let cands = store.import_candidates(&sources);
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].name, "pdf");
        assert_eq!(cands[0].source, "~/.claude/skills");
        assert!(!cands[0].already_imported);

        // Import by folder.
        let skill = store.import(&src.display().to_string()).unwrap();
        assert_eq!(skill.name, "pdf");
        assert_eq!(skill.files, vec!["scripts/fill.py".to_string()]);
        assert!(!tmp.path().join("skills/pdf/.git").exists());
        assert!(!tmp.path().join("skills/pdf/big.bin").exists());
        assert!(store.import_candidates(&sources)[0].already_imported);
        // Same name again is refused.
        assert!(store.import(&src.join("SKILL.md").display().to_string()).unwrap_err().contains("already exists"));
        // No staging folders left behind.
        assert!(fs::read_dir(tmp.path().join("skills")).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(".import")));

        // Import a SKILL.md path whose name is not valid: it gets a clean name.
        let odd = tmp.path().join("agents/skills/Odd_Skill");
        write(&odd.join("skill.md"), "---\nname: Odd Skill\ndescription: Odd one.\n---\nBody");
        let skill = store.import(&odd.join("skill.md").display().to_string()).unwrap();
        assert_eq!(skill.name, "odd-skill");
        assert!(tmp.path().join("skills/odd-skill/SKILL.md").is_file());
        assert_eq!(store.get("odd-skill").unwrap().description, "Odd one.");

        // A single markdown file.
        let single = tmp.path().join("loose/writing-style.md");
        write(&single, "---\ndescription: House writing style.\n---\nShort sentences.");
        let skill = store.import(&single.display().to_string()).unwrap();
        assert_eq!(skill.name, "writing-style");
        assert_eq!(skill.body, "Short sentences.");

        // Errors.
        assert!(store.import("/no/such/path").unwrap_err().starts_with("Nothing was found"));
        fs::create_dir_all(tmp.path().join("no-skill")).unwrap();
        assert!(store.import(&tmp.path().join("no-skill").display().to_string()).unwrap_err().contains("no SKILL.md"));
        assert!(store.import(&tmp.path().join("skills/pdf").display().to_string()).unwrap_err().contains("already"));
    }

    #[test]
    fn import_stops_after_200_files() {
        let tmp = tempfile::tempdir().unwrap();
        let store = SkillStore::new(tmp.path().join("skills"));
        let src = tmp.path().join("many");
        write(&src.join("SKILL.md"), "---\nname: many\ndescription: Many files.\n---\nx");
        for i in 0..250 {
            write(&src.join(format!("data/f{i:03}.txt")), "x");
        }
        let skill = store.import(&src.display().to_string()).unwrap();
        let copied = fs::read_dir(tmp.path().join("skills/many/data")).unwrap().count();
        assert_eq!(copied, MAX_IMPORT_FILES - 1); // SKILL.md counts too
        assert_eq!(skill.files.len(), MAX_LISTED_FILES);
    }
}
