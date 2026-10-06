# Changelog

All notable changes to fmGUI are listed in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-06

The first public release.

### Added

- **Setup Guide** in seven steps: finds `fm`, checks the model and the license (`sudo fm license` stays your own
  action in Terminal), starts the chat engine, and tests the model. Other pages stay locked until everything is ready.
- **Overview** page with the status of `fm`, the model, the license and the chat engine.
- **Chat** with the on-device model: streaming Markdown answers, images, per-chat instructions, a Stop button, a
  context meter, and chats saved on your Mac.
- A **private chat engine**: its own `fm serve` on a Unix socket, with no network port.
- A **guided-JSON tool router**, because `fm serve` on macOS 27.0.1 never returns `tool_calls`. It asks the model for
  one choice per tool at temperature 0, runs the tool, and streams the final answer as plain text.
- **Approvals** for tools: Allow once, Always allow, or Deny.
- **Quick Chat**: a frameless, always-on-top Liquid Glass overlay, opened from the sidebar (the main window minimizes)
  or from a simple chat bubble icon in the menu bar that only shows while the main window is minimized or closed.
  Clicking outside shrinks it to a picture-in-picture pill; clicking the pill grows it back; closing it starts an
  empty chat next time. Quick chats are saved in the Chat list, and **Open in fmGUI** continues them in the main window.
- Closing the main window keeps fmGUI running in the menu bar; the Dock icon brings it back.
- **Release workflow**: pushes to `master` that pass CI build the app and publish a GitHub Release (DMG, zipped app,
  checksums) with an automatic patch version; `npm run version:set` and `npm run version:next` manage versions.
- **Single instance** and **clean processes**: a second launch focuses the running app; every `fm serve` and MCP
  server is stopped on quit (also on SIGTERM), and leftovers from a crash are stopped at the next launch.
- **11 built-in tools**: `get_current_datetime`, `calculator`, `fetch_url`, `spotlight_search`, `read_file`,
  `list_directory`, `write_file`, `run_shell_command`, `read_clipboard`, `open_url`, `run_shortcut`. File tools only
  work in the folders you allow.
- **Custom tools** with a step by step wizard: shell commands (arguments as `FM_ARG_<NAME>` variables and JSON on
  stdin), HTTP requests (`{{param}}` placeholders) and Apple Shortcuts, with templates and a test step.
- An **MCP client** for stdio and Streamable HTTP servers, with a wizard, templates (Filesystem, Fetch, Memory, Time,
  Git, Sequential thinking, Everything), per-tool switches and a context cost meter. Servers start with your login
  shell PATH, so `npx` and `uvx` work when the app is opened from Finder.
- **Skills** (`SKILL.md`) with three modes (off, on demand, always), a `use_skill` tool for on-demand loading,
  templates, and import from `~/.claude/skills` and `~/.agents/skills`.
- A **context budget** for the 8,192-token window: trims the oldest messages, cuts long tool results, and retries when
  the chat is too long. The context size can be changed in Settings.
- **CLI Sessions**: browse, rename, delete and continue the chats that `fm chat` saves in `~/.fm/sessions`.
- **Playground** for every `fm respond` option, **Schema Builder** for `fm schema object`, and **Token Counter** for
  `fm count-tokens`. Each shows the exact `fm` command it runs.
- **API Server** page to start and watch a local `fm serve` (default `127.0.0.1:1976`) for other apps, with request
  examples.
- **Docs** inside the app: everything about `fm` we tested on macOS 27.0.1, plus user guides for getting started,
  custom tools, MCP servers and skills.
- **Settings** for the `fm` path, context size, chat defaults, allowed folders and data folders.
- A modern macOS look: sidebar vibrancy, inset traffic lights, system font and accent color, light and dark mode.
- Browser **mock mode** (`?mock=1`) for UI work without Rust or `fm`.
- CI on GitHub Actions, issue and pull request templates, and Dependabot.

[Unreleased]: https://github.com/shanto462/fmGUI/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/shanto462/fmGUI/releases/tag/v0.1.0
