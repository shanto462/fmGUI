//! JSON Schema → the shape `fm serve` accepts for guided generation.
//!
//! `fm` only understands schemas that look like its own (`fm schema object`):
//! every object has `title`, `type: "object"`, `additionalProperties: false`,
//! `properties`, `required` and `x-order`. Scalars are string, integer,
//! number and boolean; strings may have an `enum`; arrays have `items`.
//! MCP servers and users write richer schemas, so we simplify them here.

use crate::config::{ParamType, ToolParam};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

/// How deep `$ref`s are followed before we give up and use a string.
const MAX_REF_DEPTH: usize = 4;
/// How deep objects may nest before we use a string.
const MAX_NESTING: usize = 6;
/// Guards against hostile or broken schemas from MCP servers: how deep the
/// sanitizer may recurse (`allOf` of a `$ref` to itself, ...) and how many
/// nodes it may visit in total (a `$ref` used many times at every level).
const MAX_RECURSION: usize = 64;
const MAX_NODES: usize = 2000;
/// Long descriptions waste the small context window.
const MAX_DESCRIPTION: usize = 300;

/// Sanitizes a tool's input schema. The result is always an object schema
/// with the given title.
pub fn sanitize(schema: &Value, title: &str) -> Value {
    let mut ctx = Ctx { root: schema, stack: Vec::new(), depth: 0, visits: 0 };
    let title = clean_title(title);
    let (node, _) = ctx.node(schema, &title, 0, 0);
    if node.get("type").and_then(Value::as_str) == Some("object") {
        node
    } else {
        empty_object(&title)
    }
}

/// An object schema with no properties (tools without arguments).
pub fn empty_object(title: &str) -> Value {
    json!({
        "title": clean_title(title),
        "type": "object",
        "additionalProperties": false,
        "properties": {},
        "required": [],
        "x-order": [],
    })
}

/// Builds the argument schema of a custom tool from its parameter list.
pub fn params_to_schema(params: &[ToolParam]) -> Value {
    let mut properties = Map::new();
    let mut order = Vec::new();
    let mut required = Vec::new();
    for p in params {
        let name = p.name.trim();
        if name.is_empty() || properties.contains_key(name) {
            continue;
        }
        let kind = match p.kind {
            ParamType::String => "string",
            ParamType::Integer => "integer",
            ParamType::Number => "number",
            ParamType::Boolean => "boolean",
        };
        let mut prop = Map::new();
        prop.insert("type".into(), json!(kind));
        let desc = clean_description(&p.description);
        if !desc.is_empty() {
            prop.insert("description".into(), json!(desc));
        }
        properties.insert(name.to_string(), Value::Object(prop));
        order.push(json!(name));
        if p.required {
            required.push(json!(name));
        }
    }
    json!({
        "title": "Arguments",
        "type": "object",
        "additionalProperties": false,
        "properties": properties,
        "required": required,
        "x-order": order,
    })
}

/// The guided-JSON router schema (see `router`): a root `anyOf` with one
/// branch per tool, `{"<tool>": {args}}`, plus `{"answer": {}}` ("I can
/// answer now"; the answer is then streamed as plain text).
/// `tools` holds (model-facing name, sanitized args schema, description).
pub fn router_schema(tools: &[(String, Value, String)]) -> Value {
    let mut defs = Map::new();
    let mut any_of = Vec::new();
    for (name, args, description) in tools {
        if name == "answer" || defs.contains_key(name) {
            continue;
        }
        let mut args = args.clone();
        retitle(&mut args, &format!("{name}_arguments"));
        if let (Some(obj), false) = (args.as_object_mut(), description.trim().is_empty()) {
            obj.insert("description".into(), json!(clean_description_len(description, 160)));
        }
        defs.insert(
            name.clone(),
            json!({
                "title": name,
                "type": "object",
                "additionalProperties": false,
                "properties": { name: args },
                "required": [name],
                "x-order": [name],
            }),
        );
        any_of.push(json!({ "$ref": format!("#/$defs/{name}") }));
    }
    // The answer itself is written afterwards as plain streamed text: a
    // long answer inside guided JSON arrives as one chunk at the end, loses
    // its Markdown line breaks, and can run away with greedy decoding.
    defs.insert(
        "answer".into(),
        json!({
            "title": "answer",
            "type": "object",
            "additionalProperties": false,
            "properties": { "answer": empty_object("answer_arguments") },
            "required": ["answer"],
            "x-order": ["answer"],
        }),
    );
    any_of.push(json!({ "$ref": "#/$defs/answer" }));
    json!({ "title": "Action", "anyOf": any_of, "$defs": defs })
}

/// Short type text for the tool guide, e.g. `order_id: string, count?: integer`.
pub fn signature(schema: &Value) -> String {
    let props = match schema.get("properties").and_then(Value::as_object) {
        Some(p) => p,
        None => return String::new(),
    };
    let required: BTreeSet<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    order_of(schema)
        .iter()
        .filter_map(|name| props.get(name).map(|p| (name, p)))
        .map(|(name, p)| {
            let opt = if required.contains(name.as_str()) { "" } else { "?" };
            format!("{name}{opt}: {}", type_text(p))
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn type_text(p: &Value) -> String {
    let ty = p.get("type").and_then(Value::as_str).unwrap_or("string");
    match ty {
        "string" => match p.get("enum").and_then(Value::as_array) {
            Some(values) if !values.is_empty() => {
                values.iter().filter_map(Value::as_str).map(|v| format!("\"{v}\"")).collect::<Vec<_>>().join("|")
            }
            _ => "string".into(),
        },
        "array" => format!("array of {}", p.get("items").map(type_text).unwrap_or_else(|| "string".into())),
        "object" => format!("{{{}}}", signature(p)),
        other => other.to_string(),
    }
}

/// Property names in generation order (`x-order`, else `required` then the rest).
pub fn order_of(schema: &Value) -> Vec<String> {
    let props = match schema.get("properties").and_then(Value::as_object) {
        Some(p) => p,
        None => return Vec::new(),
    };
    let mut order: Vec<String> = Vec::new();
    let candidates = schema
        .get("x-order")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .chain(schema.get("required").and_then(Value::as_array).into_iter().flatten())
        .filter_map(Value::as_str);
    for name in candidates {
        if props.contains_key(name) && !order.iter().any(|o| o == name) {
            order.push(name.to_string());
        }
    }
    for name in props.keys() {
        if !order.iter().any(|o| o == name) {
            order.push(name.clone());
        }
    }
    order
}

struct Ctx<'a> {
    root: &'a Value,
    /// `$ref`s being resolved (cycle guard).
    stack: Vec<String>,
    /// Current recursion depth and total nodes visited (see `MAX_RECURSION`).
    depth: usize,
    visits: usize,
}

impl<'a> Ctx<'a> {
    /// Returns the sanitized node and whether it may be null (then the
    /// property becomes optional).
    fn node(&mut self, schema: &Value, title: &str, ref_depth: usize, nesting: usize) -> (Value, bool) {
        self.visits += 1;
        if self.depth >= MAX_RECURSION || self.visits > MAX_NODES {
            return (string_schema(None), false);
        }
        self.depth += 1;
        let out = self.node_inner(schema, title, ref_depth, nesting);
        self.depth -= 1;
        out
    }

    fn node_inner(&mut self, schema: &Value, title: &str, ref_depth: usize, nesting: usize) -> (Value, bool) {
        let obj = match schema.as_object() {
            Some(o) => o,
            None => return (string_schema(None), false),
        };
        let desc = obj.get("description").and_then(Value::as_str).map(clean_description).filter(|d| !d.is_empty());

        if let Some(reference) = obj.get("$ref").and_then(Value::as_str) {
            if ref_depth >= MAX_REF_DEPTH || self.stack.iter().any(|r| r == reference) {
                return (string_schema(desc.as_deref()), false);
            }
            let target = match resolve_ref(self.root, reference) {
                Some(t) => t.clone(),
                None => return (string_schema(desc.as_deref()), false),
            };
            // Sibling keywords (description, ...) win over the target's.
            let mut merged = target.as_object().cloned().unwrap_or_default();
            for (k, v) in obj {
                if k != "$ref" {
                    merged.insert(k.clone(), v.clone());
                }
            }
            self.stack.push(reference.to_string());
            let out = self.node(&Value::Object(merged), title, ref_depth + 1, nesting);
            self.stack.pop();
            return out;
        }

        for key in ["anyOf", "oneOf"] {
            if let Some(branches) = obj.get(key).and_then(Value::as_array) {
                let mut nullable = false;
                let mut usable: Vec<&Value> = Vec::new();
                for b in branches {
                    if is_null_schema(b) {
                        nullable = true;
                    } else {
                        usable.push(b);
                    }
                }
                if let Some(values) = string_consts(&usable) {
                    return (string_enum(values, desc.as_deref()), nullable);
                }
                let mut base = obj.clone();
                base.remove(key);
                return match usable.first() {
                    Some(first) => {
                        let merged = merge_into(&base, first);
                        let (v, n) = self.node(&merged, title, ref_depth, nesting);
                        (v, nullable || n)
                    }
                    None => (string_schema(desc.as_deref()), true),
                };
            }
        }

        if let Some(parts) = obj.get("allOf").and_then(Value::as_array) {
            let mut base = obj.clone();
            base.remove("allOf");
            let mut merged = Value::Object(base);
            for part in parts {
                let part = match part.get("$ref").and_then(Value::as_str).and_then(|r| resolve_ref(self.root, r)) {
                    Some(target) => target.clone(),
                    None => part.clone(),
                };
                merged = merge_all_of(&merged, &part);
            }
            return self.node(&merged, title, ref_depth, nesting);
        }

        let (ty, nullable) = match obj.get("type") {
            Some(Value::String(t)) => (t.clone(), t == "null"),
            Some(Value::Array(types)) => {
                let names: Vec<&str> = types.iter().filter_map(Value::as_str).collect();
                let nullable = names.contains(&"null");
                let first =
                    names.iter().find(|t| **t != "null").map(|t| t.to_string()).unwrap_or_else(|| "string".into());
                (first, nullable)
            }
            _ => (infer_type(obj), false),
        };

        let node = match ty.as_str() {
            "object" => {
                if nesting >= MAX_NESTING {
                    string_schema(desc.as_deref())
                } else {
                    self.object(obj, title, desc.as_deref(), ref_depth, nesting)
                }
            }
            "array" => {
                let items = match obj.get("items") {
                    Some(Value::Array(list)) => list.first().cloned().unwrap_or(json!({"type": "string"})),
                    Some(other) => other.clone(),
                    None => json!({"type": "string"}),
                };
                let (items, _) = if nesting >= MAX_NESTING {
                    (string_schema(None), false)
                } else {
                    self.node(&items, &format!("{title}_item"), ref_depth, nesting + 1)
                };
                let mut out = Map::new();
                out.insert("type".into(), json!("array"));
                if let Some(d) = &desc {
                    out.insert("description".into(), json!(d));
                }
                out.insert("items".into(), items);
                Value::Object(out)
            }
            "integer" | "number" | "boolean" => {
                let mut out = Map::new();
                out.insert("type".into(), json!(ty));
                if let Some(d) = &desc {
                    out.insert("description".into(), json!(d));
                }
                Value::Object(out)
            }
            _ => {
                // "string", "null" and anything unknown.
                let values = obj
                    .get("enum")
                    .and_then(Value::as_array)
                    .and_then(|v| all_strings(v))
                    .or_else(|| obj.get("const").and_then(Value::as_str).map(|s| vec![s.to_string()]));
                match values {
                    Some(values) if !values.is_empty() => string_enum(values, desc.as_deref()),
                    _ => string_schema(desc.as_deref()),
                }
            }
        };
        (node, nullable)
    }

    fn object(
        &mut self,
        obj: &Map<String, Value>,
        title: &str,
        desc: Option<&str>,
        ref_depth: usize,
        nesting: usize,
    ) -> Value {
        let empty = Map::new();
        let props = obj.get("properties").and_then(Value::as_object).unwrap_or(&empty);
        let required_in: Vec<&str> = obj
            .get("required")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let as_value = Value::Object(obj.clone());
        let order = order_of(&as_value);

        let mut properties = Map::new();
        let mut required = Vec::new();
        for name in &order {
            let child_title = format!("{title}_{}", clean_title(name));
            let child_schema = props.get(name.as_str()).unwrap_or(&Value::Null);
            let (child, nullable) = self.node(child_schema, &child_title, ref_depth, nesting + 1);
            properties.insert(name.clone(), child);
            if required_in.contains(&name.as_str()) && !nullable {
                required.push(json!(name));
            }
        }
        let mut out = Map::new();
        out.insert("title".into(), json!(title));
        out.insert("type".into(), json!("object"));
        if let Some(d) = desc {
            out.insert("description".into(), json!(d));
        }
        out.insert("additionalProperties".into(), json!(false));
        out.insert("properties".into(), Value::Object(properties));
        out.insert("required".into(), Value::Array(required));
        out.insert("x-order".into(), json!(order));
        Value::Object(out)
    }
}

/// Changes the title of an object schema and of its nested objects (their
/// titles are prefixed by the parent title), so titles stay unique inside one
/// router schema.
fn retitle(schema: &mut Value, title: &str) {
    let Some(obj) = schema.as_object_mut() else { return };
    if obj.get("type").and_then(Value::as_str) == Some("object") {
        obj.insert("title".into(), json!(title));
    }
    if let Some(props) = obj.get_mut("properties").and_then(Value::as_object_mut) {
        for (name, child) in props.iter_mut() {
            retitle(child, &format!("{title}_{}", clean_title(name)));
        }
    }
    if let Some(items) = obj.get_mut("items") {
        retitle(items, &format!("{title}_item"));
    }
}

fn resolve_ref<'v>(root: &'v Value, reference: &str) -> Option<&'v Value> {
    if reference == "#" {
        return Some(root);
    }
    let pointer = reference.strip_prefix('#')?;
    // JSON pointer with ~0 / ~1 escapes; also accept percent-encoded "$".
    let pointer = pointer.replace("%24", "$");
    root.pointer(&pointer)
}

fn is_null_schema(v: &Value) -> bool {
    v.get("type").and_then(Value::as_str) == Some("null")
        || matches!(v.get("const"), Some(Value::Null)) && v.as_object().map(|o| o.len() == 1).unwrap_or(false)
}

/// All branches are string constants or string enums → their values.
fn string_consts(branches: &[&Value]) -> Option<Vec<String>> {
    if branches.is_empty() {
        return None;
    }
    let mut values = Vec::new();
    for b in branches {
        if let Some(c) = b.get("const") {
            values.push(c.as_str()?.to_string());
        } else {
            values.extend(all_strings(b.get("enum").and_then(Value::as_array)?)?);
        }
    }
    Some(values)
}

fn all_strings(values: &[Value]) -> Option<Vec<String>> {
    let out: Vec<String> = values.iter().filter_map(Value::as_str).map(str::to_string).collect();
    // Enums with null keep their string values.
    let non_null = values.iter().filter(|v| !v.is_null()).count();
    if out.len() == non_null && !out.is_empty() {
        Some(out)
    } else {
        None
    }
}

fn infer_type(obj: &Map<String, Value>) -> String {
    if obj.contains_key("properties") {
        "object".into()
    } else if obj.contains_key("items") {
        "array".into()
    } else {
        "string".into()
    }
}

/// `base` keywords plus `branch` keywords (the branch wins, but a base
/// description is kept when the branch has none).
fn merge_into(base: &Map<String, Value>, branch: &Value) -> Value {
    let mut out = base.clone();
    if let Some(b) = branch.as_object() {
        for (k, v) in b {
            if k == "description" && out.contains_key("description") {
                continue;
            }
            out.insert(k.clone(), v.clone());
        }
    } else {
        out.insert("type".into(), json!("string"));
    }
    Value::Object(out)
}

/// allOf: unions `properties` and `required`; other keywords from `part` fill gaps.
fn merge_all_of(acc: &Value, part: &Value) -> Value {
    let mut out = acc.as_object().cloned().unwrap_or_default();
    let Some(part) = part.as_object() else { return Value::Object(out) };
    for (k, v) in part {
        match k.as_str() {
            "properties" => {
                let entry = out.entry("properties").or_insert_with(|| json!({}));
                if let (Some(dst), Some(src)) = (entry.as_object_mut(), v.as_object()) {
                    for (pk, pv) in src {
                        dst.entry(pk.clone()).or_insert_with(|| pv.clone());
                    }
                }
            }
            "required" => {
                let entry = out.entry("required").or_insert_with(|| json!([]));
                if let (Some(dst), Some(src)) = (entry.as_array_mut(), v.as_array()) {
                    for r in src {
                        if !dst.contains(r) {
                            dst.push(r.clone());
                        }
                    }
                }
            }
            _ => {
                out.entry(k.clone()).or_insert_with(|| v.clone());
            }
        }
    }
    Value::Object(out)
}

fn string_schema(desc: Option<&str>) -> Value {
    match desc {
        Some(d) => json!({"type": "string", "description": d}),
        None => json!({"type": "string"}),
    }
}

fn string_enum(values: Vec<String>, desc: Option<&str>) -> Value {
    let mut unique: Vec<String> = Vec::new();
    for v in values {
        if !unique.contains(&v) {
            unique.push(v);
        }
    }
    let mut out = Map::new();
    out.insert("type".into(), json!("string"));
    if let Some(d) = desc {
        out.insert("description".into(), json!(d));
    }
    out.insert("enum".into(), json!(unique));
    Value::Object(out)
}

/// Titles: letters, digits and underscores only.
pub fn clean_title(title: &str) -> String {
    let t: String = title.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
    if t.is_empty() {
        "Arguments".into()
    } else {
        t
    }
}

fn clean_description(text: &str) -> String {
    clean_description_len(text, MAX_DESCRIPTION)
}

/// One line, at most `max` characters.
pub fn clean_description_len(text: &str, max: usize) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= max {
        one_line
    } else {
        let cut: String = one_line.chars().take(max.saturating_sub(1)).collect();
        format!("{}…", cut.trim_end())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Checks the fm shape on every object in the tree.
    fn assert_fm_shape(v: &Value) {
        match v.get("type").and_then(Value::as_str) {
            Some("object") => {
                assert!(v.get("title").and_then(Value::as_str).is_some(), "object without title: {v}");
                assert_eq!(v["additionalProperties"], json!(false), "{v}");
                let props = v["properties"].as_object().expect("properties");
                let order: Vec<&str> = v["x-order"].as_array().unwrap().iter().map(|s| s.as_str().unwrap()).collect();
                assert_eq!(order.len(), props.len());
                for r in v["required"].as_array().unwrap() {
                    assert!(props.contains_key(r.as_str().unwrap()), "required not in properties: {v}");
                }
                for child in props.values() {
                    assert_fm_shape(child);
                }
            }
            Some("array") => assert_fm_shape(&v["items"]),
            Some("string") | Some("integer") | Some("number") | Some("boolean") => {
                for k in ["format", "default", "examples", "pattern", "minimum", "maximum", "minLength", "maxLength"] {
                    assert!(v.get(k).is_none(), "{k} kept in {v}");
                }
            }
            other => panic!("unexpected type {other:?} in {v}"),
        }
    }

    #[test]
    fn simple_object_gets_fm_shape() {
        let s = json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path", "minLength": 1, "format": "uri"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 10},
                "verbose": {"type": "boolean"}
            },
            "required": ["path", "missing"]
        });
        let out = sanitize(&s, "read file");
        assert_fm_shape(&out);
        assert_eq!(out["title"], "read_file");
        assert_eq!(out["required"], json!(["path"]));
        assert_eq!(out["properties"]["path"], json!({"type": "string", "description": "File path"}));
        assert_eq!(out["properties"]["limit"], json!({"type": "integer"}));
        assert_eq!(out["x-order"][0], "path");
    }

    #[test]
    fn nullable_types_become_optional() {
        let s = json!({
            "type": "object",
            "properties": {
                "a": {"type": ["string", "null"]},
                "b": {"anyOf": [{"type": "integer"}, {"type": "null"}], "description": "B"}
            },
            "required": ["a", "b"]
        });
        let out = sanitize(&s, "t");
        assert_fm_shape(&out);
        assert_eq!(out["required"], json!([]));
        assert_eq!(out["properties"]["a"], json!({"type": "string"}));
        assert_eq!(out["properties"]["b"], json!({"type": "integer", "description": "B"}));
    }

    #[test]
    fn enums_and_consts() {
        let s = json!({
            "type": "object",
            "properties": {
                "unit": {"type": "string", "enum": ["c", "f"]},
                "mode": {"oneOf": [{"const": "fast"}, {"const": "slow"}]},
                "level": {"type": "integer", "enum": [1, 2, 3]},
                "fixed": {"const": "yes"}
            },
            "required": ["unit", "mode", "level", "fixed"]
        });
        let out = sanitize(&s, "t");
        assert_fm_shape(&out);
        assert_eq!(out["properties"]["unit"]["enum"], json!(["c", "f"]));
        assert_eq!(out["properties"]["mode"]["enum"], json!(["fast", "slow"]));
        assert_eq!(out["properties"]["level"], json!({"type": "integer"}));
        assert_eq!(out["properties"]["fixed"]["enum"], json!(["yes"]));
    }

    #[test]
    fn arrays_and_nested_objects() {
        let s = json!({
            "type": "object",
            "properties": {
                "tags": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                "people": {"type": "array", "items": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}, "email": {"type": "string", "format": "email"}},
                    "required": ["name"]
                }},
                "bare": {"type": "array"},
                "where": {"properties": {"city": {"type": "string"}}}
            }
        });
        let out = sanitize(&s, "event");
        assert_fm_shape(&out);
        assert_eq!(out["properties"]["tags"]["items"], json!({"type": "string"}));
        assert_eq!(out["properties"]["people"]["items"]["title"], "event_people_item");
        assert_eq!(out["properties"]["people"]["items"]["required"], json!(["name"]));
        assert_eq!(out["properties"]["bare"]["items"], json!({"type": "string"}));
        assert_eq!(out["properties"]["where"]["title"], "event_where");
    }

    #[test]
    fn resolves_refs_and_guards_cycles() {
        let s = json!({
            "type": "object",
            "properties": {
                "address": {"$ref": "#/$defs/Address", "description": "Where"},
                "node": {"$ref": "#/definitions/Node"},
                "missing": {"$ref": "#/$defs/Nope"}
            },
            "required": ["address", "node"],
            "$defs": {
                "Address": {"type": "object", "properties": {"street": {"type": "string"}}, "required": ["street"]}
            },
            "definitions": {
                "Node": {"type": "object", "properties": {"value": {"type": "string"}, "next": {"$ref": "#/definitions/Node"}}}
            }
        });
        let out = sanitize(&s, "t");
        assert_fm_shape(&out);
        assert_eq!(out["properties"]["address"]["description"], "Where");
        assert_eq!(out["properties"]["address"]["required"], json!(["street"]));
        // The cycle stops with a string.
        assert_eq!(out["properties"]["node"]["properties"]["next"]["type"], "string");
        assert_eq!(out["properties"]["missing"]["type"], "string");
    }

    #[test]
    fn deep_ref_chains_fall_back_to_string() {
        let s = json!({
            "type": "object",
            "properties": {"x": {"$ref": "#/$defs/A"}},
            "$defs": {
                "A": {"$ref": "#/$defs/B"},
                "B": {"$ref": "#/$defs/C"},
                "C": {"$ref": "#/$defs/D"},
                "D": {"$ref": "#/$defs/E"},
                "E": {"type": "integer"}
            }
        });
        let out = sanitize(&s, "t");
        assert_fm_shape(&out);
        assert_eq!(out["properties"]["x"]["type"], "string");
    }

    #[test]
    fn all_of_merges_and_unknown_becomes_string() {
        let s = json!({
            "type": "object",
            "properties": {
                "both": {"allOf": [
                    {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"]},
                    {"properties": {"b": {"type": "number"}}}
                ]},
                "weird": {"type": "date-time"},
                "any": {},
                "yes": true
            }
        });
        let out = sanitize(&s, "t");
        assert_fm_shape(&out);
        assert_eq!(out["properties"]["both"]["required"], json!(["a"]));
        assert_eq!(out["properties"]["both"]["properties"]["b"]["type"], "number");
        assert_eq!(out["properties"]["weird"]["type"], "string");
        assert_eq!(out["properties"]["any"]["type"], "string");
        assert_eq!(out["properties"]["yes"]["type"], "string");
    }

    #[test]
    fn hostile_schemas_do_not_crash_or_explode() {
        // allOf with a $ref to itself used to recurse until the stack overflowed.
        let s = json!({
            "type": "object",
            "properties": {"x": {"$ref": "#/$defs/A"}},
            "$defs": {"A": {"allOf": [{"$ref": "#/$defs/A"}], "properties": {"y": {"allOf": [{"$ref": "#/$defs/A"}]}}}}
        });
        assert_fm_shape(&sanitize(&s, "t"));
        // Wide and deep: 30 properties at every level, all the same $ref.
        let props: Map<String, Value> = (0..30).map(|i| (format!("p{i}"), json!({"$ref": "#/$defs/N"}))).collect();
        let mut node = json!({"type": "object", "properties": props});
        let defs = json!({"N": node.clone()});
        node["$defs"] = defs;
        let started = std::time::Instant::now();
        let out = sanitize(&node, "t");
        assert_fm_shape(&out);
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        assert!(out.to_string().len() < 2_000_000);
    }

    #[test]
    fn non_object_root_becomes_empty_object() {
        assert_eq!(sanitize(&json!({}), "x"), empty_object("x"));
        assert_eq!(sanitize(&json!({"type": "string"}), "x"), empty_object("x"));
        assert_eq!(sanitize(&Value::Null, "x")["properties"], json!({}));
        // MCP tools without arguments often send only {"type": "object"}.
        let out = sanitize(&json!({"type": "object"}), "x");
        assert_fm_shape(&out);
    }

    #[test]
    fn long_descriptions_are_cut() {
        let long = "word ".repeat(200);
        let out =
            sanitize(&json!({"type": "object", "properties": {"a": {"type": "string", "description": long}}}), "t");
        assert!(out["properties"]["a"]["description"].as_str().unwrap().chars().count() <= MAX_DESCRIPTION);
    }

    #[test]
    fn params_become_schema() {
        let params = vec![
            ToolParam {
                name: "order_id".into(),
                kind: ParamType::String,
                description: "Order id".into(),
                required: true,
            },
            ToolParam { name: "count".into(), kind: ParamType::Integer, description: String::new(), required: false },
            ToolParam { name: "".into(), kind: ParamType::Boolean, description: String::new(), required: true },
        ];
        let out = params_to_schema(&params);
        assert_fm_shape(&out);
        assert_eq!(out["x-order"], json!(["order_id", "count"]));
        assert_eq!(out["required"], json!(["order_id"]));
        assert_eq!(out["properties"]["count"], json!({"type": "integer"}));
        assert_eq!(signature(&out), "order_id: string, count?: integer");
    }

    #[test]
    fn router_schema_shape() {
        let calc = params_to_schema(&[ToolParam {
            name: "expression".into(),
            kind: ParamType::String,
            description: "Math".into(),
            required: true,
        }]);
        let schema = router_schema(&[
            ("calculator".into(), calc, "Evaluate math".into()),
            ("get_current_datetime".into(), empty_object("x"), String::new()),
            ("answer".into(), empty_object("x"), "reserved name is skipped".into()),
        ]);
        let any_of = schema["anyOf"].as_array().unwrap();
        assert_eq!(any_of.len(), 3);
        assert_eq!(any_of[0]["$ref"], "#/$defs/calculator");
        assert_eq!(any_of[2]["$ref"], "#/$defs/answer");
        let calc_def = &schema["$defs"]["calculator"];
        assert_fm_shape(calc_def);
        assert_eq!(calc_def["required"], json!(["calculator"]));
        assert_eq!(calc_def["properties"]["calculator"]["title"], "calculator_arguments");
        assert_eq!(
            schema["$defs"]["get_current_datetime"]["properties"]["get_current_datetime"]["properties"],
            json!({})
        );
        assert_fm_shape(&schema["$defs"]["answer"]);
    }

    #[test]
    fn signature_shows_types() {
        let s = sanitize(
            &json!({
                "type": "object",
                "properties": {
                    "unit": {"type": "string", "enum": ["c", "f"]},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "loc": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}
                },
                "required": ["unit"]
            }),
            "t",
        );
        assert_eq!(signature(&s), "unit: \"c\"|\"f\", loc?: {city: string}, tags?: array of string");
    }
}
