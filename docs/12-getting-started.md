# Getting started with fmGUI

This guide takes you from a fresh install to your first chat with a tool. It takes about five minutes once the model
is downloaded.

## Before you start

You need:

- A Mac with Apple silicon (M1 or later) and macOS 27 or later.
- Apple Intelligence turned on in **System Settings → Apple Intelligence & Siri**.
- The on-device model downloaded. macOS downloads it (about 7 GB) after you turn on Apple Intelligence.

You can check the model in Terminal:

```sh
fm available
```

When it is ready, it prints `System model available`.

## Step 1: Install and open fmGUI

1. Download the DMG from the [Releases page](https://github.com/shanto462/fmGUI/releases), open it and drag
   **fmGUI** to **Applications**. To build it yourself instead, follow "Build from source" in the project README.
2. The app is not notarized yet, so macOS blocks the first start. Right-click **fmGUI** and choose **Open**. If macOS
   still blocks it, open **System Settings → Privacy & Security** and click **Open Anyway**. You can also run this in
   Terminal:

   ```sh
   xattr -dr com.apple.quarantine /Applications/fmGUI.app
   ```

3. Open fmGUI. If `fm`, the model and the license are already fine, setup finishes by itself and you land on
   **Overview** ("Everything is ready."). Otherwise the **Setup Guide** opens on the first check that fails.

## Step 2: Follow the Setup Guide

The Setup Guide has seven steps. Each step checks one thing and tells you how to fix it. It opens on the first step
that fails (or on **Done** when everything passes), so you only see what needs your attention. While `fm`, the model
or the license fails, the other pages show a lock. **Setup Guide**, **Docs** and **Settings** always stay open. To walk
through every step from the start, use **Run setup again** in Settings or on the Overview page.

| Step | What it checks | What you do |
|------|----------------|-------------|
| Welcome | Nothing yet | Click **Get started**. |
| fm tool | That `/usr/bin/fm` exists | Nothing, normally. If you use another `fm`, enter its path. |
| Model | `fm available` | If the model is not ready, turn on Apple Intelligence and wait for the download. Click **Check again**. |
| License | `fm license --status` | Read the terms, then run `sudo fm license` in Terminal and answer `y`. Click **Check again**. |
| Engine | The private chat engine | Click **Start engine**, then **Say hello** to test the model. |
| Extras | Nothing (optional) | Add a tool, an MCP server or a skill now, or later. |
| Done | All of the above | Click **Finish and start a chat** or **Finish setup**. |

fmGUI never accepts the license for you. Accepting it is your choice, and `sudo` asks for your password in Terminal,
not in fmGUI. The agreement is for the whole Mac, so you only do it once.

If a check fails later (for example after a macOS update asks you to accept new terms), the open page sends you back to
the Setup Guide.

## Step 3: Your first chat

1. Open **Chat** in the sidebar. Click the new chat button (or press ⌘N).
2. Pick one of the suggestions, or type your own message, for example:

   > What is 1234.5 × 987.25?

3. The model decides that it needs the `calculator` tool. A small card shows the tool, its arguments and the result.
   Then the answer streams in.

Try these too:

| Message | Tool it uses |
|---------|--------------|
| What time is it? | `get_current_datetime` |
| Summarize https://www.apple.com/newsroom/ | `fetch_url` (asks for your approval first) |
| Find PDF files about invoices on my Mac | `spotlight_search` |
| Write a short poem about autumn | None. Writing does not need a tool. |

### Approvals

Some tools ask before they run. The chat shows what the model wants to do and waits for you:

- **Allow once**: run it this time.
- **Always allow**: run it now, and do not ask again for this tool (for an MCP server: for every tool of that server).
- **Deny**: do not run it. The model is told that you said no.

You can change the approval of every tool later on the **Tools** and **MCP Servers** pages.

### Useful buttons in a chat

- **Instructions**: change the system prompt of this chat only. New chats use the default from
  **Settings → Chat defaults**.
- **Tools**: choose which tools the model can use, or turn tools off for all chats.
- **Attach images**: add pictures to your message (or paste them). The model can describe them. Each image costs
  tokens, so fmGUI only sends the images of your last two messages again.
- **Stop**: stop the answer at any time.
- The **context** meter in the chat header shows how much of the model's memory the chat uses. It appears after the
  first answer.

## The small context window

The on-device model sees about 8,192 tokens at once (some Macs report 4,096). That is a few pages of text. It holds
the instructions, the list of tools, your chat so far, tool results and the answer.

- Every enabled tool, MCP tool and always-on skill uses part of it in every message. Turn on only what you need.
- When a chat gets long, fmGUI leaves out the oldest messages. If it is still too long, start a new chat.
- If your Mac reports a different size, set it in **Settings → fm tool and model → Context size**.

## What else is in the app

| Page | What it is for |
|------|----------------|
| Overview | The status of `fm`, the model, the license and the engine. |
| CLI Sessions | Chats saved by `fm chat` in `~/.fm/sessions`. Read, rename, delete and continue them. |
| Playground | Every `fm respond` option, with the exact command shown. |
| Schema Builder | Build a JSON schema with `fm schema object` and get structured output. |
| Token Counter | Count tokens with `fm count-tokens`. |
| Tools | Built-in tools and your own tools. See [Custom tools](13-custom-tools.md). |
| MCP Servers | Add tool servers. See [MCP servers](14-mcp-servers.md). |
| Skills | Reusable instructions. See [Skills](15-skills.md). |
| API Server | Run `fm serve` for other apps (default `127.0.0.1:1976`). |
| Docs | These pages, plus everything about `fm` itself. |

## Where fmGUI keeps your data

Everything stays on your Mac, in `~/Library/Application Support/io.shanto.fmgui`:

| Path | What it holds |
|------|---------------|
| `config.json` | All settings, custom tools and MCP servers. |
| `chats/` | One JSON file per chat. |
| `skills/` | One folder per skill, each with a `SKILL.md`. |
| `tmp/` | Short-lived files, for example pasted images. |
| `engine.sock` | The socket of the private chat engine. |

CLI sessions stay in `~/.fm/sessions`, shared with `fm chat`. **Settings → Data** shows these folders and can open them
in Finder.

## Next steps

- [Custom tools](13-custom-tools.md): let the model run a command, call a web API or run a Shortcut.
- [MCP servers](14-mcp-servers.md): add ready-made tool servers.
- [Skills](15-skills.md): teach the model how you want a task done.
- [Limits and gotchas](07-limits-and-gotchas.md): what the on-device model can and cannot do.
