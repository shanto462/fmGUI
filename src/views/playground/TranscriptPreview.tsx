// Small read-only preview of a transcript file (used for --resume and --transcript).
// OWNER: agent "ui-build".

import { useEffect, useState } from "react";
import { Spinner } from "../../components/ui";
import { errorMessage, transcriptRead } from "../../lib/api";
import type { ParsedTranscript } from "../../lib/types";
import { truncateText } from "./workbench";
import "./playground.css";

export function TranscriptPreview(props: { path: string; maxMessages?: number }) {
  const [data, setData] = useState<ParsedTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    if (!props.path) return;
    setLoading(true);
    transcriptRead(props.path)
      .then((t) => alive && setData(t))
      .catch((err) => alive && setError(errorMessage(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [props.path]);

  if (!props.path) return null;
  if (loading) {
    return (
      <div className="row xsmall muted">
        <Spinner /> Reading transcript…
      </div>
    );
  }
  if (error) return <div className="field__error">Could not read this transcript: {error}</div>;
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
