# Decisions

A log of what was asked and every decision taken, by the user or by Claude. Newest last.
Format: date · who · decision · why.

## What the user asked (in order)

1. 2026-10-06 · "Check macOS 27 `fm`, research about it, collect all documentation and build a GUI for it."
2. 2026-10-06 · "I need support for custom tools, MCP, skills or whatever can be possible, with step by step setup + modern macOS app design."
3. 2026-10-06 · "Electron app." Then right after: "Not Electron, something of Rust?"
4. 2026-10-06 · "Keep decisions.md, progress.md (pending, in progress), things I asked, decisions any taken by me or you."
5. 2026-10-06 · "Delegate to agents, do work as much as possible."

## Decisions

| # | Date | Who | Decision | Why |
|---|------|-----|----------|-----|
| D1 | 2026-10-06 | Claude | "fm" means `/usr/bin/fm`, the Apple Foundation Models CLI that ships with macOS 27. | Found on this Mac (macOS 27.0.1, build 26A434), man page dated 2026-06-08. |
| D2 | 2026-10-06 | Claude | Started with a native SwiftUI app. **Dropped** after the user asked for Electron. | User request #3. No Swift files kept. |
| D3 | 2026-10-06 | User | Stack is **Tauri 2 (Rust backend + React/TypeScript UI)**. Not Electron, not SwiftUI. | User asked for "something of Rust" and picked Tauri when asked. Small app size, low memory. |
| D4 | 2026-10-06 | Claude | Installed Rust with Homebrew `rustup` (keg-only). Use `export PATH="$(brew --prefix rustup)/bin:$PATH"`. | Rust was not installed; Tauri needs it. Homebrew is the trusted source already on this Mac. |
| D5 | 2026-10-06 | Claude | Do **not** rely on native `tools` / `tool_calls` from `fm serve`. Build our own tool router with guided JSON (`response_format: json_schema`, `anyOf` branches, one branch per tool keyed by tool name, plus an `answer` branch). | Tested on 27.0.1: `fm serve` never returns `tool_calls`; the model fakes results or prints arguments as text. `tool_choice: "required"` returns HTTP 500. The key-based router picked the right action 5/5 times in a test. Web research agrees: tools are "accepted but silently ignored" on 27.0. |
| D6 | 2026-10-06 | Claude | The agent engine talks to a private `fm serve --socket` instance owned by the app (Unix socket in the app data folder). A second, optional, user-facing `fm serve` (TCP) is managed from the Server page. | Socket is private (file permissions), no open port. Chat Completions API gives multi-turn history, images (data URLs), and guided JSON. |
| D7 | 2026-10-06 | Claude | MCP: write our own small MCP client in Rust (JSON-RPC 2.0 over stdio + Streamable HTTP), tools only for v1. | Small surface, no SDK API churn. Tools are what the agent needs. |
| D8 | 2026-10-06 | Claude | Skills: folders with `SKILL.md` (YAML front matter `name`, `description`). Two modes per skill: **always on** (body added to instructions) or **on demand** (model calls a `use_skill` tool, body is loaded then). Can import from `~/.claude/skills`. | Same idea as Claude Skills. On-demand keeps the small 8K context free. |
| D9 | 2026-10-06 | Claude | Custom tools v1 kinds: **shell command** (arguments passed as env vars `FM_ARG_<NAME>` and JSON on stdin, never string-spliced into the command) and **HTTP request** (URL/body templates). Every tool has an approval policy: ask every time / always allow. | Safe by default; no shell injection from model output. |
| D10 | 2026-10-06 | Claude | GUI apps launched from Finder get a minimal PATH, so the backend loads the login shell PATH once (`$SHELL -ilc`) before starting MCP servers (needed for `npx`, `uvx`, `node`). | Common GUI-app gotcha. |
| D11 | 2026-10-06 | Claude | Context budget: read the real size, do not hard-code. On this Mac the `fm chat` status bar shows **8,192** tokens. Trim old history and truncate long tool results to stay inside it. | Research reports 4,096 on some Macs. Error text when over: "The session's transcript exceeded the model's context size." |
| D12 | 2026-10-06 | Claude | CLI chat sessions stay in `~/.fm/sessions/*.json` (shared with `fm chat`). The GUI can browse, rename, delete and continue them with `fm respond --resume <file> --save-transcript <file>`. Agent chats (with tools) are stored by the app separately, because the CLI transcript format cannot hold our tool steps. | Keep CLI compatibility where it is possible. |
| D13 | 2026-10-06 | Claude | Every CLI action in the GUI shows the exact `fm ...` command it runs, with a copy button. | Users learn the CLI from the GUI; easy to reproduce bugs. |
| D14 | 2026-10-06 | Claude | The GUI never accepts the license for the user. The setup wizard shows the terms and the `sudo fm license` command to run in Terminal, then re-checks. | Accepting terms is the user's own action. |
| D15 | 2026-10-06 | Claude | Work split: Claude writes the skeleton and the shared contract (IPC types, design system), then parallel agents each own separate files (Rust CLI layer, agent engine + tools, MCP + skills, UI views, docs). | User request #5. File ownership avoids edit conflicts in one folder. |
| D16 | 2026-10-06 | Claude | Modern macOS look: transparent title bar with inset traffic lights, sidebar vibrancy (`windowEffects: sidebar`), SF system font, system accent color, automatic light/dark mode. | User request #2. |
