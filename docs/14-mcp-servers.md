# MCP servers

The Model Context Protocol (MCP) is an open standard for tool servers. One MCP server can add a whole set of tools at
once: files, Git, memory, web pages, and many more. fmGUI has its own small MCP client, so you can use these servers
with the on-device model.

fmGUI uses the **tools** of a server. Resources and prompts from MCP are not used.

## Two kinds of servers

| Kind | How it runs | Example |
|------|-------------|---------|
| **Command on this Mac** (stdio) | fmGUI starts the server as a program and talks to it over stdin and stdout. | `npx -y @modelcontextprotocol/server-memory` |
| **Remote URL** (Streamable HTTP) | fmGUI sends HTTP requests to a server on the web or on your network. | `https://example.com/mcp` |

Remote servers must use the **Streamable HTTP** transport (MCP version 2025-03-26 or later). The older HTTP + SSE
transport is not supported.

## What you need for most servers

Most ready-made servers start with `npx` (Node.js) or `uvx` (uv, for Python servers). They download the server
package the first time.

| Program | Install it with | Needed for |
|---------|-----------------|------------|
| Node.js and `npx` | `brew install node` | Filesystem, Memory, Sequential thinking, Everything |
| uv and `uvx` | `brew install uv` | Fetch, Time, Git |

Apps opened from Finder get a very short PATH. So fmGUI reads the PATH of your **login shell** once, when it starts
(it runs `$SHELL -ilc env`). If `npx` works in Terminal, it works in fmGUI. If you install Node.js or uv while fmGUI is
open, quit and reopen fmGUI.

## Add a server, step by step

Open **MCP Servers** in the sidebar and click **Add server**. The wizard has six steps.

### 1. Server

Pick a template, or **Custom command** for any stdio server, or **Remote server** for a URL.

| Template | Command | What it adds |
|----------|---------|--------------|
| Filesystem | `npx -y @modelcontextprotocol/server-filesystem <folder>` | Read, search and write files in one folder you choose. |
| Fetch web pages | `uvx mcp-server-fetch` | Download a web page as text the model can read. |
| Memory | `npx -y @modelcontextprotocol/server-memory` | A small knowledge graph, so the model can remember facts between chats. |
| Time | `uvx mcp-server-time` | Current time and time zone conversion. |
| Git | `uvx mcp-server-git --repository <folder>` | Read the history, status and diffs of one Git repository. |
| Sequential thinking | `npx -y @modelcontextprotocol/server-sequential-thinking` | Helps the model break a hard problem into steps. |
| Everything (test) | `npx -y @modelcontextprotocol/server-everything` | A demo server with many sample tools, to check that MCP works. |

### 2. Requirements

fmGUI checks that the programs the template needs (for example `npx`) are on your login shell PATH. If one is
missing, it shows the command to install it. Install it in Terminal, then click **Re-check**. You can continue
without it, but the server will not start until everything is installed.

### 3. Configure

For a **command on this Mac**:

- **Name**: shown in the app, for example `Filesystem`.
- **Folder**: for Filesystem and Git, choose the folder the server may use.
- **Command**: the program that starts the server, for example `npx` or `uvx`. A full path also works.
- **Arguments**: one per row. No quotes needed, even when a path has spaces.
- **Environment variables**: optional, for example an API key the server needs.
- **Working folder**: optional.

The wizard shows the full command fmGUI will run.

For a **remote URL**:

- **Server URL**: the Streamable HTTP endpoint, often ending in `/mcp`.
- **Headers**: optional. Many servers need a token, for example `Authorization: Bearer <token>`.

Environment variables and headers are saved in plain text in `config.json`.

### 4. Test

fmGUI starts the server, does the MCP handshake and lists its tools. If it fails, you see the error and the last
lines the server printed, which usually tell you what is wrong.

The first run of `npx -y` or `uvx` downloads the package. This can take up to a minute. fmGUI waits up to 60 seconds
for the server to start.

### 5. Tools

Turn on only the tools you need. This is the most important step for the on-device model:

- Every enabled tool adds its name, description and parameters to **every** request.
- The wizard shows the tokens of each tool, and how much of the context window all your tools and skills use together.
- At 25% it warns you, and at 50% it shows an error color. Then chats have little room left.

Some servers have many tools. For example, **Everything** has many sample tools, so turn on only one or two.

### 6. Save

Choose the approval for this server:

- **Ask every time** (recommended): the chat shows each call with its arguments and waits for **Allow once**,
  **Always allow** or **Deny**.
- **Always allow**: every tool of this server runs without asking.

Approval is set for the whole server, not per tool. If you click **Always allow** in a chat, it applies to every tool of
that server.

## Manage your servers

On the **MCP Servers** page each server shows its state (connecting, connected, error, off), and you can:

- Turn the server **on or off**. When it is off, it is not started and its tools are hidden.
- **Reconnect** it, for example after you installed a missing program.
- **Edit** it, including the per-tool switches and the approval.
- **Delete** it.
- Open the details to see its tools and their token cost.

Enabled servers start when fmGUI starts, all at the same time. When a server tells fmGUI that its tool list changed,
fmGUI lists the tools again.

## How MCP tools reach the model

- fmGUI gives every tool a unique name. If two servers both have a tool called `search`, the second one is shown to the
  model with the server name in front, for example `filesystem_search`.
- The on-device model only understands simple input schemas. fmGUI simplifies each tool's schema: it drops things
  like `pattern`, `format`, defaults and number limits, follows `$ref` a few levels deep, and turns very deep objects into plain
  text. Tools with simple inputs work best.
- A tool call is stopped after 60 seconds.
- The result text is cut to fit the context window.

## Troubleshooting

| Problem | What to do |
|---------|------------|
| "Command not found: npx" (or `uvx`) | Install Node.js (`brew install node`) or uv (`brew install uv`). Make sure the folder is on PATH in `~/.zprofile` or `~/.zshrc` (try `which npx` in a new Terminal window). Then quit and reopen fmGUI, or use the full path, for example `/opt/homebrew/bin/npx`. |
| The first start times out | `npx` or `uvx` may still be downloading. Wait a minute and click **Reconnect**. Running the same command once in Terminal also fills the cache. |
| "npm could not find this package" | Check the package name in the arguments. |
| "The download failed" | Check your internet connection. The first start needs the network. |
| The server stops right away | Open the details and read the last lines it printed. A wrong folder, a missing API key in the environment variables, or a missing program are the usual causes. |
| A remote server does not connect | Check the URL (often it ends in `/mcp`), the token header, and that the server supports Streamable HTTP. |
| Chats say they are too long | Turn off tools you do not need, on this page or in the chat's **Tools** window. |
| The model never uses a server's tool | Check that the tool is on, and that tools are on for chats. The on-device model is small, so a tool with a long, vague description or a complex schema is hard for it. A [custom tool](13-custom-tools.md) with a clear description can work better. |
