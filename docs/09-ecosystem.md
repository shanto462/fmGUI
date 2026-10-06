# Ecosystem: other GUIs, servers and proxies

Other people's projects around Apple's on-device model. **None of these were installed or tested on this Mac.** Descriptions come from the project pages and from web research (October 2026), so treat them as unverified. Many of them use the Swift Foundation Models framework directly and do not need the `fm` CLI.

## Chat apps and GUIs

- **apfel-gui** (Arthur-Ficial): SwiftUI debug GUI for apfel with request timeline, MCP view and speech controls. https://github.com/Arthur-Ficial/apfel-gui
- **apfel-chat** (Arthur-Ficial): macOS chat app with streaming Markdown, speech and Vision image analysis. Part of the apfel project. https://github.com/Arthur-Ficial/apfel
- **apfel-clip** (Arthur-Ficial): menu bar tool for clipboard actions (summarize, translate, rewrite). Part of the apfel project. https://github.com/Arthur-Ficial/apfel
- **FoundationStudio** (nedpark): native macOS chat app (SwiftUI, SwiftData) styled like an "AI studio" workspace. https://github.com/nedpark/FoundationStudio
- **PrivateChat** (phimage): SwiftUI chat app for Foundation Models that can load MCP tools from a Claude Desktop config. https://github.com/phimage/PrivateChat
- **FoundationChat** (Dimillian): SwiftUI chat app with saved conversations, built on Foundation Models. https://github.com/Dimillian/FoundationChat
- **AFM-Studio** (Techopolis): chat app for iOS and macOS that mixes on-device and cloud models through the Foundation Models framework. https://github.com/Techopolis/AFM-Studio
- **afm-chat** (hgiefers): macOS chat app that only uses the on-device model, no cloud keys. https://github.com/hgiefers/afm-chat
- **foundation** (katspaugh): minimal macOS app and CLI to play with the on-device model. https://github.com/katspaugh/foundation
- **chat-ui-swift**: SwiftUI chat UI for on-device models (URL not checked).
- **Raycast extensions**: several Raycast extensions call the on-device model or `fm` (URLs not checked).

## Servers and proxies

- **apfel** (Arthur-Ficial): CLI plus OpenAI-compatible server for the on-device model, installable with Homebrew. Existed before `fm serve`. https://github.com/Arthur-Ficial/apfel
- **afm-Server** (Techopolis): server that exposes Apple Foundation Models over an HTTP API. https://github.com/Techopolis/afm-Server
- **fmToOpenAI** (Subhajit-Roy-Partho): proxy in front of the model that turns tool markers in the text into OpenAI `tool_calls`. A possible fix for the missing tool calls in `fm serve`. https://github.com/Subhajit-Roy-Partho/fmToOpenAI
- **fm-server-go** (k-velorum): a server for the on-device model written in Go. https://github.com/k-velorum/fm-server-go
- **apple-fm-serve**: another wrapper that serves the model over HTTP (URL not checked).
- **fm-access-PCC** (tariqwest): TypeScript library and OpenAI-style server that wraps `/usr/bin/fm`. It starts `fm serve` inside a Terminal window, because PCC is reported to unlock only for a Terminal-hosted server. https://github.com/tariqwest/fm-access-PCC

## Agents and coding tools

- **pifm** (schnaitter): provider extension for the pi coding agent that routes to `fm serve`, starting it when needed and stopping it on exit. https://github.com/schnaitter/pifm
- **pi-apple-fm** (adstastic): pi provider that lists `apple-fm/system` and `apple-fm/pcc` models through `fm serve`. https://github.com/adstastic/pi-apple-fm

## Testing and auditing

- **apple-fm-audit** (awesomeroy-cloud): reverse proxy in front of `fm serve` that records requests and responses in SQLite and shows them in a local web page. https://github.com/awesomeroy-cloud/apple-fm-audit

## How this project differs

The fmGUI app in this repository is a GUI for the **`fm` CLI** itself: it shows the exact `fm` command for every action, uses `fm serve` over a private Unix socket, and adds tools, MCP and skills with a guided-JSON router (see [Tools](06-tools.md)).
