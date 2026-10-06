// Code snippets, "Try it" presets and the compatibility table for the API Server
// page. Facts tested against `fm serve` on macOS 27.0.1. OWNER: agent "ui-build".

import { shellQuote } from "../../lib/fmArgs";

export interface Target {
  mode: "tcp" | "socket";
  /** http://127.0.0.1:1976 (TCP mode). */
  baseUrl: string;
  socketPath: string;
}

export interface Snippet {
  id: string;
  label: string;
  code: string;
}

const PROMPT = "Write a haiku about the sea.";

const CHAT_BODY = {
  model: "system",
  stream: false,
  messages: [{ role: "user", content: PROMPT }],
};

/** Python string literal (JSON strings are valid Python strings for normal paths). */
const py = (s: string) => JSON.stringify(s);

export function snippetsFor(t: Target): Snippet[] {
  const body = JSON.stringify(CHAT_BODY);
  if (t.mode === "socket") {
    const sock = t.socketPath;
    return [
      {
        id: "curl",
        label: "curl",
        code: [
          `curl --unix-socket ${shellQuote(sock)} http://localhost/v1/chat/completions \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d ${shellQuote(body)}`,
        ].join("\n"),
      },
      {
        id: "python",
        label: "Python (httpx)",
        code: `import httpx

# Talk HTTP over the Unix socket. The host name in base_url is ignored.
transport = httpx.HTTPTransport(uds=${py(sock)})

with httpx.Client(transport=transport, base_url="http://localhost", timeout=120) as client:
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "system",
            "stream": False,  # fm serve streams by default
            "messages": [{"role": "user", "content": ${py(PROMPT)}}],
        },
    )
    r.raise_for_status()
    print(r.json()["choices"][0]["message"]["content"])

# The OpenAI SDK works too:
#   from openai import OpenAI
#   client = OpenAI(base_url="http://localhost/v1", api_key="unused",
#                   http_client=httpx.Client(transport=transport))
`,
      },
    ];
  }

  const url = t.baseUrl;
  return [
    {
      id: "curl",
      label: "curl",
      code: [
        `curl ${url}/v1/chat/completions \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d ${shellQuote(body)}`,
      ].join("\n"),
    },
    {
      id: "python",
      label: "Python (openai)",
      code: `# pip install openai
from openai import OpenAI

# No API key is checked, but the SDK needs a value.
client = OpenAI(base_url=${py(`${url}/v1`)}, api_key="unused")

reply = client.chat.completions.create(
    model="system",
    messages=[{"role": "user", "content": ${py(PROMPT)}}],
    # fm serve streams by default. Without stream=False the SDK gets a
    # stream it did not ask for and fails to parse it.
    stream=False,
)
print(reply.choices[0].message.content)

# Streaming:
# for chunk in client.chat.completions.create(model="system", messages=[...], stream=True):
#     print(chunk.choices[0].delta.content or "", end="", flush=True)
`,
    },
    {
      id: "js",
      label: "Node.js / Deno / Bun",
      code: `// Node.js 18+, Deno or Bun. Browsers are blocked: fm serve answers HTTP 403
// when the request has Sec-Fetch-Site: same-site or cross-site.
const res = await fetch(${JSON.stringify(`${url}/v1/chat/completions`)}, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "system",
    stream: false, // fm serve streams by default
    messages: [{ role: "user", content: ${JSON.stringify(PROMPT)} }],
  }),
});
if (!res.ok) throw new Error(\`HTTP \${res.status}: \${await res.text()}\`);
const data = await res.json();
console.log(data.choices[0].message.content);
`,
    },
  ];
}

export interface Endpoint {
  method: "GET" | "POST";
  path: string;
  description: string;
}

export const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/health", description: "Health check and model availability" },
  { method: "GET", path: "/v1/models", description: "Lists the models (one: system)" },
  { method: "POST", path: "/v1/chat/completions", description: "Chat Completions, streaming and non-streaming" },
];

/** What to copy for an endpoint: a URL (TCP) or a curl command (socket). */
export function endpointCopyText(t: Target, e: Endpoint): string {
  if (t.mode === "socket") {
    const post = e.method === "POST" ? ` -H "Content-Type: application/json" -d ${shellQuote(JSON.stringify(CHAT_BODY))}` : "";
    return `curl --unix-socket ${shellQuote(t.socketPath)} http://localhost${e.path}${post}`;
  }
  return `${t.baseUrl}${e.path}`;
}

export interface TryPreset {
  id: string;
  label: string;
  method: "GET" | "POST";
  path: string;
  body: string;
  note?: string;
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export const IMAGE_PLACEHOLDER = "data:image/png;base64,REPLACE_WITH_BASE64";

export const TRY_PRESETS: TryPreset[] = [
  { id: "health", label: "Health", method: "GET", path: "/health", body: "" },
  { id: "models", label: "Models", method: "GET", path: "/v1/models", body: "" },
  {
    id: "chat",
    label: "Chat (no stream)",
    method: "POST",
    path: "/v1/chat/completions",
    body: pretty({
      model: "system",
      stream: false,
      messages: [
        { role: "system", content: "Answer in one short sentence." },
        { role: "user", content: "What is an on-device language model?" },
      ],
    }),
  },
  {
    id: "stream",
    label: "Chat (stream)",
    method: "POST",
    path: "/v1/chat/completions",
    body: pretty({
      model: "system",
      stream: true,
      messages: [{ role: "user", content: "Count from 1 to 5, one number per line." }],
    }),
    note: "The reply is a server-sent event stream (data: lines), shown as raw text.",
  },
  {
    id: "json",
    label: "JSON schema output",
    method: "POST",
    path: "/v1/chat/completions",
    body: pretty({
      model: "system",
      stream: false,
      messages: [{ role: "user", content: "The new update is fast, but the battery drains quicker." }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "Sentiment",
          schema: {
            title: "Sentiment",
            type: "object",
            additionalProperties: false,
            "x-order": ["label", "score"],
            required: ["label", "score"],
            properties: {
              label: { type: "string", description: "positive, negative, mixed or neutral" },
              score: { type: "number", description: "From -1 to 1" },
            },
          },
        },
      },
    }),
    note: "The schema needs title, additionalProperties false and x-order. The Schema Builder makes one for you.",
  },
  {
    id: "image",
    label: "Image input",
    method: "POST",
    path: "/v1/chat/completions",
    body: pretty({
      model: "system",
      stream: false,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            { type: "image_url", image_url: { url: IMAGE_PLACEHOLDER } },
          ],
        },
      ],
    }),
    note: "Images must be data URLs. Use Insert image to replace the placeholder. Remote https URLs are rejected.",
  },
];

export type CompatStatus = "works" | "rejected" | "ignored" | "note";

export const COMPAT: { feature: string; status: CompatStatus; note: string }[] = [
  { feature: "messages", status: "works", note: "Roles system, user, assistant and tool." },
  { feature: "stream", status: "works", note: "Defaults to true. Send \"stream\": false for one JSON reply." },
  {
    feature: "Errors while streaming",
    status: "note",
    note: "Sent as an event: error message. No data: [DONE] line follows, so do not wait for one.",
  },
  {
    feature: "response_format: json_schema",
    status: "works",
    note: "The schema needs title, additionalProperties false and x-order.",
  },
  { feature: "stream_options.include_usage", status: "works", note: "Adds a final chunk with usage." },
  { feature: "image_url with a data URL", status: "works", note: "Base64 data URLs only." },
  {
    feature: "max_completion_tokens",
    status: "works",
    note: "Cuts the reply at N tokens. finish_reason is still \"stop\", not \"length\".",
  },
  { feature: "temperature, seed", status: "works", note: "temperature 0 or a fixed seed gives repeatable answers." },
  { feature: "max_tokens", status: "ignored", note: "Accepted, no effect. Use max_completion_tokens." },
  { feature: "stop", status: "rejected", note: "HTTP 400." },
  { feature: "response_format: json_object", status: "rejected", note: "HTTP 400. Use json_schema instead." },
  { feature: "reasoning_effort", status: "rejected", note: "HTTP 400." },
  { feature: "role: developer", status: "rejected", note: "HTTP 400. Use a system message instead." },
  {
    feature: "Requests from a browser page",
    status: "rejected",
    note: "HTTP 403 when Sec-Fetch-Site is same-site or cross-site, even from localhost. Call it from a server or app.",
  },
  { feature: "n greater than 1", status: "rejected", note: "HTTP 400. Only one choice per request." },
  { feature: "Remote image URLs (https://)", status: "rejected", note: "Download the image and send a data URL." },
  {
    feature: "tools, tool_choice",
    status: "ignored",
    note: "Accepted, but tool_calls never come back on macOS 27.0.1. tool_choice \"required\" gives HTTP 500.",
  },
];
