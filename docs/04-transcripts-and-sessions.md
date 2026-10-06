# Transcripts and sessions

A **transcript** is a JSON file with a whole conversation: instructions, user turns, model answers, images and tool calls. `fm respond` can save and load transcripts. `fm chat` saves its **sessions** in the same format.

## Where transcripts live

| What | Where | How |
|------|-------|-----|
| `fm respond` transcript | Any path you choose | `--save-transcript <file>` to write, `--resume <file>` to read |
| `fm chat` session | `~/.fm/sessions/<name>.json` | Saved automatically. `fm chat --resume <name>`, `fm chat --continue`, `/save`, `/resume`, `/sessions` |

Both use the same JSON format. So you can:

```sh
fm count-tokens --transcript ~/.fm/sessions/my-session.json
fm respond --resume ~/.fm/sessions/my-session.json 'One more question'
```

`fm respond --resume <file>` does **not** change the file. To keep the new turn, also pass `--save-transcript` (the same path is fine):

```sh
fm respond -i 'Be brief.' 'Name one planet.' --save-transcript chat.json      # Earth
fm respond --resume chat.json --save-transcript chat.json 'Name another one.' # Mars
```

`--save-transcript` rules:

- An absolute path is used as is. A bare file name is saved in the current folder.
- On success it prints `Transcript saved to: <absolute path>` on stderr.
- On failure it prints `Warning: Failed to save transcript '<path>'...` (from the binary, not seen).

`--resume` rules:

- `--resume` and `-i` cannot be used together: `Cannot specify both a saved transcript and --instructions. The transcript already contains its instructions.`
- A missing file: `Unable to read transcript at '<path>': The file “x.json” couldn’t be opened because there is no such file.`
- A file in the wrong shape: `Unable to read transcript at '<path>': The data couldn’t be read because it is missing.`

## File format

Top level:

```json
{
  "modelName": "system",
  "transcript": {
    "type": "FoundationModels.Transcript",
    "version": "1.1",
    "transcript": {
      "entries": [ ... ]
    }
  }
}
```

Note the double `transcript` key. The entries are in `transcript.transcript.entries`.

### A text conversation

Real file from `fm respond -i 'Be brief.' 'Name one planet.'` plus one resumed turn (ids shortened, assets shortened):

```json
{
  "modelName": "system",
  "transcript": {
    "type": "FoundationModels.Transcript",
    "version": "1.1",
    "transcript": {
      "entries": [
        {
          "role": "instructions",
          "id": "5E7CFF83-...",
          "contents": [{"type": "text", "text": "Be brief.", "id": "2F8017DE-..."}]
        },
        {
          "role": "user",
          "id": "C40001D4-...",
          "contents": [{"type": "text", "text": "Name one planet.", "id": "C9B99155-..."}],
          "options": {},
          "contextOptions": {}
        },
        {
          "role": "response",
          "id": "EFF11AE6-...",
          "contents": [{"type": "text", "text": "Earth", "id": "2937D67F-..."}],
          "assets": [
            "com.apple.fm.language.instruct_3b.fm_api_generic_3b?variant=generic_sparse_16.1.0.13.103120,0",
            "com.apple.fm.language.instruct_3b.fm_api_generic.draft?variant=generic_sparse_16.0.81624.13.204770,0",
            "com.apple.fm.language.instruct_3b.tokenizer?variant=generic_sparse_16.0.0.13.204691,0"
          ],
          "metadata": {
            "systemVersion": "Version 27.0.1 (Build 26A434)",
            "assetIDs": ["...same list as assets..."]
          }
        },
        {
          "role": "user",
          "id": "CB862EBB-...",
          "contents": [{"type": "text", "text": "Name another one.", "id": "B9C510C4-..."}],
          "options": {},
          "contextOptions": {}
        },
        {
          "role": "response",
          "id": "C91C7288-...",
          "contents": [{"type": "text", "text": "Mars", "id": "E311D7CB-..."}],
          "assets": ["..."],
          "metadata": {"systemVersion": "Version 27.0.1 (Build 26A434)", "assetIDs": ["..."]}
        }
      ]
    }
  }
}
```

### Entry types

| `role` | Fields | Notes |
|--------|--------|-------|
| `instructions` | `id`, `contents`, optional `tools` | Only present if you gave instructions or tools. Without `-i` there is no instructions entry at all. |
| `user` | `id`, `contents`, `options`, `contextOptions` | `options` and `contextOptions` were always `{}`. |
| `response` | `id`, `contents`, `assets`, `metadata` | Or `id` + `toolCalls` when the model called a tool. |
| `tool` | `id`, `toolCallID`, `toolName`, `contents` | The tool result. |

### Content types

| `type` | Shape |
|--------|-------|
| `text` | `{"type": "text", "text": "...", "id": "..."}` |
| `image` | `{"type": "image", "image": "data:image/jpeg;base64,...", "id": "..."}` |
| `attachment` | `{"type": "attachment", "attachment": {"type": "image", "label": "image_0", "data": "data:image/jpeg;base64,..."}, "id": "..."}` |

- A plain `--image` is stored as `image`. When a tool is enabled (`--tool ocr` or `--tool barcode`), images are stored as `attachment` with their label, so the tool can find them.
- Images are stored **inline** and re-encoded as **JPEG**, even if you gave a PNG. Transcripts with images get big: one 1200x400 PNG made a 67 KB file.
- The order in `contents` follows the command line: `--image x --text y` stores the image first, `--text y --image x` stores the text first (both tested).

### Tool calls in a transcript

Real entries from `fm respond --tool ocr --image invoice.png 'What does the attached image say?'`:

```json
[
  {
    "role": "instructions",
    "id": "9614C576-...",
    "contents": [],
    "tools": [{
      "type": "function",
      "function": {
        "name": "getText",
        "description": "Reads text from an image attached to the conversation. ...",
        "parameters": {
          "title": "Arguments",
          "type": "object",
          "properties": {"image": {"$ref": "#/$defs/ImageReference", "description": "The label of the image to analyze."}},
          "required": ["image"],
          "x-order": ["image"],
          "additionalProperties": false,
          "$defs": {"ImageReference": {"title": "ImageReference", "type": "object", "properties": {"attachmentLabel": {"type": "string"}}, "required": ["attachmentLabel"], "x-order": ["attachmentLabel"], "additionalProperties": false}}
        }
      }
    }]
  },
  {
    "role": "response",
    "id": "B07F5415-...",
    "toolCalls": [{"id": "F413263D-...", "name": "getText", "arguments": "{\"image\": {\"attachmentLabel\": \"image_0\"}}"}]
  },
  {
    "role": "tool",
    "id": "F413263D-...",
    "toolCallID": "F413263D-...",
    "toolName": "getText",
    "contents": [{"type": "text", "text": "Order A-1234\nTotal: $42.50", "id": "376FB176-..."}]
  }
]
```

When you `--resume` a transcript that has tool calls, `fm` prints `Warning: Transcript contains tool calls. Tool calls are not supported in fm.` and still answers. `fm count-tokens --transcript` prints a similar warning.

### Writing a transcript by hand

Tested: a hand-made transcript loads only if it has:

- an `id` on **every entry**,
- an `id` on **every content item**,
- `options: {}` and `contextOptions: {}` on every `user` entry.

`modelName` is optional. `response` entries do not need `assets` or `metadata`. Any unique string works as an id. A UUID is safest.

```json
{
  "modelName": "system",
  "transcript": {
    "type": "FoundationModels.Transcript",
    "version": "1.1",
    "transcript": {
      "entries": [
        {"role": "instructions", "id": "E1", "contents": [{"type": "text", "id": "C1", "text": "You are a pirate. Be brief."}]},
        {"role": "user", "id": "E2", "options": {}, "contextOptions": {}, "contents": [{"type": "text", "id": "C2", "text": "My name is Ada Lovelace."}]},
        {"role": "response", "id": "E3", "contents": [{"type": "text", "id": "C3", "text": "Ahoy, Ada!"}]}
      ]
    }
  }
}
```

```sh
fm respond --resume hand.json 'What is my name?'
```

```text
Ada Lovelace, ye scurvy dog!
```

This exact file was tested, so short ids like `E1` work.

Missing ids or options give `Unable to read transcript ... The data couldn’t be read because it is missing.`

## Chat sessions

- Folder: `~/.fm/sessions/`. It is created when needed.
- File: `<name>.json`, same format as above.
- The name comes from the model. `fm chat` asks the model to "Summarize this conversation as a short filename": 2 to 4 lowercase words joined by hyphens, for example `swift-concurrency`.
- You can give your own name with `/save <name>`.
- Name rules: not empty, not `.` or `..`, no `/`, `\` or NULL character.
- `fm chat --continue` opens the most recent session.
- On exit: `Resume conversation with: fm chat --resume <name>`.
- Errors: `Session '<name>' not found in ~/.fm/sessions/`, `No saved sessions found in ~/.fm/sessions/`, `Warning: Failed to save session: ...`.
- The CLI has no command to delete or rename sessions. Delete or rename the `.json` file.

## Tips for apps

- Use `fm respond --resume <file> --save-transcript <file>` to continue any CLI chat from a GUI.
- Read token use with `fm count-tokens --transcript <file>` before sending a new turn. This fails for transcripts with images on 27.0.1 (`ModelManagerError error 1001`).
- Do not run `fm chat` from a script with an open stdin. It runs in pipe mode and appends stdin lines to the session (see [Commands](02-commands.md#pipe-mode-no-terminal)).
