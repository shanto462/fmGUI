# Python and other clients

There are three ways to use the model from code:

| Way | Talks to | Status on this Mac |
|-----|----------|--------------------|
| Apple's Python SDK `apple-fm-sdk` | The Foundation Models framework directly (native bindings) | Not installed. Unverified. |
| Any HTTP client against `fm serve` | `fm serve` over TCP or a Unix socket | httpx (Python) and fetch (Node 22) tested |
| Run the `fm` CLI as a subprocess | `fm respond`, `fm count-tokens`, ... | Tested |

## Apple's Python SDK: apple-fm-sdk (unverified)

Facts from the project page and WWDC26 session 334 (not tested here, because the system Python on this Mac is 3.9.6 and the SDK needs 3.10+):

| Item | Value |
|------|-------|
| PyPI package | `apple-fm-sdk` |
| Import name | `apple_fm_sdk` |
| Version seen in research | 0.2.1 |
| License | Apache-2.0 |
| Python | 3.10 or later |
| Needs | macOS 26 or later, Xcode 26 or later (with its license accepted), Apple Intelligence on, Apple Silicon |
| How it works | Native bindings to the Foundation Models framework. It does **not** use `fm serve`. |
| Source | https://github.com/apple/python-apple-fm-sdk |

Install:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install apple-fm-sdk
```

Basic use (from the project README, unverified):

```python
import asyncio

import apple_fm_sdk as fm


async def main():
    model = fm.SystemLanguageModel()
    is_available, reason = model.is_available()
    if not is_available:
        print("Model not available:", reason)
        return
    session = fm.LanguageModelSession(instructions="Be brief.")
    response = await session.respond("Hello, how are you?")
    print(response)


asyncio.run(main())
```

Main names in the SDK (unverified): `SystemLanguageModel`, `LanguageModelSession`, `respond()` (with streaming and guided generation), the `@fm.generable` decorator for typed structured output, and `fm.guide()` to constrain fields. WWDC26 session 334 says it also supports image input and tool calling.

Because it uses the framework directly, the SDK may support things that `fm serve` does not, such as real tool calling. This was not tested.

## OpenAI Python SDK against fm serve (unverified)

The `openai` package was not installed here. The requests below match the curl requests that were tested.

```python
from openai import OpenAI

# Start the server first: fm serve
client = OpenAI(base_url="http://127.0.0.1:1976/v1", api_key="unused")

r = client.chat.completions.create(
    model="system",
    messages=[
        {"role": "system", "content": "Answer in one sentence."},
        {"role": "user", "content": "What is a haiku?"},
    ],
    stream=False,               # always set it: the server default is True
    max_completion_tokens=200,  # max_tokens is ignored by fm serve
    temperature=0,
)
print(r.choices[0].message.content)
```

Streaming:

```python
stream = client.chat.completions.create(
    model="system",
    messages=[{"role": "user", "content": "Count to five."}],
    stream=True,
    stream_options={"include_usage": True},
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

Structured output with `response_format`:

```python
r = client.chat.completions.create(
    model="system",
    stream=False,
    messages=[{"role": "user", "content": "Extract: Ada Lovelace is 36 years old."}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "Person",
            "schema": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "age": {"type": "integer"}},
                "required": ["name", "age"],
            },
        },
    },
)
```

Things that will not work with the OpenAI SDK: `client.chat.completions.parse()` with Pydantic models (titles on fields, see [Structured output](05-structured-output.md)), `tools` (no `tool_calls` come back), `stop`, `n > 1`, the `developer` role, the Responses API (`client.responses`, there is no `/v1/responses` endpoint), embeddings, and audio.

Over a Unix socket, pass an httpx client (unverified):

```python
import httpx
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost/v1",
    api_key="unused",
    http_client=httpx.Client(transport=httpx.HTTPTransport(uds="/tmp/fm.sock")),
)
```

## httpx over a Unix socket (tested)

`httpx` can talk to a Unix socket with `HTTPTransport(uds=...)`. The full tested example (health check, non-streaming, streaming with usage and `event: error` handling) is in [Serve API](03-serve-api.md#python-with-httpx-over-a-unix-socket-tested).

Short version:

```python
import httpx

client = httpx.Client(
    transport=httpx.HTTPTransport(uds="/tmp/fm.sock"),
    base_url="http://localhost",
    timeout=120,
)
r = client.post("/v1/chat/completions", json={
    "stream": False,
    "messages": [{"role": "user", "content": "Say OK."}],
})
print(r.json()["choices"][0]["message"]["content"])  # OK.
```

Async works the same with `httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(uds=...))` (unverified).

## Running the CLI from code (tested)

Good for one-shot tasks. Rules:

- Pass the prompt as an argument, never through a shell string (no injection).
- Set stdin to null, or `fm` may wait for stdin.
- Read the answer from stdout. Read errors from stderr and strip color codes.
- Check the exit code: 0 ok, 1 error, 64 usage error, 69 license not agreed.

```python
import re
import subprocess

ANSI = re.compile(r"\x1b\[[0-9;]*m")


def fm_respond(prompt, instructions=None, schema=None):
    cmd = ["fm", "respond", "--no-stream"]
    if instructions:
        cmd += ["-i", instructions]
    if schema:
        cmd += ["--schema", schema]
    cmd += ["--", prompt]
    p = subprocess.run(cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if p.returncode != 0:
        raise RuntimeError(ANSI.sub("", p.stderr).strip())
    return p.stdout.strip()


print(fm_respond("Give me one word for happy.", instructions="Answer with one word."))
```

A full Pydantic example with `fm respond --schema` is in [Structured output](05-structured-output.md#pydantic-and-other-generators).

## Other languages

- **JavaScript / TypeScript:** `fetch` works against TCP from Node (tested with Node 22, see [Serve API](03-serve-api.md#javascript-fetch-tested-with-node-22)). From a browser page it gets 403 (cross-site protection). The official `openai` npm package should work with `baseURL: "http://127.0.0.1:1976/v1"` (unverified). For a Unix socket in Node, use `http.request({ socketPath })` (unverified).
- **Rust:** call `fm serve` over a Unix socket with `hyper` plus `hyperlocal`, or over TCP with `reqwest` (unverified). Native code sends no `Origin` header, so the cross-site check does not apply.
- **Swift:** use the Foundation Models framework directly instead of `fm`. See [Foundation Models framework](11-foundation-models-framework.md).
- **Tools that accept a custom OpenAI base URL** (editors, chat apps): point them at `http://127.0.0.1:1976/v1`, model `system`, any API key. Many of them use streaming, tools or `max_tokens`, so results vary (unverified).
