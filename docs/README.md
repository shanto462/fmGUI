# fm documentation

Documentation for Apple's `fm` command-line tool (Apple Foundation Models CLI) in macOS 27, and user guides for fmGUI.

Checked on macOS 27.0.1 (build 26A434), Apple M4 Pro, on 2026-10-06. Anything not tested on this Mac is marked "(unverified)" with its source.

## fmGUI guides

| Page | What is in it |
|------|---------------|
| [12 Getting started](12-getting-started.md) | Install, the Setup Guide, your first chat, approvals, the context window, where data is stored. |
| [13 Custom tools](13-custom-tools.md) | Shell, HTTP and Shortcut tools step by step: `FM_ARG_` variables, `{{param}}` placeholders, approvals, good descriptions, three examples. |
| [14 MCP servers](14-mcp-servers.md) | Add MCP servers with the wizard: templates, stdio vs Streamable HTTP, `npx` and `uvx`, per-tool switches and context cost, troubleshooting. |
| [15 Skills](15-skills.md) | The `SKILL.md` format, the three modes, how `use_skill` works, importing from `~/.claude/skills`, two example skills. |
| [16 Quick Chat](16-quick-chat.md) | The menu bar icon, the always-on-top overlay and the picture-in-picture pill, approvals, starting over. |

## fm pages

| Page | What is in it |
|------|---------------|
| [01 Overview](01-overview.md) | What `fm` is, requirements, models, context size, first run, files, speed, exit codes. |
| [02 Commands](02-commands.md) | Every command and flag (`available`, `chat`, `count-tokens`, `license`, `respond`, `schema object`, `serve`) with real output. |
| [03 Serve API](03-serve-api.md) | The `fm serve` HTTP API: endpoints, fields, streaming, errors, CORS, socket vs TCP, curl/Python/JS examples. |
| [04 Transcripts and sessions](04-transcripts-and-sessions.md) | Transcript JSON format, `--save-transcript`, `--resume`, `~/.fm/sessions`. |
| [05 Structured output](05-structured-output.md) | `fm schema object`, guided JSON, the strict schema rules, Pydantic helper. |
| [06 Tools](06-tools.md) | Built-in OCR and barcode tools, why `tool_calls` do not work in `fm serve`, and a working guided-JSON tool router. |
| [07 Limits and gotchas](07-limits-and-gotchas.md) | Every known limit and surprise, with what to do about it. |
| [08 Python and clients](08-python-and-clients.md) | Apple's `apple-fm-sdk`, OpenAI SDK, httpx over a Unix socket, subprocess use, other languages. |
| [09 Ecosystem](09-ecosystem.md) | Other GUIs, servers and proxies for the on-device model. |
| [10 License](10-license.md) | The terms in plain words, the unclear "expressly permitted" part, `sudo fm license`, exit code 69. |
| [11 Foundation Models framework](11-foundation-models-framework.md) | What is new in the Swift framework in 2026, checked against the macOS 27 SDK. |
| [Sources](sources.md) | All links and where each kind of fact comes from. |

## Five things to know first

1. `fm serve` streams by default. Send `"stream": false` if you want one JSON answer.
2. `fm serve` never returns `tool_calls`. Use the guided-JSON router in [Tools](06-tools.md).
3. Hand-written schemas need `title`, `required`, `x-order` and `additionalProperties` on every object for `fm respond --schema`.
4. Browser pages and webviews (for example `tauri://localhost`) get HTTP 403 from `fm serve` over TCP for POST requests. Call it from native code or over a Unix socket.
5. Spawn `fm` with stdin closed. Some commands wait for stdin when there is no prompt.
