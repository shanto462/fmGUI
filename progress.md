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
- ✅ Rust: `fm` CLI layer (runner, status, CLI sessions, respond/count/schema commands, public server manager). 41 tests, 9 against real fm. Commit `c765b1b`. Public server autostart wired in `1a3d178`.
- 🔄 Rust: agent engine (private `fm serve` client, guided-JSON tool router, built-in tools, custom tools, approvals, chat storage).
- ✅ Rust: MCP client (stdio + Streamable HTTP) and skills loader. 86 tests total; real `server-everything` works. Commit `b00250e`.
- ✅ UI: setup wizard (7 steps), overview dashboard, settings. Commit `9997a0d`.
- 🔄 UI: agent chat + CLI sessions.
- ✅ UI: tools, MCP, skills pages with step-by-step setup wizards. Commit `3a5efaf`.
- 🔄 UI: playground, schema builder, token counter, server page, docs viewer, settings.
- ✅ Docs: 13 pages in `docs/` (overview, commands, serve API, transcripts, structured output, tools, limits, Python/clients, ecosystem, license, framework, sources). Almost all facts run on this Mac.

## Extra
- ✅ Browser mock mode (`?mock=1`, dev only) for UI previews. Commit `c047a8f`.

## Verify
- ⏳ `cargo build`, `cargo test`, `npm run build` (TypeScript check).
- ⏳ Real end-to-end: chat with a custom tool, an MCP server, and a skill against the real `fm`.
- ⏳ Build the `.app` bundle and launch it.

## Polish backlog (from agent reports)
- ✅ `Steps` onSelect, `Modal` dismissible, color fallbacks, parallel MCP connect, prune on save. Commit `aa45f68`.
- ⏳ Allow `x-apple.systempreferences:` in the opener scope so Setup can open the Apple Intelligence pane directly.

## Notes
- Test leftover to clean: `~/.fm/sessions/hello-friend.json` was created by Claude while testing `fm chat`.
