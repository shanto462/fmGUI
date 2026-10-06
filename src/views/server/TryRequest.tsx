// "Try it" panel: send a request to the running public server. OWNER: agent "ui-build".

import { ImagePlus, Send } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Callout, Chip, CodeBlock, CommandPreview, Field, Select, TextArea, TextInput, formatDuration } from "../../components/ui";
import { errorMessage, publicServerRequest, readImageDataUrl } from "../../lib/api";
import { shellQuote } from "../../lib/fmArgs";
import { useApp } from "../../lib/store";
import type { HttpResult } from "../../lib/types";
import { IMAGE_EXTENSIONS, jsonError, pickFile, tryPrettyJson } from "../playground/workbench";
import { IMAGE_PLACEHOLDER, TRY_PRESETS, type Target } from "./snippets";

type Method = "GET" | "POST";

function curlFor(t: Target, method: Method, path: string, body: string): string {
  const parts = ["curl"];
  if (t.mode === "socket") parts.push("--unix-socket", shellQuote(t.socketPath), `http://localhost${path}`);
  else parts.push(`${t.baseUrl}${path}`);
  if (method === "POST") {
    // Long image data URLs would flood the preview.
    const compact = (() => {
      try {
        return JSON.stringify(JSON.parse(body));
      } catch {
        return body;
      }
    })().replace(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]{64,}/g, "data:image/...;base64,...");
    parts.push("-H", shellQuote("Content-Type: application/json"), "-d", shellQuote(compact));
  }
  return parts.join(" ");
}

export function TryRequest(props: { target: Target; running: boolean }) {
  const toast = useApp((s) => s.toast);
  const [presetId, setPresetId] = useState("chat");
  const preset = TRY_PRESETS.find((p) => p.id === presetId);
  const [method, setMethod] = useState<Method>(preset?.method ?? "POST");
  const [path, setPath] = useState(preset?.path ?? "/v1/chat/completions");
  const [body, setBody] = useState(preset?.body ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<HttpResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (id: string) => {
    const p = TRY_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setMethod(p.method);
    setPath(p.path);
    setBody(p.body);
    setResult(null);
    setError(null);
  };

  const bodyError = method === "POST" && body.trim() ? jsonError(body) : null;
  const pathError = path.startsWith("/") ? null : "The path must start with /";

  const send = async () => {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await publicServerRequest(method, path, method === "POST" ? body : undefined);
      setResult(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const insertImage = async () => {
    try {
      const file = await pickFile({ title: "Choose an image", name: "Images", extensions: IMAGE_EXTENSIONS });
      if (!file) return;
      const url = await readImageDataUrl(file);
      setBody((b) => b.split(IMAGE_PLACEHOLDER).join(url));
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const tone = !result ? undefined : result.status < 300 ? "green" : result.status < 500 ? "orange" : "red";
  const prettyBody = result ? tryPrettyJson(result.body) : null;

  return (
    <div className="sv-try">
      <div className="row row--wrap">
        {TRY_PRESETS.map((p) => (
          <Chip key={p.id} on={p.id === presetId} onClick={() => choose(p.id)}>
            {p.label}
          </Chip>
        ))}
      </div>
      {preset?.note && presetId && <div className="xsmall muted">{preset.note}</div>}

      <div className="row">
        <Select<Method>
          value={method}
          onChange={(m) => {
            setMethod(m);
            setPresetId("");
          }}
          options={[
            { value: "GET", label: "GET" },
            { value: "POST", label: "POST" },
          ]}
          style={{ width: 90 }}
        />
        <TextInput
          className="wb-mono-input"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setPresetId("");
          }}
          aria-label="Path"
        />
        <Button
          variant="primary"
          icon={<Send size={13} />}
          onClick={send}
          loading={sending}
          disabled={!props.running || !!bodyError || !!pathError}
          title={props.running ? "Send the request" : "Start the server first"}
        >
          Send
        </Button>
      </div>
      {pathError && <div className="field__error">{pathError}</div>}

      {method === "POST" && (
        <Field error={bodyError ? `Not valid JSON: ${bodyError}` : undefined}>
          <TextArea
            className="wb-mono-input"
            rows={12}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
            aria-label="Request body"
          />
        </Field>
      )}
      {method === "POST" && body.includes(IMAGE_PLACEHOLDER) && (
        <div className="row">
          <Button size="sm" icon={<ImagePlus size={13} />} onClick={insertImage}>
            Insert image…
          </Button>
          <span className="xsmall muted">Replaces the placeholder with a data URL.</span>
        </div>
      )}

      <CommandPreview command={curlFor(props.target, method, path, body)} />
      {!props.running && <div className="xsmall muted">Start the server to send requests.</div>}

      {error && <Callout tone="error">{error}</Callout>}
      {result && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <Badge tone={tone}>HTTP {result.status}</Badge>
            <span className="xsmall muted">{formatDuration(result.durationMs)}</span>
            <span className="xsmall muted">· {result.body.length.toLocaleString("en-US")} bytes</span>
          </div>
          <CodeBlock code={prettyBody ?? (result.body || "(empty body)")} wrap maxHeight={420} />
        </div>
      )}
    </div>
  );
}
