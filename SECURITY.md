# Security policy

## Supported versions

Only the latest release of fmGUI gets security fixes.

| Version | Supported |
|---------|-----------|
| 0.1.x | Yes |

## Report a vulnerability

Please report security problems **privately**. Do not open a public issue, pull request or discussion.

1. Open the [Security tab](https://github.com/shanto462/fmGUI/security) of the repository.
2. Click **Report a vulnerability** (or go straight to
   [the private report form](https://github.com/shanto462/fmGUI/security/advisories/new)).
3. Describe the problem: the fmGUI version, your macOS version, the steps to reproduce it, and what an attacker could
   do with it.

The maintainer aims to answer within 7 days, to agree on a fix and a date, and to credit you in the advisory if you
want. Please give us a reasonable time to fix the problem before you talk about it in public.

## Threat model

fmGUI lets a small language model call tools on your Mac. The model's output is **not trusted**: it picks the tools
and writes the arguments, and text the model reads (a web page, a file, a tool result) can contain instructions that
try to trick it (prompt injection). The design keeps you in control of anything that can do harm.

**Tools that can change things are opt-in and ask first.**

- `run_shell_command`, `write_file`, `run_shortcut`, `read_clipboard` and `open_url` are off by default and ask for
  approval before every call. `fetch_url` is on but also asks every time.
- New MCP servers and new custom tools start with **Ask every time** (a few read-only tool templates, such as Disk
  space, start with Always allow). The approval card shows the tool and its arguments before anything runs.
  "Always allow" is your explicit choice, per tool (or per MCP server).
- Denied calls are not run. The model is only told that you said no.

**File tools are limited to the folders you allow.**

- `read_file`, `list_directory` and `write_file` only work inside the folders in **Settings → Allowed folders**. With
  no folder allowed, they refuse every path.
- Paths are checked after `~` expansion and after following symlinks, so `..` and links cannot escape an allowed
  folder.

**Model arguments are never pasted into a command.**

- Custom shell tools get arguments as `FM_ARG_<NAME>` environment variables and as JSON on stdin. The command text
  is exactly what you wrote. (A command that runs `eval "$FM_ARG_X"` gives that safety away, so do not do that.)
- HTTP tools URL-encode arguments in the URL and JSON-escape them in JSON bodies. Only `http` and `https` URLs are
  allowed.

**The chat engine is local only.**

- Chat uses a private `fm serve` on a Unix socket in the app's data folder (or a short path in your temp folder when
  that path is too long). No network port is opened.
- The webview never talks to `fm serve` directly. All requests go through the Rust backend.
- The optional API Server page starts a second `fm serve` for other apps. It is off by default and listens on
  `127.0.0.1` (this Mac only). `fm serve` has no login, so if you change the host to `0.0.0.0`, anyone on your
  network can use your model while it runs.

**Other things to know**

- MCP servers and custom tools run as your user, with your login shell environment and your permissions. Only add
  servers and commands you trust.
- Settings, including custom tool headers and MCP environment variables, are saved in plain text in
  `~/Library/Application Support/io.shanto.fmgui/config.json`, not in the Keychain.
- Model answers are rendered as Markdown and cleaned with DOMPurify before they are shown.
- Release builds are not notarized yet. Download fmGUI only from this repository's Releases page.

## Out of scope

- Bugs in Apple's `fm` tool or the on-device model itself. Report those to Apple.
- The behavior of third-party MCP servers, Shortcuts or web services you connect.
- Attacks that need an already compromised Mac or user account.
- A tool doing what you approved it to do.
