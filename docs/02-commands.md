# Command reference

All commands were run on macOS 27.0.1 (26A434). Outputs below are real unless marked "(unverified)".

## General behavior

- `fm` with no arguments prints the help and exits 0.
- `fm --help` or `fm -h` prints the help. `fm <command> --help` prints help for one command.
- There is no version flag. `fm --version` prints `Error: Unknown option '--version'` and exits 64.
- An unknown command prints `Error: Unknown command 'bogus'.` and exits 1.
- Errors go to **stderr** and contain ANSI color codes, even when piped. `NO_COLOR` is not honored. Strip codes with a regex such as `\x1b\[[0-9;]*m`.
- The model answer goes to **stdout**.
- `-m, --model` accepts only `system` on this build.

| Command | Purpose |
|---------|---------|
| [`available`](#fm-available) | Check if the model can be used |
| [`chat`](#fm-chat) | Interactive chat (terminal UI) |
| [`count-tokens`](#fm-count-tokens) | Count tokens |
| [`license`](#fm-license) | Show or accept the terms |
| [`respond`](#fm-respond) | One prompt, one answer |
| [`schema object`](#fm-schema-object) | Build a JSON schema |
| [`serve`](#fm-serve) | OpenAI-style HTTP server |

---

## fm available

Checks if the model is ready.

| Flag | Meaning |
|------|---------|
| `-m, --model <model>` | Model to check (`system`). If you leave it out, all models are checked. |
| `-h, --help` | Help. |

```sh
fm available
fm available --model system
```

```text
System model available
```

Exit code is 0 when available. An invalid model name exits 64:

```text
Error: The value 'pcc' is invalid for '-m <model>'. Please provide one of 'system'.
```

Other possible messages are listed in [Overview](01-overview.md#requirements).

---

## fm chat

Starts an interactive multi-turn chat. Sessions are saved automatically to `~/.fm/sessions/`.

| Flag | Meaning |
|------|---------|
| `-i, --instructions <text>` | Instructions (system prompt) for the model. |
| `-m, --model <model>` | Model to use (`system`). |
| `-r, --resume <name>` | Resume a saved session by name (file name without `.json`). |
| `--continue` | Resume the most recent session. |
| `--set-default-model <model>` | Save the default model in `~/.fm/config.json`. Must be used alone. |
| `--tool <name>` | Enable a built-in tool: `barcode` or `ocr`. Repeatable. |
| `-h, --help` | Help. |

```sh
fm chat
fm chat --instructions 'You are a helpful coding assistant'
fm chat --resume my-session
fm chat --continue
fm chat --tool ocr --tool barcode
```

Errors you can get:

```text
Error: Cannot specify both --continue and --resume.
Error: --set-default-model must be used on its own.
Error: Cannot specify both --resume and --instructions. The resumed session already contains its instructions.
Error: Invalid session name 'a/b'. Names must not be empty, '.', '..', or contain '/', '\\', or NULL.
Error: Session 'nope-nope' not found in ~/.fm/sessions/
Error: Unknown tool 'weather'. Known: barcode, ocr.
```

### The terminal UI

In a real terminal, `fm chat` opens a full-screen UI.

- The status bar shows the model, the turn, tokens in and out, and context use, for example: `system · turn 1 · ↑ 64 · ↓ 7 · 71 / 8,192 (0% used)`.
- Answers are rendered as Markdown. `fm chat` adds a hidden instruction that asks the model to format with Markdown headings, bold, inline code, fenced code blocks and bullet lists, and not to wrap the whole answer in a code fence.
- On exit it prints how to come back, for example: `Resume conversation with: fm chat --resume swift-concurrency`.
- The session name is made by the model. It asks the model for a short title of 2 to 4 lowercase words joined by hyphens (for example `recipe-suggestions`).

### Slash commands

| Command | What it does |
|---------|--------------|
| `/help` | List commands. |
| `/quit` (also `/q`, `/exit`) | Leave the chat. |
| `/clear` | Start a fresh conversation. |
| `/save [name]` | Save the session (optionally under a name). Prints `Session saved as '<name>'`. |
| `/resume <name>` | Load a saved session. |
| `/sessions` | List saved sessions. |
| `/model <name>` | Switch model (`system` only here). |
| `/instructions [text]` | Set instructions. Without text it opens a small editor (Enter saves, Esc cancels). Cannot be used while the model is answering. |
| `/tools [add\|remove <name>]` | List, add or remove built-in tools (`barcode`, `ocr`). |
| `/appearance [dark\|light\|auto]` | Color theme of the UI. |

### Keyboard shortcuts

| Keys | Action |
|------|--------|
| Enter | Send |
| `\` then Enter | New line inside the message |
| ↑ / ↓ | Message history |
| Ctrl+W | Delete the word before the cursor |
| Ctrl+U | Clear the line before the cursor |
| Ctrl+K | Clear the line after the cursor |
| Ctrl+C | Exit. The binary also has `[Cancelled.]` and `Press Ctrl+C again to exit.`, so the first press probably stops a running answer and a second press exits (unverified). |

The binary also has code for pasted text blocks, pasted images and file path completion (`tab/enter to use`). How to attach an image in the UI was not tested (unverified).

### Pipe mode (no terminal)

When stdin is **not** a terminal, `fm chat` does not open the UI. It runs a plain line mode: every input line is one user message. This was tested:

```sh
printf 'Reply with the word PINEAPPLE only.\n/help\n' | fm chat
```

Real output (prompts and answers run together, there are no clean line breaks):

```text
you>  fm> PINEAPPLEyou>  fm> 
PINEAPPLEyou> 

Resume conversation with: fm chat --resume pineapple
```

The saved session shows 2 user turns: `Reply with the word PINEAPPLE only.` and `/help`.

Watch out:

- Slash commands are **not** parsed in pipe mode. `/help` was sent to the model as a normal message.
- The session is still saved to `~/.fm/sessions/`.
- `fm chat --continue` inside a script will read the rest of the script's stdin as chat messages and append them to your last session. Use `</dev/null` or do not use `fm chat` in scripts. Use `fm respond --resume` instead.
- The binary also has the error `No terminal available. The TUI requires an interactive terminal.` for some no-terminal cases.

---

## fm count-tokens

Counts tokens with the on-device tokenizer. Only the `system` model.

| Flag | Meaning |
|------|---------|
| `<prompt>` | Text to count. If missing, the text is read from stdin when stdin is piped. |
| `--text <text>` | Extra text segment. Repeatable. |
| `--image <path>` | Image to include. Repeatable. **Broken on 27.0.1** (see below). |
| `-i, --instructions <text>` | Add instructions. This switches to a "framed" count. |
| `--transcript <file>` | Count a saved transcript as a framed conversation. |
| `-q, --quiet` | Print only the number. This is automatic when stdout is piped. |
| `-h, --help` | Help. |

Two kinds of count:

- **Raw**: a bare prompt is counted on its own.
- **Framed**: with `--instructions` or `--transcript`, `fm` counts what the model really receives, including the chat template markers. This is much larger.

Real results:

| Command | Output (piped) |
|---------|----------------|
| `fm count-tokens 'Hello world'` | `3` |
| `echo 'Hello world' \| fm count-tokens` | `3` |
| `fm count-tokens --text Hello --text world` | `4` |
| `fm count-tokens 'Hello world' --text again` | `5` |
| `fm count-tokens -i 'Answer concisely'` | `49` |
| `fm count-tokens -i 'Be brief' 'Hello world'` | `60` |
| `fm count-tokens --transcript chat.json` (instructions + 2 turns) | `79` |

In a terminal the output is `Token count: 3`.

Errors and bugs:

```text
Error: The --verbose option is not supported with the count-tokens command. Use --quiet for bare-integer output in scripts.
Error: The --schema option is not supported with the count-tokens command
Error: Cannot specify both a saved transcript and --instructions. The transcript already contains its instructions.
Error: Missing prompt. Provide a positional prompt, --text, or --image option.
```

- **Bug:** `--image` fails with `The operation couldn’t be completed. (ModelManagerServices.ModelManagerError error 1001.)`. A transcript that contains an image fails the same way.
- A transcript with tool calls prints `Warning: Transcript contains tool calls. Tool-call token contributions may be approximate.`
- **Hang risk:** `fm count-tokens -i 'text'` with no prompt reads stdin if stdin is not a terminal. If stdin is an open pipe that never closes (common when a GUI app spawns it), it waits forever. Pass `</dev/null` or close stdin.

---

## fm license

| Flag | Meaning |
|------|---------|
| (none) | Show the terms and ask you to agree. Needs a terminal and admin rights: `sudo fm license`. |
| `--show` | Print the terms without asking. |
| `--status` | Say if this Mac has agreed. |
| `-h, --help` | Help. |

```sh
fm license --status
```

```text
Agreed to license FM1 version 1.0 on 6 Oct, 2026 at 18:04.
```

When not agreed: `Not agreed. Run 'sudo fm license' to review and agree.` More in [License](10-license.md).

---

## fm respond

Sends one prompt and prints the answer.

| Flag | Meaning |
|------|---------|
| `<prompt>` | The prompt. Use `--` before a prompt that starts with `-`. |
| `-i, --instructions <text>` | Instructions (system prompt). |
| `-m, --model <model>` | Model (`system`). |
| `--text <text>` | A text segment of the prompt. |
| `--image <path>` | An image for the prompt. Repeatable. |
| `--label <name>` | Label for the matching `--image` (paired by order). Needs `--tool`. Default labels are `image_0`, `image_1`, ... |
| `--tool <name>` | Built-in tool: `ocr` or `barcode`. Repeatable. |
| `--schema <file or json>` | Structured output. A file path or an inline JSON string. See [Structured output](05-structured-output.md). |
| `--resume <file>` | Continue from a saved transcript file. |
| `--save-transcript <file>` | Save the transcript after the answer. A bare file name is saved in the current folder. |
| `--[no-]stream` | Stream output as it is made. Default: on, even when piped. |
| `-g, --greedy` | Greedy sampling. Same prompt gives the same answer. |
| `--use-case <case>` | `general` (default) or `content-tagging`. |
| `--guardrails <level>` | `default` or `permissive-content-transformations`. |
| `-v, --verbose` | Print extra info (see below). |
| `--show-assets` | Hidden flag. Print the model assets used, on stderr. |
| `-h, --help` | Help. |

### Where the prompt comes from

- A positional prompt, `--text`, or `--image` gives the prompt.
- If none of these is given, `fm` reads the prompt from stdin (when stdin is piped).
- If you give a positional prompt or `--text`, stdin is **ignored**, even if you pipe text in. To combine piped text with a question, put both in the prompt yourself, for example `fm respond "Summarize: $(cat notes.txt)"`.
- With no prompt at all: `Error: Missing prompt. Provide a positional prompt, --text, or --image option.`

### Examples (real output)

```sh
fm respond 'Say OK.'
```

```text
OK.
```

```sh
echo 'What is Swift?' | fm respond
fm respond -- '-5 plus 3 equals what? Answer with the number only.'
```

```text
-2
```

Greedy sampling gives the same answer every time:

```sh
fm respond -g 'Write one short sentence about the sea.'
fm respond -g 'Write one short sentence about the sea.'
```

```text
The sea is vast and full of mystery.
The sea is vast and full of mystery.
```

Content tagging:

```sh
fm respond --use-case content-tagging 'We hiked in the Alps with our dog last weekend.'
```

```text
Alps, hiking, dog, weekend, activity
```

Image input (the image shows "Order A-1234, Total: $42.50"):

```sh
fm respond --image invoice.png --text 'What is the order number and total?'
```

```text
The order number is A-1234 and the total is $42.50.
```

Structured output:

```sh
fm schema object --name Person --string name --integer age > person.schema.json
fm respond --schema person.schema.json 'Ada Lovelace is 36.'
```

```text
{"name": "Ada Lovelace", "age": 36}
```

Built-in tools:

```sh
fm respond --tool ocr --image invoice.png --label invoice 'What is the total on the invoice?'
fm respond --tool barcode --image qr.png 'What URL is in the QR code?'
```

```text
The total on the invoice is $42.50.
The URL in the QR code is: https://example.com/order/A-1234
```

Continue a conversation across runs:

```sh
fm respond -i 'Be brief.' 'Name one planet.' --save-transcript chat.json
fm respond --resume chat.json --save-transcript chat.json 'Name another one.'
```

```text
Earth
Mars
```

### Output streams

| Output | Stream |
|--------|--------|
| The answer | stdout |
| Errors (`Error: ...`) | stderr, colored |
| `Transcript saved to: <absolute path>` | stderr, colored |
| `Assets used:` list (`--show-assets`) | stderr |
| `Creating session with default instructions` or `Creating session with instructions: <text>` (`-v`) | **stdout**, colored. Printed after the answer when streaming, before it with `--no-stream`. |

Because `-v` writes to stdout, do not use `-v` when you parse the answer.

### Errors

```text
Error: Invalid guardrail 'permissive'. Valid guardrail levels are 'default' and 'permissive-content-transformations'.
Error: Invalid use case 'foo'. Valid use cases are 'general' and 'content-tagging'.
Error: Unable to load image at '/nonexistent.png'
Error: Unable to read transcript at '/nonexistent.json': The file “nonexistent.json” couldn’t be opened because there is no such file.
Error: Cannot specify both a saved transcript and --instructions. The transcript already contains its instructions.
Error: --label has no effect without an image-using tool. Enable --tool barcode or --tool ocr (or drop the --label flag).
Error: Received 2 --label value(s) for 1 --image value(s). Provide at most one --label per --image.
Error: Unknown tool 'weather'. Known: barcode, ocr.
Error: The session's transcript exceeded the model's context size.
```

The `--guardrails permissive-content-transformations` level is meant for tasks that transform text the user gives (rewrite, summarize) and may allow content that the default level blocks (exact effect unverified).

---

## fm schema object

Builds a JSON schema for structured output. Full guide: [Structured output](05-structured-output.md).

| Flag | Meaning |
|------|---------|
| `--name <name>` | Name (title) of the root object. Required. |
| `--string <name>` | String property. |
| `--integer <name>` (alias `--int`) | Integer property. |
| `--double <name>` (alias `--float`) | Number property. |
| `--boolean <name>` (alias `--bool`) | Boolean property. |
| `--object <name>` | Nested object property. Must be followed by `--schema`. |
| `--schema <json>` | A schema, after `--object` or `--anyOf`. |
| `--anyOf` | Build a union. Each following `--schema` is one choice. |
| `--array` | The property before it becomes an array. |
| `--optional` | The property before it is not required. |
| `--description <text>` | Description for the property before it. |

```sh
fm schema object --name Person --string name --integer age --description 'Age in years'
```

The help text shows `--nested` in an example. It does not work: `Error: SchemaError(errorDescription: Optional("Unknown argument: --nested"))`. Use `--object`.

---

## fm serve

Starts an HTTP server with the OpenAI Chat Completions API. Full guide: [Serve API](03-serve-api.md).

| Flag | Meaning |
|------|---------|
| `--host <host>` | TCP address. Default `127.0.0.1`. |
| `--port <port>` | TCP port, 1 to 65535. Default `1976`. |
| `--socket <path>` | Use a Unix domain socket instead of TCP. |
| `-h, --help` | Help. |

```sh
fm serve
fm serve --port 1976
fm serve --socket /tmp/fm.sock
```

Errors (exit 64):

```text
Error: --socket cannot be used with --host or --port
Error: Port must be between 1 and 65535
Error: Socket path must not be empty
```

A busy port gives `Error: POSIXErrorCode(rawValue: 48): Address already in use`.
