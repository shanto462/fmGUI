# fmGUI architecture

fmGUI is a Tauri 2 desktop app (Rust backend + React/TypeScript UI) for Apple's `fm` CLI on macOS 27.
See `decisions.md` for why things are the way they are, and `progress.md` for status.

## Layout

```
src-tauri/src/
  lib.rs            app setup, command registration          (lead)
  state.rs          AppState, Paths                          (lead, contract)
  config.rs         AppConfig and all config types           (lead, contract)
  util.rs           strip_ansi, truncate, login_env, ids     (lead, contract)
  app_commands.rs   config, paths, temp files, which_command (lead)
  fm/               runs the fm CLI directly                 (agent "cli")
    mod.rs          run_streaming / run_collect, RunRegistry
    status.rs       fm available, fm license --status, macOS version
    transcript.rs   transcript JSON parser
    sessions.rs     ~/.fm/sessions
    public_server.rs  user-facing `fm serve` (Server page)
    commands.rs     tauri commands for the above
  engine/           agent chat with tools                    (agent "engine")
    fm_client.rs    HTTP/1.1 over the Unix socket of a private `fm serve`
    schema.rs       JSON Schema → fm-compatible schema sanitizer
    router.rs       guided-JSON tool router + agent loop
    tools.rs        built-in tools, custom tools (shell/http/shortcut), tool catalog
    chats.rs        chat storage (<data>/chats/<id>.json)
    commands.rs     tauri commands
  mcp/              MCP client (stdio + Streamable HTTP)     (agent "mcp")
  skills/           SKILL.md skills                          (agent "mcp")

src/
  App.tsx                 shell, sidebar, routing             (lead)
  main.tsx                entry                               (lead)
  lib/types.ts            TS mirror of Rust types             (lead, contract)
  lib/api.ts              typed invoke() wrappers             (lead, contract)
  lib/fmArgs.ts           fm argument builders                (lead, contract)
  lib/store.ts            zustand store: route, config, status, toasts, handoff (lead, contract)
  components/ui.tsx       shared UI primitives                (lead, contract)
  components/Markdown.tsx Markdown renderer                   (lead, contract)
  styles/tokens.css       design tokens                       (lead, contract)
  styles/base.css         shared component classes            (lead, contract)
  views/*View.tsx         one file per page                   (view agents)
docs/                     collected fm documentation, shown in the Docs page (agent "docs")
```

## Rules for agents

1. **Only edit files you own.** Contract files are read-only for agents. If you need a contract change
   (a new field, a new command), do not make it: describe it in your final report.
2. You may create **new** files inside your own folder (e.g. `src/views/chat/*.tsx`, `src/views/ChatView.css`,
   `src-tauri/src/engine/foo.rs`). Register new Rust submodules in your own `mod.rs`.
3. Keep the signatures marked `CONTRACT` exactly. You may add private fields, private functions and new
   public helpers.
4. Rust errors returned to the UI are plain `String`s written for humans (simple English).
5. Never put real personal data in code, tests or fixtures. Use placeholders (Ada Lovelace, ada@example.com).
6. User-facing text: simple English, short sentences, **no em dashes**.
7. Do not commit, do not run `git`.

## Building and testing

- Rust toolchain: `export PATH="$(brew --prefix rustup)/bin:$PATH"`.
- Frontend: `npm run typecheck` (tsc), `npm run build` (vite), `npm test` (vitest).
- Rust: `cd src-tauri && cargo build && cargo test`.
- Run the app: `npm run tauri dev`.
- Rust agents work in a private copy (see their task) so a half-finished module never breaks another
  agent's build. They copy only their own files back at the end.

## The fm facts that shape the design (tested on macOS 27.0.1)

- `fm serve` streams by default (send `"stream": false` for one JSON reply). Images only as data URLs.
  `response_format: json_schema` works; `json_object`, `stop`, `reasoning_effort` are rejected (400).
- `fm serve` never returns `tool_calls`. `tool_choice: "required"` gives HTTP 500. Tool results sent back with
  role `tool` + `tool_call_id` are understood. So the engine routes tools itself with guided JSON:
  one `anyOf` branch per tool, keyed by tool name (`{"lookup_order": {"order_id": "A-7781"}}`), plus
  `{"answer": "..."}`. Hand-written schemas need `title`, `additionalProperties: false` and `x-order`.
- Context window 8,192 tokens on this Mac (some Macs: 4,096). Overflow error:
  "The session's transcript exceeded the model's context size."
- `fm` colors stderr even when piped and ignores `NO_COLOR`; strip ANSI. Exit 69 = license not agreed.
- `count-tokens --image` fails with ModelManagerError 1001 (bug in 27.0.1).
- Transcripts: `{"modelName","transcript":{"type":"FoundationModels.Transcript","version":"1.1","transcript":{"entries":[...]}}}`,
  roles `instructions` / `user` / `response`, contents `{type:"text",text}` or `{type:"image",image:"data:image/jpeg;base64,..."}`.
