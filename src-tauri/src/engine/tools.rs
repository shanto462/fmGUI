//! The tool catalog: built-in tools, custom tools (config), MCP tools
//! (connected servers) and `use_skill`. Gives every tool a unique
//! model-facing name and runs tools.

use super::builtin::{self, Builtin, BuiltinEnv, BUILTINS};
use super::{custom, schema, ToolInfo, ToolTestResult};
use crate::config::{AppConfig, Approval, CustomTool, CustomToolKind, SkillMode, ToolParam};
use crate::mcp::McpToolDescriptor;
use crate::skills::Skill;
use crate::state::AppState;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::{Duration, Instant};

/// Model-facing names: `[a-z0-9_]`, at most this many characters.
pub const MAX_NAME: usize = 48;
/// Default limit for one tool result sent to the model.
pub const DEFAULT_RESULT_CHARS: usize = 4000;
/// The MCP client has its own 120 s limit for `tools/call` (with a clear
/// message); this outer limit only catches a stuck transport.
const MCP_TIMEOUT: Duration = Duration::from_secs(crate::mcp::rpc::CALL_TIMEOUT.as_secs() + 5);

#[derive(Debug, Clone)]
pub enum ToolKind {
    Builtin(Builtin),
    Custom(CustomTool),
    Mcp { server_id: String, tool: String },
    UseSkill { skills: Vec<String> },
}

/// A tool with everything the router needs.
#[derive(Debug, Clone)]
pub struct CatalogTool {
    pub info: ToolInfo,
    pub kind: ToolKind,
}

impl CatalogTool {
    pub fn approval(&self) -> Approval {
        if self.info.approval == "always" {
            Approval::Always
        } else {
            Approval::Ask
        }
    }

    /// One line of the tool guide: `name(arg: type, …): description`.
    pub fn guide_line(&self) -> String {
        let desc = schema::clean_description_len(&self.info.description, 200);
        let sig = schema::signature(&self.info.input_schema);
        if desc.is_empty() {
            format!("- {}({sig})", self.info.name)
        } else {
            format!("- {}({sig}): {desc}", self.info.name)
        }
    }

    pub fn timeout(&self) -> Duration {
        match &self.kind {
            ToolKind::Builtin(b) => Duration::from_secs(builtin::spec(*b).timeout_secs),
            ToolKind::Custom(t) => custom::timeout_of(t) + Duration::from_secs(5),
            ToolKind::Mcp { .. } => MCP_TIMEOUT,
            ToolKind::UseSkill { .. } => Duration::from_secs(5),
        }
    }
}

/// Lowercase, `[a-z0-9_]`, no double underscores, at most 48 characters.
pub fn model_name(raw: &str) -> String {
    let mut out = String::new();
    for c in raw.trim().chars() {
        let c = c.to_ascii_lowercase();
        let c = if c.is_ascii_alphanumeric() { c } else { '_' };
        if c == '_' && (out.is_empty() || out.ends_with('_')) {
            continue;
        }
        out.push(c);
    }
    let mut out = out.trim_end_matches('_').to_string();
    out.truncate(MAX_NAME);
    let out = out.trim_end_matches('_').to_string();
    if out.is_empty() {
        "tool".into()
    } else {
        out
    }
}

/// Picks a unique name: `base`, else `<slug>_<base>`, else `<base>_2`, `_3`, ...
pub fn unique_name(base: &str, slug: &str, used: &mut HashSet<String>) -> String {
    let base = model_name(base);
    let mut name = base.clone();
    if used.contains(&name) {
        name = model_name(&format!("{}_{base}", model_name(slug)));
    }
    let mut n = 2;
    while used.contains(&name) {
        let suffix = format!("_{n}");
        let mut stem = base.clone();
        stem.truncate(MAX_NAME - suffix.len());
        name = format!("{}{suffix}", stem.trim_end_matches('_'));
        n += 1;
    }
    used.insert(name.clone());
    name
}

fn humanize(name: &str) -> String {
    let words = name.replace(['_', '-'], " ");
    let mut chars = words.trim().chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => name.to_string(),
    }
}

fn approval_text(a: Approval) -> String {
    match a {
        Approval::Ask => "ask".into(),
        Approval::Always => "always".into(),
    }
}

fn token_estimate(name: &str, description: &str, schema: &Value) -> u32 {
    crate::util::estimate_tokens(&format!("{name} {description} {schema}"))
}

/// Builds the full catalog (enabled or not). Pure: easy to test.
pub fn build_catalog(cfg: &AppConfig, mcp_tools: &[McpToolDescriptor], skills: &[Skill]) -> Vec<CatalogTool> {
    let mut used: HashSet<String> = HashSet::from(["answer".to_string()]);
    let mut out = Vec::new();

    for spec in BUILTINS {
        let prefs = cfg.builtin_prefs(spec.name, spec.default_enabled, spec.default_approval);
        let params: Vec<ToolParam> = spec
            .params
            .iter()
            .map(|(name, kind, description, required)| ToolParam {
                name: name.to_string(),
                kind: *kind,
                description: description.to_string(),
                required: *required,
            })
            .collect();
        let name = unique_name(spec.name, "builtin", &mut used);
        let mut input_schema = schema::params_to_schema(&params);
        input_schema["title"] = json!(format!("{name}_arguments"));
        out.push(CatalogTool {
            info: ToolInfo {
                id: format!("builtin:{}", spec.name),
                token_estimate: token_estimate(&name, spec.description, &input_schema),
                name,
                title: spec.title.into(),
                description: spec.description.into(),
                source: "builtin".into(),
                source_label: "Built-in".into(),
                enabled: prefs.enabled,
                approval: approval_text(prefs.approval),
                input_schema,
                dangerous: spec.dangerous,
            },
            kind: ToolKind::Builtin(spec.kind),
        });
    }

    let on_demand: Vec<&Skill> = skills.iter().filter(|s| cfg.skill_mode(&s.name) == SkillMode::OnDemand).collect();
    if !on_demand.is_empty() {
        let names: Vec<String> = on_demand.iter().map(|s| s.name.clone()).collect();
        let name = unique_name("use_skill", "skill", &mut used);
        let input_schema = json!({
            "title": format!("{name}_arguments"),
            "type": "object",
            "additionalProperties": false,
            "properties": { "name": { "type": "string", "description": "Name of the skill to load.", "enum": names } },
            "required": ["name"],
            "x-order": ["name"],
        });
        let description = "Load the full instructions of a skill before you do a task it covers.";
        out.push(CatalogTool {
            info: ToolInfo {
                id: "skill:use_skill".into(),
                token_estimate: token_estimate(&name, description, &input_schema),
                name,
                title: "Use skill".into(),
                description: description.into(),
                source: "skill".into(),
                source_label: "Skills".into(),
                enabled: true,
                approval: "always".into(),
                input_schema,
                dangerous: false,
            },
            kind: ToolKind::UseSkill { skills: names },
        });
    }

    for tool in &cfg.custom_tools {
        let name = unique_name(&tool.name, "custom", &mut used);
        let mut input_schema = schema::params_to_schema(&tool.params);
        input_schema["title"] = json!(format!("{name}_arguments"));
        let (label, dangerous) = match &tool.kind {
            CustomToolKind::Shell { .. } => ("Shell", true),
            CustomToolKind::Http { method, .. } => ("HTTP", !method.trim().eq_ignore_ascii_case("GET")),
            CustomToolKind::Shortcut { .. } => ("Shortcut", true),
        };
        out.push(CatalogTool {
            info: ToolInfo {
                id: format!("custom:{}", tool.id),
                token_estimate: token_estimate(&name, &tool.description, &input_schema),
                name,
                title: humanize(&tool.name),
                description: tool.description.clone(),
                source: "custom".into(),
                source_label: label.into(),
                enabled: tool.enabled,
                approval: approval_text(tool.approval),
                input_schema,
                dangerous,
            },
            kind: ToolKind::Custom(tool.clone()),
        });
    }

    for tool in mcp_tools {
        let server = cfg.mcp_servers.iter().find(|s| s.id == tool.server_id);
        let enabled = server.map(|s| s.enabled && !s.disabled_tools.iter().any(|d| d == &tool.name)).unwrap_or(false);
        let approval = server.map(|s| s.approval).unwrap_or(Approval::Ask);
        let slug = server.map(|s| s.name.as_str()).unwrap_or(&tool.server_name);
        let name = unique_name(&tool.name, slug, &mut used);
        let input_schema = schema::sanitize(&tool.input_schema, &format!("{name}_arguments"));
        out.push(CatalogTool {
            info: ToolInfo {
                id: format!("mcp:{}:{}", tool.server_id, tool.name),
                token_estimate: token_estimate(&name, &tool.description, &input_schema),
                name,
                title: humanize(&tool.name),
                description: tool.description.clone(),
                source: "mcp".into(),
                source_label: server.map(|s| s.name.clone()).unwrap_or_else(|| tool.server_name.clone()),
                enabled,
                approval: approval_text(approval),
                input_schema,
                dangerous: false,
            },
            kind: ToolKind::Mcp { server_id: tool.server_id.clone(), tool: tool.name.clone() },
        });
    }
    out
}

/// The catalog for the current app state.
pub async fn catalog(state: &AppState, cfg: &AppConfig) -> Vec<CatalogTool> {
    let mcp_tools = state.mcp.tools().await;
    let skills = state.skills.list();
    build_catalog(cfg, &mcp_tools, &skills)
}

/// Runs a tool (no approval check, no timeout: the caller adds those).
pub async fn execute(state: &AppState, cfg: &AppConfig, tool: &CatalogTool, args: &Value) -> Result<String, String> {
    match &tool.kind {
        ToolKind::Builtin(kind) => {
            let env = BuiltinEnv { allowed_folders: &cfg.allowed_folders, tmp_dir: &state.paths.tmp_dir };
            builtin::run(*kind, args, &env).await
        }
        ToolKind::Custom(t) => custom::run(t, args, &state.paths.tmp_dir).await,
        ToolKind::Mcp { server_id, tool: name } => {
            let args = if args.is_object() { args.clone() } else { json!({}) };
            state.mcp.call_tool(server_id, name, args).await
        }
        ToolKind::UseSkill { skills } => {
            let name = builtin::arg_str(args, "name")?;
            match state.skills.get(name) {
                Some(skill) => Ok(format!("Skill \"{}\" instructions:\n\n{}", skill.name, skill.body.trim())),
                None => Err(format!("There is no skill named \"{name}\". Skills: {}", skills.join(", "))),
            }
        }
    }
}

/// Runs with the tool's timeout.
pub async fn execute_with_timeout(
    state: &AppState,
    cfg: &AppConfig,
    tool: &CatalogTool,
    args: &Value,
) -> Result<String, String> {
    let limit = tool.timeout();
    match tokio::time::timeout(limit, execute(state, cfg, tool, args)).await {
        Ok(result) => result,
        Err(_) => Err(format!("The tool took longer than {} seconds and was stopped.", limit.as_secs())),
    }
}

/// Tool test from the Tools page: no model, no approval.
pub async fn test_tool(state: &AppState, tool_id: &str, args: &Value) -> Result<ToolTestResult, String> {
    let cfg = state.config();
    let all = catalog(state, &cfg).await;
    let tool = all.iter().find(|t| t.info.id == tool_id).ok_or_else(|| format!("No tool with id \"{tool_id}\"."))?;
    Ok(timed(execute_with_timeout(state, &cfg, tool, args)).await)
}

/// Tests an unsaved custom tool.
pub async fn test_custom(state: &AppState, tool: &CustomTool, args: &Value) -> ToolTestResult {
    let limit = custom::timeout_of(tool) + Duration::from_secs(5);
    timed(async {
        match tokio::time::timeout(limit, custom::run(tool, args, &state.paths.tmp_dir)).await {
            Ok(r) => r,
            Err(_) => Err(format!("The tool took longer than {} seconds and was stopped.", limit.as_secs())),
        }
    })
    .await
}

async fn timed(fut: impl std::future::Future<Output = Result<String, String>>) -> ToolTestResult {
    let started = Instant::now();
    let result = fut.await;
    let duration_ms = started.elapsed().as_millis() as u64;
    match result {
        Ok(output) => ToolTestResult { ok: true, output: crate::util::truncate_chars(&output, 20_000), duration_ms },
        Err(output) => ToolTestResult { ok: false, output: crate::util::truncate_chars(&output, 20_000), duration_ms },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{McpServerConfig, McpTransport, ParamType, SkillPrefs, ToolPrefs};

    fn custom(id: &str, name: &str) -> CustomTool {
        CustomTool {
            id: id.into(),
            name: name.into(),
            description: "Look up an order".into(),
            params: vec![ToolParam {
                name: "order_id".into(),
                kind: ParamType::String,
                description: "Order id".into(),
                required: true,
            }],
            kind: CustomToolKind::Shell { command: "echo hi".into(), cwd: None, timeout_secs: 10 },
            enabled: true,
            approval: Approval::Ask,
        }
    }

    #[test]
    fn names_are_clean() {
        assert_eq!(model_name("Lookup Order!"), "lookup_order");
        assert_eq!(model_name("  read-file__v2 "), "read_file_v2");
        assert_eq!(model_name("***"), "tool");
        assert_eq!(model_name(&"a".repeat(80)).len(), MAX_NAME);
    }

    #[test]
    fn clashing_names_get_prefixes() {
        let mut used = HashSet::from(["answer".to_string()]);
        assert_eq!(unique_name("calculator", "builtin", &mut used), "calculator");
        assert_eq!(unique_name("calculator", "My Server", &mut used), "my_server_calculator");
        assert_eq!(unique_name("calculator", "My Server", &mut used), "calculator_2");
        assert_eq!(unique_name("answer", "custom", &mut used), "custom_answer");
        let long = "x".repeat(60);
        let a = unique_name(&long, &"s".repeat(60), &mut used);
        let b = unique_name(&long, &"s".repeat(60), &mut used);
        let c = unique_name(&long, &"s".repeat(60), &mut used);
        assert!(a.len() <= MAX_NAME && b.len() <= MAX_NAME && c.len() <= MAX_NAME);
        assert_ne!(a, b);
        assert_ne!(b, c);
    }

    #[test]
    fn catalog_has_all_sources_with_unique_names() {
        let mut cfg = AppConfig::default();
        cfg.custom_tools.push(custom("c1", "calculator"));
        cfg.custom_tools.push(custom("c2", "lookup_order"));
        cfg.builtin_tools.insert("fetch_url".into(), ToolPrefs { enabled: false, approval: Approval::Always });
        cfg.mcp_servers.push(McpServerConfig {
            id: "m1".into(),
            name: "Files".into(),
            enabled: true,
            transport: McpTransport::Stdio { command: "x".into(), args: vec![], env: vec![], cwd: None },
            disabled_tools: vec!["delete".into()],
            approval: Approval::Always,
        });
        cfg.skills.insert("off-skill".into(), SkillPrefs { mode: SkillMode::Off });
        let mcp = vec![
            McpToolDescriptor {
                server_id: "m1".into(),
                server_name: "files".into(),
                name: "lookup_order".into(),
                description: "MCP lookup".into(),
                input_schema: json!({"type": "object", "properties": {"id": {"type": "string", "format": "uuid"}}}),
            },
            McpToolDescriptor {
                server_id: "m1".into(),
                server_name: "files".into(),
                name: "delete".into(),
                description: "Delete".into(),
                input_schema: json!({}),
            },
        ];
        let skills = vec![
            Skill {
                name: "pdf-tips".into(),
                description: "PDF help".into(),
                body: "Use pdftotext.".into(),
                ..Default::default()
            },
            Skill { name: "off-skill".into(), description: "Off".into(), body: "x".into(), ..Default::default() },
        ];
        let cat = build_catalog(&cfg, &mcp, &skills);
        let names: Vec<&str> = cat.iter().map(|t| t.info.name.as_str()).collect();
        let unique: HashSet<&str> = names.iter().copied().collect();
        assert_eq!(unique.len(), names.len(), "{names:?}");
        assert!(names.contains(&"custom_calculator"), "{names:?}");
        assert!(names.contains(&"files_lookup_order"), "{names:?}");
        assert!(names.contains(&"use_skill"));

        let fetch = cat.iter().find(|t| t.info.id == "builtin:fetch_url").unwrap();
        assert!(!fetch.info.enabled);
        assert_eq!(fetch.info.approval, "always");
        let calc = cat.iter().find(|t| t.info.id == "builtin:calculator").unwrap();
        assert!(calc.info.enabled);
        assert_eq!(calc.approval(), Approval::Always);
        assert!(calc.guide_line().starts_with("- calculator(expression: string): Calculate"));
        let write = cat.iter().find(|t| t.info.id == "builtin:write_file").unwrap();
        assert!(!write.info.enabled && write.info.dangerous);

        let skill = cat.iter().find(|t| t.info.id == "skill:use_skill").unwrap();
        assert_eq!(skill.info.input_schema["properties"]["name"]["enum"], json!(["pdf-tips"]));

        let deleted = cat.iter().find(|t| t.info.id == "mcp:m1:delete").unwrap();
        assert!(!deleted.info.enabled);
        let lookup = cat.iter().find(|t| t.info.id == "mcp:m1:lookup_order").unwrap();
        assert!(lookup.info.enabled);
        assert_eq!(lookup.info.approval, "always");
        assert_eq!(lookup.info.source_label, "Files");
        assert_eq!(lookup.info.input_schema["properties"]["id"], json!({"type": "string"}));
        assert!(cat.iter().all(|t| t.info.token_estimate > 0));
    }

    #[test]
    fn no_use_skill_without_on_demand_skills() {
        let cat = build_catalog(&AppConfig::default(), &[], &[]);
        assert!(cat.iter().all(|t| t.info.id != "skill:use_skill"));
        assert_eq!(cat.len(), BUILTINS.len());
    }
}
