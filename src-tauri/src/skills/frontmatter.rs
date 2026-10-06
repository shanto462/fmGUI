//! SKILL.md front matter: a small YAML subset (top-level `key: value`,
//! quoted values, `|` / `>` block scalars, multi-line plain values).
//! SKILL.md files come from anywhere (imports from `~/.claude/skills`), so
//! the parser must never panic on odd input.

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FrontMatter {
    pub name: Option<String>,
    pub description: Option<String>,
}

/// One top-level entry of the front matter with its raw lines
/// (the key line plus indented / blank continuation lines).
struct Entry<'a> {
    key: Option<String>,
    rest: &'a str,
    lines: Vec<&'a str>,
}

fn is_indented(line: &str) -> bool {
    line.starts_with(' ') || line.starts_with('\t')
}

fn split_entries<'a>(lines: &[&'a str]) -> Vec<Entry<'a>> {
    let mut entries: Vec<Entry<'a>> = Vec::new();
    for &line in lines {
        let continuation = line.trim().is_empty() || is_indented(line);
        if continuation {
            if let Some(last) = entries.last_mut() {
                last.lines.push(line);
                continue;
            }
            entries.push(Entry { key: None, rest: "", lines: vec![line] });
            continue;
        }
        let key_value = if line.starts_with('#') || line.starts_with("- ") { None } else { line.split_once(':') };
        match key_value {
            Some((key, rest)) => {
                let key = key.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
                entries.push(Entry { key: Some(key), rest: rest.trim(), lines: vec![line] });
            }
            None => entries.push(Entry { key: None, rest: "", lines: vec![line] }),
        }
    }
    entries
}

/// Splits a SKILL.md text into (front matter lines, body). No front matter →
/// (None, whole text).
fn split_document(text: &str) -> (Option<Vec<&str>>, String) {
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let lines: Vec<&str> = text.lines().map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    let starts = lines.first().map(|l| l.trim_end() == "---").unwrap_or(false);
    if starts {
        if let Some(end) = lines.iter().skip(1).position(|l| matches!(l.trim_end(), "---" | "...")) {
            let end = end + 1;
            let body = lines[end + 1..].join("\n");
            return (Some(lines[1..end].to_vec()), body.trim_start_matches('\n').trim_end().to_string());
        }
    }
    (None, lines.join("\n").trim().to_string())
}

/// Parses a SKILL.md text into its front matter and Markdown body.
pub fn parse_skill_md(text: &str) -> (FrontMatter, String) {
    let (front, body) = split_document(text);
    let mut fm = FrontMatter::default();
    if let Some(lines) = front {
        for entry in split_entries(&lines) {
            let value = || {
                let v = parse_value(entry.rest, &entry.lines[1..]);
                let v = v.trim().to_string();
                if v.is_empty() || v == "~" || v == "null" {
                    None
                } else {
                    Some(v)
                }
            };
            match entry.key.as_deref() {
                Some("name") => fm.name = value(),
                Some("description") => fm.description = value(),
                _ => {}
            }
        }
    }
    (fm, body)
}

/// The value of one entry: `rest` is the text after `key:`, `more` the
/// continuation lines.
fn parse_value(rest: &str, more: &[&str]) -> String {
    if rest.starts_with('|') || rest.starts_with('>') {
        return block_scalar(rest, more);
    }
    // Quoted and plain values may continue on indented lines; those lines
    // are folded into one line with spaces.
    let mut joined = rest.to_string();
    for line in more {
        let t = line.trim();
        if t.is_empty() {
            joined.push('\n');
        } else {
            if !joined.is_empty() && !joined.ends_with('\n') {
                joined.push(' ');
            }
            joined.push_str(t);
        }
    }
    let joined = joined.trim().to_string();
    if let Some(inner) = joined.strip_prefix('"') {
        return double_quoted(inner);
    }
    if let Some(inner) = joined.strip_prefix('\'') {
        return single_quoted(inner);
    }
    if joined.starts_with('#') {
        return String::new(); // only a comment
    }
    joined
}

fn block_scalar(header: &str, more: &[&str]) -> String {
    let folded = header.starts_with('>');
    let indicators = &header[1..];
    let indicators = indicators.split('#').next().unwrap_or("").trim();
    let keep = indicators.contains('+');
    let strip = indicators.contains('-');
    let explicit_indent: Option<usize> =
        indicators.chars().find(|c| c.is_ascii_digit()).and_then(|c| c.to_digit(10)).map(|d| d as usize);

    // Indentation is ASCII spaces and tabs only, so cutting it never splits
    // a multi-byte character.
    let indent_of = |l: &str| l.bytes().take_while(|b| *b == b' ' || *b == b'\t').count();
    let indent = explicit_indent
        .unwrap_or_else(|| more.iter().filter(|l| !l.trim().is_empty()).map(|l| indent_of(l)).min().unwrap_or(0));
    let content: Vec<&str> =
        more.iter().map(|l| if l.trim().is_empty() { "" } else { &l[indent_of(l).min(indent)..] }).collect();

    let mut out = String::new();
    if folded {
        let mut prev_text = false;
        for line in &content {
            if line.is_empty() {
                out.push('\n');
                prev_text = false;
            } else if line.starts_with(' ') || line.starts_with('\t') {
                // More-indented lines are kept as they are.
                if prev_text {
                    out.push('\n');
                }
                out.push_str(line);
                out.push('\n');
                prev_text = false;
            } else {
                if prev_text {
                    out.push(' ');
                }
                out.push_str(line);
                prev_text = true;
            }
        }
        if prev_text {
            out.push('\n');
        }
    } else {
        for line in &content {
            out.push_str(line);
            out.push('\n');
        }
    }
    if strip {
        out.trim_end_matches('\n').to_string()
    } else if keep {
        out
    } else {
        format!("{}\n", out.trim_end_matches('\n'))
    }
}

fn double_quoted(inner: &str) -> String {
    let mut out = String::new();
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => break,
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('0') => out.push('\0'),
                Some('/') => out.push('/'),
                Some('\\') => out.push('\\'),
                Some('"') => out.push('"'),
                Some(' ') => out.push(' '),
                Some('u') => {
                    let hex: String = chars.by_ref().take(4).collect();
                    if let Some(ch) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                        out.push(ch);
                    }
                }
                Some('x') => {
                    let hex: String = chars.by_ref().take(2).collect();
                    if let Some(ch) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                        out.push(ch);
                    }
                }
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => {}
            },
            c => out.push(c),
        }
    }
    out
}

fn single_quoted(inner: &str) -> String {
    let mut out = String::new();
    let mut chars = inner.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\'' {
            if chars.peek() == Some(&'\'') {
                chars.next();
                out.push('\'');
            } else {
                break;
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// A YAML scalar for `value`: plain when that is safe, else double-quoted
/// (JSON escapes are valid YAML double-quoted escapes).
pub fn yaml_scalar(value: &str) -> String {
    const SPECIAL_START: &[char] =
        &['-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@', '`', ' '];
    let lower = value.to_ascii_lowercase();
    let reserved = matches!(lower.as_str(), "true" | "false" | "yes" | "no" | "on" | "off" | "null" | "~")
        || value.parse::<f64>().is_ok();
    let safe = !value.is_empty()
        && !reserved
        && !value.starts_with(SPECIAL_START)
        && !value.ends_with([' ', ':'])
        && !value.contains(": ")
        && !value.contains(" #")
        && !value.contains(['\n', '\r', '\t']);
    if safe {
        value.to_string()
    } else {
        serde_json::to_string(value).unwrap_or_else(|_| format!("\"{}\"", value.replace('"', "'")))
    }
}

/// Writes a full SKILL.md. Other front matter keys from `previous` (for
/// example `license` or `allowed-tools` of an imported skill) are kept.
pub fn render_skill_md(name: &str, description: &str, body: &str, previous: Option<&str>) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", yaml_scalar(name)));
    out.push_str(&format!("description: {}\n", yaml_scalar(description)));
    if let Some(prev) = previous {
        if let (Some(lines), _) = split_document(prev) {
            let mut kept: Vec<&str> = Vec::new();
            for entry in split_entries(&lines) {
                if !matches!(entry.key.as_deref(), Some("name") | Some("description")) {
                    kept.extend(entry.lines);
                }
            }
            while kept.last().is_some_and(|l| l.trim().is_empty()) {
                kept.pop();
            }
            for line in kept {
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    out.push_str("---\n\n");
    let body = body.trim();
    if !body.is_empty() {
        out.push_str(body);
        out.push('\n');
    }
    out
}

/// Sets (or adds) the `name:` key and keeps everything else as it is.
pub fn set_name(text: &str, name: &str) -> String {
    let (front, body) = split_document(text);
    let Some(lines) = front else {
        let mut out = format!("---\nname: {}\n---\n\n", yaml_scalar(name));
        out.push_str(&body);
        out.push('\n');
        return out;
    };
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", yaml_scalar(name)));
    for entry in split_entries(&lines) {
        if entry.key.as_deref() != Some("name") {
            for line in entry.lines {
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    out.push_str("---\n\n");
    out.push_str(&body);
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fm(text: &str) -> (Option<String>, Option<String>, String) {
        let (f, body) = parse_skill_md(text);
        (f.name, f.description, body)
    }

    #[test]
    fn plain_values() {
        let (name, desc, body) =
            fm("---\nname: pdf-tools\ndescription: Fill and read PDF forms.\n---\n\n# PDF\nUse it.\n");
        assert_eq!(name.as_deref(), Some("pdf-tools"));
        assert_eq!(desc.as_deref(), Some("Fill and read PDF forms."));
        assert_eq!(body, "# PDF\nUse it.");
    }

    #[test]
    fn quoted_values() {
        let (name, desc, _) = fm("---\nname: \"quoted-name\"\ndescription: 'It''s for \"reports\": weekly'\n---\nBody");
        assert_eq!(name.as_deref(), Some("quoted-name"));
        assert_eq!(desc.as_deref(), Some("It's for \"reports\": weekly"));
        let (_, desc, _) = fm("---\ndescription: \"Line one\\nTab\\there \\u00e9 \\\"q\\\"\"\n---\n");
        assert_eq!(desc.as_deref(), Some("Line one\nTab\there é \"q\""));
    }

    #[test]
    fn folded_and_literal_blocks() {
        let text = "---\nname: notes\ndescription: >\n  Takes meeting notes\n  and writes a summary.\n\n  Second paragraph.\nlicense: MIT\n---\nBody here";
        let (name, desc, body) = fm(text);
        assert_eq!(name.as_deref(), Some("notes"));
        assert_eq!(desc.as_deref(), Some("Takes meeting notes and writes a summary.\nSecond paragraph."));
        assert_eq!(body, "Body here");

        let (_, desc, _) = fm("---\ndescription: |-\n    First line\n    Second line\nname: lit\n---\n");
        assert_eq!(desc.as_deref(), Some("First line\nSecond line"));

        let (_, desc, _) = fm("---\ndescription: >-\n  a\n  b\n---\n");
        assert_eq!(desc.as_deref(), Some("a b"));
    }

    #[test]
    fn multi_line_plain_and_nested_keys() {
        let text = "---\nname: multi\ndescription: Starts here\n  and continues here.\nmetadata:\n  name: not-this-one\n  version: 2\nallowed-tools: Read, Grep\n---\n";
        let (name, desc, body) = fm(text);
        assert_eq!(name.as_deref(), Some("multi"));
        assert_eq!(desc.as_deref(), Some("Starts here and continues here."));
        assert_eq!(body, "");
    }

    #[test]
    fn crlf_bom_and_no_front_matter() {
        let (name, desc, body) =
            fm("\u{FEFF}---\r\nname: win\r\ndescription: From Windows\r\n---\r\nLine 1\r\nLine 2\r\n");
        assert_eq!(name.as_deref(), Some("win"));
        assert_eq!(desc.as_deref(), Some("From Windows"));
        assert_eq!(body, "Line 1\nLine 2");

        let (name, desc, body) = fm("# Just markdown\n\nNo front matter.");
        assert_eq!((name, desc), (None, None));
        assert_eq!(body, "# Just markdown\n\nNo front matter.");

        // An opening line without a closing one is body text.
        let (name, _, body) = fm("---\nname: broken\nno end");
        assert_eq!(name, None);
        assert!(body.starts_with("---"));
    }

    #[test]
    fn odd_indentation_never_panics() {
        // Explicit indent that lands inside a multi-byte character.
        let (_, desc, _) = fm("---\ndescription: |4\n  xéé\n---\n");
        assert!(desc.is_some());
        // Unicode spaces in the indentation (ideographic space, no-break space).
        let (_, desc, _) = fm("---\ndescription: >\n  first\n\u{3000}second\n \u{a0}third\n---\n");
        assert!(desc.unwrap().contains("first"));
        let (_, desc, _) = fm("---\ndescription: |9\n é\n---\n");
        assert!(desc.is_some());
    }

    #[test]
    fn empty_and_comment_values() {
        let (name, desc, _) = fm("---\n# a comment\nname:\ndescription: # nothing\n---\nx");
        assert_eq!((name, desc), (None, None));
    }

    #[test]
    fn yaml_scalars_round_trip() {
        for value in [
            "plain text value",
            "Has: a colon",
            "- starts with dash",
            "multi\nline",
            "quote \" inside",
            "123",
            "true",
            "ends with colon:",
            "C# and #hash",
            "issue #42",
            "",
        ] {
            let text = format!("---\nname: x\ndescription: {}\n---\n", yaml_scalar(value));
            let (_, desc, _) = fm(&text);
            assert_eq!(desc.unwrap_or_default(), value, "for {value:?} → {text}");
        }
        assert_eq!(yaml_scalar("plain text"), "plain text");
        assert_eq!(yaml_scalar("123"), "\"123\"");
    }

    #[test]
    fn render_keeps_other_keys() {
        let previous = "---\nname: old\ndescription: >\n  Old text\n  folded.\nlicense: MIT\nallowed-tools:\n  - Read\n---\nOld body";
        let text = render_skill_md("new-name", "New: text", "New body\n", Some(previous));
        assert_eq!(
            text,
            "---\nname: new-name\ndescription: \"New: text\"\nlicense: MIT\nallowed-tools:\n  - Read\n---\n\nNew body\n"
        );
        let (name, desc, body) = fm(&text);
        assert_eq!(name.as_deref(), Some("new-name"));
        assert_eq!(desc.as_deref(), Some("New: text"));
        assert_eq!(body, "New body");
    }

    #[test]
    fn set_name_replaces_or_adds() {
        let text = set_name("---\nname: Bad Name\ndescription: d\n---\nBody", "bad-name");
        assert_eq!(text, "---\nname: bad-name\ndescription: d\n---\n\nBody\n");
        let text = set_name("---\ndescription: d\n---\nBody", "added");
        assert_eq!(fm(&text).0.as_deref(), Some("added"));
        let text = set_name("Only body", "fresh");
        assert_eq!(fm(&text), (Some("fresh".into()), None, "Only body".into()));
    }
}
