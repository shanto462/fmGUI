//! Incremental Server-Sent Events parser (for Streamable HTTP responses).
//! OWNER: agent "mcp".

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SseEvent {
    /// The `event:` field. None means the default type, "message".
    pub event: Option<String>,
    pub data: String,
    pub id: Option<String>,
}

impl SseEvent {
    /// True for events that carry JSON-RPC messages.
    pub fn is_message(&self) -> bool {
        matches!(self.event.as_deref(), None | Some("") | Some("message"))
    }
}

/// Feed it raw bytes as they arrive; it returns every complete event.
/// Lines may end in `\n`, `\r\n` or `\r`, and may be split across chunks.
#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
    data: Vec<String>,
    has_data: bool,
    event: Option<String>,
    id: Option<String>,
}

impl SseParser {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        self.drain_lines(false, &mut out);
        out
    }

    /// Call at the end of the stream: handles a last line without a line
    /// break and a last event without the closing blank line.
    pub fn finish(&mut self) -> Vec<SseEvent> {
        let mut out = Vec::new();
        self.drain_lines(true, &mut out);
        if !self.buf.is_empty() {
            let rest = std::mem::take(&mut self.buf);
            self.line(&String::from_utf8_lossy(&rest), &mut out);
        }
        self.dispatch(&mut out);
        out
    }

    fn drain_lines(&mut self, at_end: bool, out: &mut Vec<SseEvent>) {
        loop {
            let Some(pos) = self.buf.iter().position(|b| *b == b'\n' || *b == b'\r') else { break };
            let skip = if self.buf[pos] == b'\r' {
                match self.buf.get(pos + 1) {
                    Some(b'\n') => 2,
                    Some(_) => 1,
                    // A `\r` at the very end: wait to see if `\n` follows.
                    None if !at_end => break,
                    None => 1,
                }
            } else {
                1
            };
            let line: Vec<u8> = self.buf.drain(..pos + skip).take(pos).collect();
            self.line(&String::from_utf8_lossy(&line), out);
        }
    }

    fn line(&mut self, line: &str, out: &mut Vec<SseEvent>) {
        if line.is_empty() {
            self.dispatch(out);
            return;
        }
        if line.starts_with(':') {
            return; // comment / keep-alive
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "data" => {
                self.data.push(value.to_string());
                self.has_data = true;
            }
            "event" => self.event = Some(value.to_string()),
            "id" => self.id = Some(value.to_string()),
            _ => {} // "retry" and unknown fields
        }
    }

    fn dispatch(&mut self, out: &mut Vec<SseEvent>) {
        if self.has_data {
            out.push(SseEvent { event: self.event.take(), data: self.data.join("\n"), id: self.id.clone() });
        }
        self.data.clear();
        self.has_data = false;
        self.event = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_events() {
        let mut p = SseParser::default();
        let events = p.push(b"event: message\ndata: {\"a\":1}\n\ndata: second\n\n");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event.as_deref(), Some("message"));
        assert_eq!(events[0].data, "{\"a\":1}");
        assert!(events[1].is_message());
        assert_eq!(events[1].data, "second");
    }

    #[test]
    fn joins_multi_line_data_and_skips_comments() {
        let mut p = SseParser::default();
        let events = p.push(b": keep-alive\nid: 7\ndata: line one\ndata:line two\nretry: 1000\n\n");
        assert_eq!(events, vec![SseEvent { event: None, data: "line one\nline two".into(), id: Some("7".into()) }]);
    }

    #[test]
    fn handles_chunks_split_anywhere_and_crlf() {
        let raw = b"event: message\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\r\n\r\ndata: x\rdata: y\r\r";
        // Feed one byte at a time.
        let mut p = SseParser::default();
        let mut events = Vec::new();
        for b in raw.iter() {
            events.extend(p.push(std::slice::from_ref(b)));
        }
        events.extend(p.finish());
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].data, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}");
        assert_eq!(events[1].data, "x\ny");
    }

    #[test]
    fn utf8_split_across_chunks() {
        let text = "data: héllo ✓\n\n".as_bytes();
        let mut p = SseParser::default();
        let mut events = p.push(&text[..8]);
        events.extend(p.push(&text[8..]));
        assert_eq!(events[0].data, "héllo ✓");
    }

    #[test]
    fn finish_flushes_last_event_and_ignores_other_types() {
        let mut p = SseParser::default();
        assert!(p.push(b"event: endpoint\ndata: /messages?x=1\n\ndata: tail").iter().all(|e| !e.is_message()));
        let rest = p.finish();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].data, "tail");
        assert!(rest[0].is_message());
    }
}
