# Progress

Status of every piece of work. Updated as work moves.
Legend: ✅ done · 🔄 in progress · ⏳ pending · ⛔ blocked

## Research
- ✅ Found `/usr/bin/fm` (macOS 27.0.1, build 26A434), read `fm --help`, every `<command> --help`, and `man fm`.
- ✅ Tested every command for real: `available`, `license --status/--show`, `respond` (stream, no-stream, greedy, image, OCR tool, schema, transcripts, resume, use-case, guardrails), `count-tokens`, `schema object` (nested, anyOf, object), `chat` (in a pseudo terminal), `serve` (TCP and Unix socket).
- ✅ Probed `fm serve` request fields: json_schema, json_object, stop, tools, tool_choice, images, bad model, empty messages, reasoning_effort, CORS, context overflow.
- ✅ Extracted hidden facts from the binary strings (error messages, limits, tool instructions).
- ✅ Web research (WWDC26 sessions 334/241, Python SDK, community proxies, existing GUIs, license notes).

## Setup
- ✅ Rust toolchain installed (Homebrew rustup, stable 1.99.0).
- ✅ Tauri 2 project skeleton + shared contract (Rust command stubs, TS types, API wrapper, fm arg builders, store, design system, app shell). Builds: `cargo build`, `tsc`, `vite build`. In commit `init`.

## Build (delegated to agents)
- 🔄 Rust: `fm` CLI layer (runner, status, CLI sessions, respond/count/schema commands, public server manager).
- 🔄 Rust: agent engine (private `fm serve` client, guided-JSON tool router, built-in tools, custom tools, approvals, chat storage).
- 🔄 Rust: MCP client (stdio + Streamable HTTP) and skills loader.
- 🔄 UI: setup wizard, overview, settings (app shell + sidebar done by lead).
- 🔄 UI: agent chat + CLI sessions.
- 🔄 UI: tools, MCP, skills pages with step-by-step setup wizards.
- 🔄 UI: playground, schema builder, token counter, server page, docs viewer, settings.
- 🔄 Docs: `docs/` folder with the full collected documentation.

## Verify
- ⏳ `cargo build`, `cargo test`, `npm run build` (TypeScript check).
- ⏳ Real end-to-end: chat with a custom tool, an MCP server, and a skill against the real `fm`.
- ⏳ Build the `.app` bundle and launch it.

## Notes
- Test leftover to clean: `~/.fm/sessions/hello-friend.json` was created by Claude while testing `fm chat`.
