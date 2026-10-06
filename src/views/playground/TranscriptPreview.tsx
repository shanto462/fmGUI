// Small read-only preview of a transcript file (used for --resume and --transcript).

import { useEffect, useState } from "react";
import { Spinner } from "../../components/ui";
import { errorMessage, transcriptRead } from "../../lib/api";
import { truncateText } from "../../lib/format";
import type { ParsedTranscript } from "../../lib/types";
import "./playground.css";

export function TranscriptPreview(props: { path: string; maxMessages?: number }) {
  // The last result, with the path it belongs to. A result for another path is ignored.
  const [loaded, setLoaded] = useState<{ path: string; data: ParsedTranscript | null; error: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (!props.path) return;
    const path = props.path;
    let alive = true;
    transcriptRead(path)
      .then((data) => alive && setLoaded({ path, data, error: null }))
      .catch((err) => alive && setLoaded({ path, data: null, error: errorMessage(err) }));
    return () => {
      alive = false;
    };
  }, [props.path]);

  if (!props.path) return null;
  if (loaded?.path !== props.path) {
    return (
      <div className="row xsmall muted">
        <Spinner /> Reading transcript…
      </div>
    );
  }
  if (loaded.error) return <div className="field__error">Could not read this transcript: {loaded.error}</div>;
  const data = loaded.data;
  if (!data) return null;

  const max = props.maxMessages ?? 3;
  const recent = data.messages.slice(-max);
  const turns = data.messages.filter((m) => m.role === "user").length;
  return (
    <div className="pg-transcript">
      <div className="pg-transcript__meta">
        {data.messages.length} messages, {turns} {turns === 1 ? "turn" : "turns"}
        {data.modelName ? ` · model ${data.modelName}` : ""}
      </div>
      {data.instructions && (
        <div className="pg-transcript__msg">
          <span className="pg-transcript__role">instructions</span>
          <span>{truncateText(data.instructions, 120)}</span>
        </div>
      )}
      {data.messages.length > recent.length && <div className="pg-transcript__more">…</div>}
      {recent.map((m) => (
        <div key={m.id} className="pg-transcript__msg">
          <span className="pg-transcript__role">{m.role}</span>
          <span>
            {truncateText(m.text || "", 140) || <span className="muted">(no text)</span>}
            {m.images.length > 0 && <span className="muted"> · {m.images.length} image(s)</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
