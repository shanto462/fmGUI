# Contributing to fmGUI

Thank you for helping. Bug reports, ideas, docs fixes and code are all welcome.

- **Bugs and ideas**: open an issue with the bug report or feature request form.
- **Security problems**: do not open a public issue. See [SECURITY.md](SECURITY.md).
- **Code**: for anything bigger than a small fix, open an issue first so we can agree on the approach.

Everyone who takes part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

You need:

- macOS on Apple silicon. To run the app and the integration tests you need **macOS 27** with Apple Intelligence on,
  the model downloaded, and `sudo fm license` done once.
- **Node.js 22 or later**.
- **Rust stable** through [rustup](https://rustup.rs), with `rustfmt` and `clippy`. With Homebrew:
  `brew install rustup`, `rustup default stable`, and `export PATH="$(brew --prefix rustup)/bin:$PATH"` (Homebrew's
  rustup is keg-only).
- **Xcode Command Line Tools**: `xcode-select --install`.

```sh
git clone https://github.com/shanto462/fmGUI.git
cd fmGUI
npm install
npm run app
```

`npm run app` starts Vite and the Rust backend and reloads when you change the code.

**No macOS 27?** You can still work on the UI with mock mode (see below) and run the unit tests. The Rust crate is set
to target macOS 27 in `src-tauri/.cargo/config.toml`. On an older macOS, set `MACOSX_DEPLOYMENT_TARGET=14.0` in your
shell to build and test it, like CI does.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run app` | Runs the app in development mode. |
| `npm run app:build` | Builds `fmGUI.app` and a `.dmg` in `src-tauri/target/release/bundle/`. |
| `npm run dev` | Starts only the Vite dev server (port 1420). |
| `npm run preview:mock` | Opens the UI in your browser with fake data. |
| `npm run typecheck` | TypeScript check. |
| `npm test` / `npm run test:watch` | UI unit tests (Vitest). |
| `npm run test:rust` | Rust unit tests. |
| `npm run test:integration` | Rust tests plus the tests against the real `fm`. |
| `npm run lint` / `npm run lint:fix` | ESLint and `cargo clippy -D warnings` / ESLint with fixes. |
| `npm run format` / `npm run format:check` | Prettier and `cargo fmt` / check only. |
| `npm run verify` | Every CI check in one go (`scripts/verify.sh`). |

`scripts/release.sh` runs `verify`, builds the release and prints where the `.app` and `.dmg` are.

## Project layout

```text
src/                         React + TypeScript UI
  App.tsx                    app shell: sidebar, routes, locked pages
  main.tsx                   entry point; turns on mock mode with ?mock=... (dev only)
  lib/api.ts                 typed invoke() wrappers, one per Rust command
  lib/types.ts               TypeScript copies of the Rust types
  lib/store.ts               app state (zustand): route, config, fm status, toasts
  lib/fmArgs.ts              builds fm command arguments and the command preview
  lib/mock.ts, mockData.ts   fake backend for mock mode
  components/                shared UI parts (ui.tsx) and safe Markdown (Markdown.tsx)
  styles/                    design tokens and shared CSS classes
  views/<Name>View.tsx       one file per page; its parts live in views/<name>/
  quick/                     Quick Chat window (overlay and pill), reuses views/chat/
src-tauri/                   Rust backend (Tauri 2)
  src/lib.rs                 app setup, command registration, clean shutdown
  src/state.rs               AppState and Paths (the data folder layout)
  src/config.rs              AppConfig, saved as config.json
  src/util.rs                shared helpers: ANSI stripping, login shell env, token estimate
  src/app_commands.rs        config, paths and file commands
  src/quick.rs               menu bar icon and the Quick Chat window (overlay, pill, hide on close)
  src/procs.rs               stops leftover child processes from an earlier run (pid files, data dir match)
  src/fm/                    runs the fm CLI: status, respond, count-tokens, schema,
                             CLI sessions, transcripts, the public fm serve (API Server page)
  src/engine/                chat engine: private fm serve over a Unix socket (fm_client.rs),
                             guided-JSON tool router (router.rs, schema.rs), tool catalog (tools.rs),
                             built-in tools (builtin.rs), custom tools (custom.rs), chat files (chats.rs)
  src/mcp/                   MCP client: JSON-RPC over stdio and Streamable HTTP
  src/skills/                SKILL.md skills: load, save, import
docs/                        user docs; every docs/*.md is bundled into the in-app Docs page
scripts/                     verify.sh and release.sh
```

How a request flows: a page calls a wrapper in `src/lib/api.ts`, which calls `invoke()`. Tauri runs the matching
`#[tauri::command]` in Rust. Rust runs `/usr/bin/fm` or talks to the private `fm serve` over its Unix socket. Long
work streams back over a Tauri `Channel` (`fm_run`, `chat_send`) or an event (`mcp-status`, `config-changed`,
`public-server-log`, `chats-changed`, and for Quick Chat `quick-mode`, `quick-reset`, `open-chat`). The webview never talks to `fm serve` itself.

### Add a page

1. Create `src/views/FooView.tsx`. Put its parts and CSS in `src/views/foo/`.
2. Add `"foo"` to the `Route` type in `src/lib/store.ts`. If the page must work before setup is done, add it to
   `OPEN_ROUTES` too.
3. Add it to `VIEWS` and to a group in `NAV` in `src/App.tsx`.
4. If it needs the backend: add a `#[tauri::command]` in the right Rust module, register it in `generate_handler!` in
   `src-tauri/src/lib.rs`, add a typed wrapper in `src/lib/api.ts` and its types in `src/lib/types.ts`, and add a fake
   answer in `src/lib/mock.ts` so mock mode keeps working.

### Add a built-in tool

1. Add a variant to the `Builtin` enum in `src-tauri/src/engine/builtin.rs`.
2. Add a `BuiltinSpec` to `BUILTINS`: the model-facing name, title, a short description that says when to use it,
   parameters, timeout, `default_enabled`, `default_approval` and `dangerous`. Anything that changes files, runs
   programs or sends data should be off by default and use `Approval::Ask`.
3. Run it in `builtin::run`. Return `Err(String)` with a short, plain English message on failure.
4. Add unit tests in the same file.

The tool catalog, the Tools page, approvals and the router pick up the new tool on their own.

## Testing

Every change in behavior needs a test.

- **Rust unit tests** sit next to the code (`#[cfg(test)] mod tests`). Run them with `npm run test:rust`. They do not
  need `fm`. The MCP tests use small Python servers in `src-tauri/src/mcp/fixtures/` and are skipped when `python3` is
  missing.
- **Integration tests** run against the real `/usr/bin/fm` and the on-device model. They only run with
  `FM_INTEGRATION=1` (`npm run test:integration`), so they need macOS 27, the model and the license. They cannot run in
  CI. Run them before you send a change to the engine or the `fm` layer, and say so in the pull request.
  `FM_INTEGRATION_REPEAT=5` repeats every engine scenario and prints the success rate (useful for router changes).
  `MCP_NPX=1` also tests against the real `@modelcontextprotocol/server-everything`.
- **UI unit tests** are `*.test.ts` files under `src/` (Vitest). Run them with `npm test`.
- **Mock mode** runs the UI in a normal browser with a fake backend, so you can work on pages without Rust or `fm`:
  `npm run preview:mock`, or `npm run dev` and open <http://localhost:1420/?mock=1>. Other scenarios:
  `?mock=nolicense` (opens Setup on the License step), `?mock=nofm`, and `?mock=setup` (a fresh install whose checks
  pass, so setup completes by itself).

Debug aid: set `FMGUI_DUMP_REQUEST=/tmp/request.json` before `npm run app` to write the last request the engine sent
to `fm serve` into that file.

Before you open a pull request, run:

```sh
npm run verify
```

It runs the same checks as CI. Add `FM_INTEGRATION=1` when you changed the engine or the `fm` layer.

## Code style

- **Rust**: `cargo fmt` and `cargo clippy --all-targets -- -D warnings` must pass. Errors that reach the UI are plain
  `String`s written for people, for example "The working folder ~/Projects does not exist."
- **TypeScript**: ESLint and Prettier must pass (`npm run lint`, `npm run format`). Keep the types in `src/lib/types.ts`
  in sync with the Rust types.
- **UI text and docs**: simple English and short sentences, for users who are not native speakers. Give an example
  where it helps. Do not use em dashes; use a comma, a colon, a period or parentheses instead.
- **Show the command**: when the UI runs `fm`, show the exact command so people can copy it.
- **No personal data**: never put real names, emails, phone numbers, user names, home folder paths, tokens or keys in
  code, tests, fixtures or docs. Use placeholders such as `Ada Lovelace`, `ada@example.com` and `/Users/ada`.
- **Small context**: the model sees about 8,192 tokens. Keep tool descriptions, schemas and prompts short.

## Commits and pull requests

- Write commit messages in the imperative mood, with a short first line (under about 72 characters), for example
  `Add a timeout to HTTP tools` or `Fix the token count for skills with front matter`. Explain the why in the body
  when it is not obvious.
- Keep a pull request to one topic. Fill in the template.
- Add screenshots for UI changes (mock mode is fine for this).
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for changes users will notice.
- Update the docs in `docs/` when you change how something works.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

## Releasing

- `main` is for day-to-day work: every push and pull request runs CI (`.github/workflows/ci.yml`).
- `master` publishes: after CI passes on a push to `master`, `.github/workflows/release.yml` builds `fmGUI.app` and
  the DMG on macOS and creates a GitHub Release with generated notes. Docs-only pushes do not release. You can also
  run the Release workflow by hand from the Actions tab.
- The version is computed by `scripts/next-version.mjs` (patch + 1 from the newest `v*` tag, or the `package.json`
  version when it is newer). For a minor or major release, run `npm run version:set X.Y.Z` and commit the change.
- To debug a release build, build it with the Web Inspector: `npx tauri build --features diagnostics`, then start it
  with `FMGUI_DEVTOOLS=1 src-tauri/target/release/bundle/macos/fmGUI.app/Contents/MacOS/fmgui`.
