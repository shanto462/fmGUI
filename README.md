# fmGUI

A modern macOS app for **`fm`**, the Apple Foundation Models command-line tool that ships with macOS 27.
It runs Apple's on-device language model, with no cloud and no API key, and adds:

- **Chat** with the on-device model, with **tools**, **MCP servers** and **skills**.
- **CLI Sessions**: browse and continue the chats saved by `fm chat` in `~/.fm/sessions`.
- **Playground** for every `fm respond` option (images, OCR/barcode tools, schemas, transcripts).
- **Schema Builder** for `fm schema object` (structured JSON output).
- **Token Counter** for `fm count-tokens`.
- **API Server**: start and watch `fm serve` (OpenAI-style Chat Completions) for other apps.
- **Docs**: everything we found and tested about `fm`, inside the app (also in [`docs/`](docs/README.md)).
- A **setup guide** that walks you through the license, Apple Intelligence, and the extras.

Every CLI action shows the exact `fm ...` command it runs, so you can copy it into Terminal.

## Requirements

- macOS 27 on Apple Silicon, with Apple Intelligence turned on (the model download is about 7 GB).
- Agree to the `fm` license once, in Terminal: `sudo fm license`. fmGUI never accepts it for you.
- To build: Node.js 22+, Rust (stable), Xcode Command Line Tools.

## Build and run

```bash
npm install
npm run tauri dev
```

Release build (creates `fmGUI.app` and a `.dmg` in `src-tauri/target/release/bundle/`):

```bash
npm run tauri build
```

Checks:

```bash
npm run typecheck && npm test
cd src-tauri && cargo test
FM_INTEGRATION=1 cargo test   # also runs tests against the real fm
```

UI preview with fake data in a normal browser (no Rust needed): `npm run dev`, then open
<http://localhost:1420/?mock=1>.

## How tools work

`fm serve` on macOS 27.0.1 accepts `tools` but never returns `tool_calls`. fmGUI routes tools itself:
it asks the model for guided JSON with one choice per tool (`{"calculator": {"expression": "2+2"}}`)
or a final answer (`{"answer": "..."}`), runs the tool, and sends the result back. See
[`decisions.md`](decisions.md) (D5) and [`docs/06-tools.md`](docs/06-tools.md).

Tool kinds:

| Kind | Example |
|------|---------|
| Built-in | date and time, calculator, fetch a web page, Spotlight search, files in allowed folders |
| Shell command | `pmset -g batt` (arguments arrive as `FM_ARG_<NAME>` env vars, never spliced into the command) |
| HTTP request | `GET https://wttr.in/{{city}}?format=3` |
| Apple Shortcut | any Shortcut from the Shortcuts app |
| MCP | any MCP server over stdio (`npx`, `uvx`, ...) or Streamable HTTP |
| Skill | `SKILL.md` instructions, always on or loaded on demand |

Tools that can change things ask for your approval first.

## Project files

- [`ARCHITECTURE.md`](ARCHITECTURE.md): code layout and module ownership.
- [`decisions.md`](decisions.md): every request and decision, with reasons.
- [`progress.md`](progress.md): what is done, in progress, and pending.

## Limits to know

- Context window: 8,192 tokens on the test Mac (some Macs report 4,096). Every enabled tool and skill uses part of it.
- The on-device model is good at summaries, extraction, tagging and rewriting. It is weak at facts, math and code
  (use the calculator tool for math).
- `fm count-tokens --image` fails on macOS 27.0.1 (ModelManagerError 1001).
