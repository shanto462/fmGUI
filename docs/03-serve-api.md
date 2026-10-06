# `fm serve` HTTP API

`fm serve` runs a small local HTTP server that speaks the OpenAI **Chat Completions** API. Any OpenAI-compatible client can use it, with the limits below.

Everything here was tested on macOS 27.0.1 (26A434) unless marked "(unverified)". JSON key order in real responses changes from call to call. The examples below show one order.

## Start and stop

```sh
fm serve                          # TCP, http://127.0.0.1:1976
fm serve --port 8080              # TCP on another port
fm serve --host 127.0.0.1 --port 1976
fm serve --socket /tmp/fm.sock    # Unix domain socket, no TCP port
```

- Default address is `127.0.0.1`, default port is **1976**.
- `--socket` cannot be combined with `--host` or `--port`.
- `--host 0.0.0.0` makes the server reachable from your network. There is **no authentication**. Do not do this on a shared network.
- Stop with Ctrl+C (SIGINT) or SIGTERM. It prints `· shutting down`. In socket mode the socket file is deleted on exit.

Startup banner (TCP):

```text
Apple Foundation Models Serve
  url    http://127.0.0.1:1976
  access loopback-only

  · POST /v1/chat/completions
  · GET  /v1/models
  · GET  /health

  · listening on http://127.0.0.1:1976  (press Ctrl+C to stop)
```

In socket mode the banner shows `socket ./fm.sock` instead of `url` and `access`.

### Request log

One line when a request starts and one when it ends:

```text
18:30:26 · [POST] · /v1/chat/completions · unknown
18:30:27 · [POST] · /v1/chat/completions · 200 · unknown · 58→5 tokens · 929ms
18:30:16 · [POST] · /v1/chat/completions · 403 · CSRF
18:24:53 · [GET]  · /health · 200
```

- `unknown` means the request had no `model` field. With `"model": "system"` the log shows `system`.
- `58→5 tokens` is prompt tokens → completion tokens.
- When stdout is a file or a pipe (not a terminal), log lines are **buffered** and arrive late, in blocks. Running the server under a pseudo terminal (for example `script -q /dev/null fm serve ...`) gave normal line output in a test (exact timing not measured).

## Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Health check. |
| GET | `/v1/models` | List models. |
| GET | `/v1/models/system` | One model. Works, but not listed in the help. |
| POST | `/v1/chat/completions` | Chat. Streaming and non-streaming. |
| OPTIONS | any | CORS preflight. |

Anything else returns 404:

```json
{"error":{"type":"not_found","code":"404","message":"Not found: GET /nope"}}
```

`GET /health`:

```json
{"models":[{"name":"system","available":true}],"status":"fm serve is running"}
```

`GET /v1/models`:

```json
{"data":[{"owned_by":"Apple","object":"model","created":1791289493,"id":"system"}],"object":"list"}
```

`created` is the current time, not a release date. Normal responses have `Connection: close` (no keep-alive). Streams use `Connection: keep-alive` until they end.

## POST /v1/chat/completions

### Request fields

| Field | Status | Notes |
|-------|--------|-------|
| `messages` | Works | Required and must not be empty. |
| `model` | Works | Optional. Only `"system"`. |
| `stream` | Works | **Default is `true`**. Send `"stream": false` for one JSON answer. |
| `stream_options.include_usage` | Works | Adds a final chunk with `usage`. |
| `response_format` `{"type":"json_schema"}` | Works | Guided JSON. See below and [Structured output](05-structured-output.md). |
| `response_format` `{"type":"text"}` | Works | Same as leaving it out. |
| `temperature` | Works | `0` gave the same answer 4 of 4 times. Default sampling gave 4 different answers in 4 runs. |
| `seed` | Works | Same seed gave the same answer 4 of 4 times. |
| `max_completion_tokens` | Works | Cuts the answer at N tokens. `finish_reason` is still `"stop"`, not `"length"`. |
| `max_tokens` | **Ignored** | Accepted, no effect. Use `max_completion_tokens`. |
| `n` | `1` only | `n=2` → 400. |
| `tools`, `tool_choice` | Accepted, do not work | No `tool_calls` are ever returned. See [Tools](06-tools.md). |
| `top_p`, `frequency_penalty`, `presence_penalty`, `logprobs`, `top_logprobs`, `logit_bias`, `user`, `metadata`, `store`, `parallel_tool_calls`, `modalities`, `audio`, `service_tier`, `prediction`, `web_search_options` | Accepted, ignored | No error. No `logprobs` in the answer. Effect of `top_p` unverified. |
| Unknown fields | Accepted, ignored | |
| `stop` | Rejected | 400. A `null` value is accepted. |
| `response_format` `{"type":"json_object"}` | Rejected | 400. |
| `reasoning_effort` | Rejected | 400. |

### Messages

| Role | Status |
|------|--------|
| `system` | Works. Several system messages also work (both were followed in a test). |
| `user` | Works. |
| `assistant` | Works, including `tool_calls` from earlier turns. |
| `tool` | Works with `tool_call_id` that matches an earlier assistant `tool_calls[].id`. |
| `developer` | Rejected: 400 `Invalid JSON: The data couldn’t be read because it isn’t in the correct format.` |
| `function` (legacy) | Rejected with a clear 400 message. |
| any other | Rejected like `developer`. |

`content` can be a string or an array of parts:

| Part type | Status |
|-----------|--------|
| `{"type":"text","text":"..."}` | Works. |
| `{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}` | Works. `detail` is accepted (effect unknown). PNG was tested (other types unverified). |
| `image_url` with an `https://` URL | Rejected. `fm serve` does not download images. |
| `image_url` as a plain string (not an object) | Rejected (400 `Invalid JSON`). |
| `input_audio` and other types | Rejected (400 `Invalid JSON`). |

**The last message must be a `user` (or `tool`) message.** If the list ends with an `assistant` or `system` message, the server returns 200 with an **empty** `content` (`""`). There is no assistant "prefill".

### Images

Send images inline as data URLs:

```json
{
  "stream": false,
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "What is the order number?"},
      {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KG..."}}
    ]
  }]
}
```

Real answer: `The order number is A-1234.` A 1200x400 PNG cost about 200 prompt tokens.

### Non-streaming response

```json
{
  "id": "chatcmpl-13B4EAF9-7E85-4657-A344-506B5AAEE2D4",
  "object": "chat.completion",
  "created": 1791289494,
  "model": "system",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "OK.", "refusal": null},
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 58,
    "completion_tokens": 5,
    "total_tokens": 63,
    "prompt_tokens_details": {"cached_tokens": 0},
    "completion_tokens_details": {"reasoning_tokens": 0}
  }
}
```

- `prompt_tokens` includes a hidden chat template. A one-word prompt is already about 58 tokens.
- `cached_tokens` and `reasoning_tokens` were always 0 in tests, even when the same long system prompt was sent 3 times.
- `finish_reason` was always `"stop"`.

### Streaming (Server-Sent Events)

If you leave out `stream`, or send `"stream": true`, you get `Content-Type: text/event-stream`:

```text
data: {"id":"chatcmpl-709E...","object":"chat.completion.chunk","created":1791289500,"model":"system","choices":[{"index":0,"delta":{"role":"assistant"}}]}

data: {"id":"chatcmpl-709E...","object":"chat.completion.chunk","created":1791289501,"model":"system","choices":[{"index":0,"delta":{"content":"1,"}}]}

data: {"id":"chatcmpl-709E...","object":"chat.completion.chunk","created":1791289501,"model":"system","choices":[{"index":0,"delta":{"content":" 2"}}]}

data: {"id":"chatcmpl-709E...","object":"chat.completion.chunk","created":1791289501,"model":"system","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

- The first chunk has only `delta.role`.
- Each content chunk is a small piece of text (a few characters).
- The last chunk has an empty `delta` and `finish_reason: "stop"`.
- With `"stream_options": {"include_usage": true}` there is one more chunk before `[DONE]`, with `"choices": []` and a `usage` object.

**Errors during a stream:** the HTTP status is already 200, so the error comes as an SSE event, and there is no `[DONE]` after it:

```text
event: error
data: {"error":{"type":"server_error","code":"500","message":"The session's transcript exceeded the model's context size."}}
```

Your parser must handle `event: error` lines.

### response_format with json_schema

```json
{
  "stream": false,
  "messages": [{"role": "user", "content": "Extract the person: Ada Lovelace is 36 years old."}],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "Person",
      "schema": {
        "type": "object",
        "properties": {"name": {"type": "string"}, "age": {"type": "integer"}},
        "required": ["name", "age"]
      }
    }
  }
}
```

Real `content`: `{"name": "Ada Lovelace", "age": 36}`. The answer is a JSON **string** in `message.content`. Parse it yourself.

The server is more relaxed than `fm respond --schema` at the top level, but strict inside `$defs`. Rules, tests and a helper: [Structured output](05-structured-output.md).

## Errors

All errors use this shape (key order varies):

```json
{"error": {"message": "...", "type": "invalid_request_error", "code": "400"}}
```

Note: `code` is a **string**. Some messages use the typographic apostrophe `’` (as in `couldn’t`), so match on other words.

| Case | Status | Message |
|------|--------|---------|
| Empty `messages` | 400 | `The 'messages' array must not be empty.` |
| Unknown model | 400 | `Unknown model 'gpt-4'. Available models: system` |
| `json_object` | 400 | `response_format type 'json_object' is not supported. Use 'json_schema' instead.` |
| `stop` | 400 | `stop sequences are not supported. Truncate the model's output client-side.` |
| `n: 2` | 400 | `n=2 is not supported. Only a single completion per request is implemented.` |
| `reasoning_effort` | 400 | `reasoning_effort is not supported by the 'system' model.` |
| Role `function` | 400 | `Invalid request: message role 'function' is not supported. Use role 'tool' with tool_call_id for tool results; the legacy 'function' role was deprecated by OpenAI.` |
| `tool` message without id | 400 | `Invalid request: tool message is missing tool_call_id` |
| `tool` message with unknown id | 400 | `Invalid request: tool message references unknown tool_call_id: 'call_9'` |
| `tool_choice` names a missing tool | 400 | `tool_choice names function 'nope' which is not present in tools: [get_weather]` |
| Remote image URL | 400 | `Invalid request: image_url must be inlined as 'data:image/<type>;base64,<bytes>'; got 'https'. Note: fm serve does not fetch remote URLs.` |
| Bad image bytes | 400 | `Invalid request: invalid image data: ImageIO could not decode the image bytes` |
| Bad JSON or unknown role | 400 | `Invalid JSON: The data couldn’t be read because it isn’t in the correct format.` |
| `json_schema` without `name` or `schema` | 400 | `Invalid JSON: The data couldn’t be read because it is missing.` |
| Schema problem | 400 | `Invalid response_format schema: DecodingError...` (see [Structured output](05-structured-output.md)) |
| Cross-site request | 403 | `Cross-site requests are not allowed.` (type `permission_denied`) |
| Unknown path or wrong method | 404 | `Not found: GET /v1/chat/completions` (type `not_found`) |
| `tool_choice: "required"` or a named function | 500 | `An unsupported generation guide was used.` |
| Unsupported schema keyword (for example `pattern`) | 500 | `An unsupported generation guide was used.` |
| Context too long | 500 | `The session's transcript exceeded the model's context size.` |
| Safety filter | 500 | `The model's safety guardrails were triggered.` |

Other messages in the binary (not triggered in tests): `Model 'system' is unavailable: <reason>` (`service_unavailable`), `Payload Too Large`, `Request Header Fields Too Large`, `Malformed HTTP request`. A 20 MB body was **not** rejected as too large (it hit the safety filter), so the size limit is above that.

Server errors use type `server_error`.

## Cross-site protection and CORS (TCP mode)

The server blocks browser cross-site requests (CSRF). Tested rules:

**Preflight** (`OPTIONS`) always returns 204 and echoes the `Origin` and the requested headers:

```text
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://evil.example
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: content-type
Access-Control-Max-Age: 600
Vary: Origin
```

But the real **POST** is then checked. Tested rules:

| Request headers | Result |
|-----------------|--------|
| No `Origin` and no `Sec-Fetch-Site` (curl, Python, Node, a Rust backend) | 200 |
| `Origin: http://localhost:5173`, `http://localhost`, `https://localhost` (alone) | 200 |
| `Origin: http://127.0.0.1:3000`, `http://[::1]:8080` (alone) | 200 |
| `Origin: https://evil.example` | **403** |
| `Origin: tauri://localhost` or `http://tauri.localhost` | **403** |
| `Origin: null`, `file://` | **403** |
| `Origin: http://app.localhost:3000` | **403** |
| `Sec-Fetch-Site: cross-site` or `same-site` (with or without a loopback `Origin`) | **403** |
| `Sec-Fetch-Site: same-origin` or `none` with no `Origin` or a loopback `Origin` | 200 |
| `Sec-Fetch-Site: same-origin` or `none` with `Origin: https://evil.example` | **403** |
| `Content-Type: text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data` | **403** |
| No `Content-Type` | 200 |
| Any `Authorization` header | Ignored (no auth) |

The server log shows these as `403 · CSRF`. GET requests (`/health`, `/v1/models`) are allowed from any origin, with `Access-Control-Allow-Origin` echoed.

What this means in practice:

- Modern browsers send `Sec-Fetch-Site` with every `fetch`. A page on `http://localhost:5173` calling `http://localhost:1976` sends `same-site`, and a page on `http://localhost` calling `http://127.0.0.1:1976` sends `cross-site`. Both get **403**. So **a normal web page cannot POST to `fm serve`**, even on localhost. Use a small backend (for example a dev-server proxy) that forwards the request without these headers.
- A **Tauri or Electron webview cannot** POST to it directly either (origin `tauri://localhost` or similar). Call `fm serve` from the native side (Rust, Node main process) instead.
- Over a **Unix socket** none of these checks apply. A POST with `Origin: https://evil.example` and `Content-Type: text/plain` returned 200.

## Unix socket vs TCP

| | Unix socket (`--socket`) | TCP (default) |
|---|---|---|
| Who can connect | Anyone with file access to the socket. It is created `srwxr-xr-x`, so put it in a private folder. | Any local process. Any device on the network if you bind `0.0.0.0`. |
| Browser access | No | No for POST in modern browsers (see above). GET works. |
| Cross-site checks | None | Yes (see above) |
| Port conflicts | None | `Address already in use` if 1976 is taken |
| Clients | curl `--unix-socket`, httpx `uds=`, Rust `hyperlocal` and others | Any HTTP client |

Socket gotchas (tested):

- Starting a **second** server on the same socket path does not fail. It replaces the socket file. The first server keeps running but nobody can reach it, and when the second server stops, the file is deleted. Use one path per server and check before you start.
- A stale regular file at the path is replaced.
- The socket file is removed on SIGINT and SIGTERM. After a crash (SIGKILL) it may stay (unverified).

## Concurrency and speed

- 3 parallel requests all returned 200. They finished at 1.5 s, 2.5 s and 3.7 s, so they share one model and partly wait for each other.
- Warm first token is about 0.4 s. After 30 s idle it is about 1 s. About 46 to 50 tokens per second on an M4 Pro.
- An over-long prompt takes about 20 s before the context error comes back. Count tokens first (see [Limits](07-limits-and-gotchas.md)).

## Examples

### curl (TCP)

```sh
curl -s http://127.0.0.1:1976/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"stream": false, "messages": [{"role": "user", "content": "Say OK."}]}'
```

### curl (Unix socket)

The host name in the URL is ignored. `localhost` is fine.

```sh
curl -s --unix-socket /tmp/fm.sock http://localhost/health

curl -s --unix-socket /tmp/fm.sock http://localhost/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"stream": false, "messages": [{"role": "user", "content": "Say OK."}]}'
```

### curl streaming

```sh
curl -N --unix-socket /tmp/fm.sock http://localhost/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"stream_options": {"include_usage": true}, "messages": [{"role": "user", "content": "Count from 1 to 3."}]}'
```

### curl with an image

```sh
IMG=$(base64 -i invoice.png | tr -d '\n')
printf '{"stream":false,"messages":[{"role":"user","content":[{"type":"text","text":"What is the total?"},{"type":"image_url","image_url":{"url":"data:image/png;base64,%s"}}]}]}' "$IMG" > req.json
curl -s --unix-socket /tmp/fm.sock http://localhost/v1/chat/completions \
  -H 'Content-Type: application/json' -d @req.json
```

Real answer: `The total for Order A-1234 is $42.50.`

### Python with httpx over a Unix socket (tested)

```python
"""Talk to `fm serve --socket /tmp/fm.sock` with httpx (pip install httpx)."""
import json

import httpx

client = httpx.Client(
    transport=httpx.HTTPTransport(uds="/tmp/fm.sock"),
    base_url="http://localhost",  # host is ignored, the socket is used
    timeout=120,
)

print(client.get("/health").json())

# Non-streaming
r = client.post("/v1/chat/completions", json={
    "stream": False,
    "messages": [
        {"role": "system", "content": "Answer in one short sentence."},
        {"role": "user", "content": "What is a haiku?"},
    ],
})
data = r.json()
print(data["choices"][0]["message"]["content"])
print(data["usage"])

# Streaming with a final usage chunk
body = {
    "stream": True,
    "stream_options": {"include_usage": True},
    "messages": [{"role": "user", "content": "Count to five."}],
}
with client.stream("POST", "/v1/chat/completions", json=body) as resp:
    event = None
    for line in resp.iter_lines():
        if line.startswith("event: "):
            event = line[7:]  # "error" when generation fails mid-stream
        elif line.startswith("data: "):
            payload = line[6:]
            if payload == "[DONE]":
                break
            chunk = json.loads(payload)
            if event == "error":
                raise RuntimeError(chunk["error"]["message"])
            if chunk.get("usage"):
                print("\nusage:", chunk["usage"])
            for choice in chunk["choices"]:
                print(choice["delta"].get("content", ""), end="", flush=True)
```

Real output:

```text
{'status': 'fm serve is running', 'models': [{'available': True, 'name': 'system'}]}
A haiku is a traditional Japanese poem with three lines.
{'prompt_tokens_details': {'cached_tokens': 0}, 'prompt_tokens': 68, 'total_tokens': 83, 'completion_tokens': 15, 'completion_tokens_details': {'reasoning_tokens': 0}}
1, 2, 3, 4, 5.
usage: {'total_tokens': 78, 'completion_tokens': 19, ...}
```

### Python with the OpenAI SDK (unverified)

The `openai` package was not installed on this Mac, so this was not run. The request it sends matches the tested curl requests.

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:1976/v1", api_key="unused")

r = client.chat.completions.create(
    model="system",
    messages=[{"role": "user", "content": "Say OK."}],
    stream=False,               # always set it, the server default is True
    max_completion_tokens=200,  # max_tokens is ignored
)
print(r.choices[0].message.content)
```

Over a Unix socket, give the SDK an httpx client (unverified):

```python
import httpx
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost/v1",
    api_key="unused",
    http_client=httpx.Client(transport=httpx.HTTPTransport(uds="/tmp/fm.sock")),
)
```

### JavaScript fetch (tested with Node 22)

Works from Node (and likely Deno and Bun). It does **not** work from a browser page or a Tauri webview for POST requests (403, see above).

```js
const BASE = process.env.FM_URL ?? "http://127.0.0.1:1976";

// 1. Non-streaming
const r = await fetch(`${BASE}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    stream: false,
    messages: [{ role: "user", content: "Name three colors." }],
  }),
});
const data = await r.json();
console.log(data.choices[0].message.content);
console.log(data.usage);

// 2. Streaming (SSE). The default is stream: true.
const s = await fetch(`${BASE}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "Count to five." }] }),
});
const reader = s.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const events = buffer.split("\n\n");
  buffer = events.pop();
  for (const ev of events) {
    if (ev.startsWith("event: error")) throw new Error(ev);
    const line = ev.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    const payload = line.slice(6);
    if (payload === "[DONE]") continue;
    const chunk = JSON.parse(payload);
    process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
  }
}
process.stdout.write("\n");
```

Real output:

```text
Red, blue, green.
{
  completion_tokens_details: { reasoning_tokens: 0 },
  prompt_tokens: 59,
  total_tokens: 72,
  prompt_tokens_details: { cached_tokens: 0 },
  completion_tokens: 13
}
1, 2, 3, 4, 5
```
