//! Turns raw output chunks into clean text: UTF-8 safe across chunk
//! boundaries, ANSI stripped even when an escape sequence is split.

/// Longest escape sequence we hold back while waiting for its end.
const MAX_PENDING_ESCAPE: usize = 256;

#[derive(Default)]
pub(crate) struct ChunkDecoder {
    /// Bytes of an incomplete UTF-8 character at the end of the last chunk.
    bytes: Vec<u8>,
    /// Text of an incomplete escape sequence at the end of the last chunk.
    pending: String,
}

impl ChunkDecoder {
    /// Adds a chunk and returns the text that is complete so far.
    pub fn push(&mut self, chunk: &[u8]) -> String {
        self.bytes.extend_from_slice(chunk);
        let mut text = std::mem::take(&mut self.pending);
        let mut rest: &[u8] = &self.bytes;
        let mut keep = Vec::new();
        loop {
            match std::str::from_utf8(rest) {
                Ok(s) => {
                    text.push_str(s);
                    break;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    text.push_str(std::str::from_utf8(&rest[..valid]).unwrap_or_default());
                    match e.error_len() {
                        // Invalid bytes in the middle: replace them and go on.
                        Some(len) => {
                            text.push(char::REPLACEMENT_CHARACTER);
                            rest = &rest[valid + len..];
                        }
                        // An incomplete character at the end: wait for more bytes.
                        None => {
                            keep = rest[valid..].to_vec();
                            break;
                        }
                    }
                }
            }
        }
        self.bytes = keep;

        if let Some(pos) = text.rfind('\u{1B}') {
            let tail = &text[pos..];
            if tail.len() <= MAX_PENDING_ESCAPE && is_incomplete_escape(tail) {
                self.pending = tail.to_string();
                text.truncate(pos);
            }
        }
        crate::util::strip_ansi(&text)
    }

    /// Returns whatever is left at the end of the stream.
    pub fn finish(&mut self) -> String {
        let mut text = std::mem::take(&mut self.pending);
        text.push_str(&String::from_utf8_lossy(&std::mem::take(&mut self.bytes)));
        // An escape sequence that never ended is noise: drop it.
        if let Some(pos) = text.rfind('\u{1B}') {
            if is_incomplete_escape(&text[pos..]) {
                text.truncate(pos);
            }
        }
        crate::util::strip_ansi(&text)
    }
}

/// True when `tail` (starting with ESC) is the start of an escape sequence
/// whose end has not arrived yet.
fn is_incomplete_escape(tail: &str) -> bool {
    let mut chars = tail.chars();
    chars.next(); // ESC
    match chars.next() {
        None => true,
        // CSI: parameters and intermediates, then one final byte 0x40..=0x7E.
        Some('[') => {
            for c in chars {
                match c as u32 {
                    0x40..=0x7E => return false,
                    0x20..=0x3F => continue,
                    _ => return false, // malformed: do not hold it back
                }
            }
            true
        }
        // OSC: ends with BEL or ESC \.
        Some(']') => !(tail.contains('\u{07}') || tail[1..].contains("\u{1B}\\")),
        Some(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_utf8_split_across_chunks() {
        let bytes = "héllo ✓ wörld".as_bytes();
        for split in 0..bytes.len() {
            let mut d = ChunkDecoder::default();
            let mut out = d.push(&bytes[..split]);
            out.push_str(&d.push(&bytes[split..]));
            out.push_str(&d.finish());
            assert_eq!(out, "héllo ✓ wörld", "split at {split}");
        }
    }

    #[test]
    fn strips_escape_split_across_chunks() {
        let raw = "Error: \u{1B}[38;2;255;107;128mBad\u{1B}[0m\n".as_bytes();
        for split in 0..raw.len() {
            let mut d = ChunkDecoder::default();
            let mut out = d.push(&raw[..split]);
            out.push_str(&d.push(&raw[split..]));
            out.push_str(&d.finish());
            assert_eq!(out, "Error: Bad\n", "split at {split}");
        }
    }

    #[test]
    fn replaces_invalid_bytes() {
        let mut d = ChunkDecoder::default();
        let mut out = d.push(b"a\xFFb");
        out.push_str(&d.finish());
        assert_eq!(out, "a\u{FFFD}b");
        // A lone trailing ESC is flushed at the end.
        let mut d = ChunkDecoder::default();
        assert_eq!(d.push(b"x\x1B"), "x");
        assert_eq!(d.finish(), "");
    }
}
