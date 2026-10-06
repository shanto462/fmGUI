# Limits and gotchas

Everything here was seen on macOS 27.0.1 (26A434) unless marked "(unverified)". Each item says what to do about it.

## Model and context

- **Small context.** 8,192 tokens on this Mac. Some Macs report 4,096 (unverified). Read the size at runtime (the `fm chat` status bar, or `contextSize` in the Swift framework). Do not hard-code it.
- **Hidden template tokens.** A one-word prompt over `fm serve` already costs about 58 prompt tokens. `fm count-tokens -i 'Answer concisely'` is 49. Plan for this overhead.
- **Overflow is slow to fail.** A prompt of about 44,000 tokens took 18 to 20 s before it failed with `The session's transcript exceeded the model's context size.` Count tokens first. `fm count-tokens` takes only milliseconds.
- **Images cost tokens.** A 1200x400 PNG cost about 200 tokens.
- **Only one model.** `system` is the only model on this build. `pcc` (Private Cloud Compute) is rejected by `-m` (exit 64).
- **Weak at facts, math and code.** It is a ~3B model. Use it for extraction, tagging, summaries, rewriting and routing. Check facts.
- **Safety filter.** Very repetitive input (the same sentence 40 times) triggered `The model's safety guardrails were triggered.` A normal long system prompt did not.

## fm respond and other CLI commands

- **Streams by default, even when piped.** Text arrives in small pieces. Use `--no-stream` if you want the answer in one write.
- **`-v` writes to stdout.** The `Creating session with ...` line goes to stdout (with color codes), after the answer when streaming. Do not use `-v` when you parse output.
- **Colored errors.** Errors go to stderr with ANSI color codes, even when piped. `NO_COLOR` is ignored. Strip with `\x1b\[[0-9;]*m`.
- **Typographic apostrophes.** Many error messages use `’` (for example `couldn’t`). Match on other words, not on `couldn't`.
- **Stdin rules.** The prompt is read from stdin only if there is no positional prompt, no `--text` and no `--image`. Piped text is silently ignored if you also pass a prompt.
- **Stdin hang.** `fm count-tokens -i '...'` (and `fm respond -i '...'`) with no prompt wait for stdin when stdin is not a terminal. A GUI app that spawns `fm` with an open stdin pipe will hang. Always spawn with stdin set to `/dev/null` (null) or close it.
- **Prompts that start with `-`.** Use `--`: `fm respond -- '-5 plus 3?'`.
- **`--resume` does not save.** Add `--save-transcript <same file>` to keep the new turn.
- **`--resume` + `-i` is an error.** The transcript already has its instructions.
- **`count-tokens --image` is broken** (`ModelManagerError error 1001`), and so is `count-tokens --transcript` for a transcript with an image. Estimate images at about 200 tokens instead.
- **Help text is wrong in two places.** `fm schema object --help` shows `--nested` (does not exist, use `--object`). `fm --help` shows `--int` (works, it is an alias of `--integer`).
- **`--guardrails permissive` is rejected.** Only `default` and `permissive-content-transformations` work.
- **No version flag.** `fm --version` is an unknown option. Use `sw_vers` for the macOS build.
- **Hidden flag.** `fm respond --show-assets` prints the model asset ids on stderr.

## fm chat

- **Pipe mode.** With a non-terminal stdin, `fm chat` does not fail. It reads stdin lines as user messages, sends slash commands to the model as text, and saves a session. `fm chat --continue` in a script appends your script's stdin to your last session. Do not run `fm chat` from scripts. Use `fm respond --resume`.
- **Session names come from the model.** They can be surprising. Use `/save <name>` for a fixed name.
- **No delete or rename command.** Manage files in `~/.fm/sessions/` yourself.

## Structured output

- **`fm respond --schema` is strict.** Every object needs `type`, `title`, `properties`, `required`, `x-order` and `additionalProperties`. Otherwise: `The data couldn’t be read because it is missing.` Generate schemas with `fm schema object`.
- **`x-order` controls output.** Fields not in `x-order` are not generated, even if `required`.
- **`fm serve` is relaxed at the top level but strict in `$defs`.**
- **Titles on string fields break `fm serve`** (`Named string types must have a non-empty enum field`). Pydantic adds these. Remove them.
- **Constraints are not enforced.** `maxLength`, `minimum`, `maxItems` and similar are accepted but ignored. `pattern` causes HTTP 500. Validate in your code.
- **Nullable types are rejected** (`"type": ["string", "null"]`).
- **`--anyOf` drops other properties** in `fm schema object`.
- **Key order is random** in `fm schema object` output.

Details: [Structured output](05-structured-output.md).

## fm serve

- **`stream` defaults to `true`.** Leave it out and you get SSE, not JSON. Always send `"stream": false` for a single JSON answer. Some SDKs leave the field out when you do not set it (unverified for the `openai` package), so set it explicitly.
- **`max_tokens` is ignored.** Use `max_completion_tokens`.
- **`finish_reason` is always `"stop"`**, even when `max_completion_tokens` cut the answer.
- **No `stop` sequences** (400). Cut the text yourself.
- **No `json_object`** (400). Use `json_schema`.
- **No `n > 1`** (400).
- **No native tool calls.** `tools` are accepted but no `tool_calls` come back. `tool_choice: "required"` or a named function returns 500. Tool results (`role: "tool"`) do work. See [Tools](06-tools.md).
- **`developer` role is rejected** (400 `Invalid JSON`). Use `system`.
- **The last message must be from the user** (or a tool result). Otherwise the answer is an empty string with status 200.
- **Images must be data URLs.** Remote URLs are rejected.
- **Errors in a stream come as `event: error`** after a 200 status. There is no `[DONE]` after it.
- **`code` in errors is a string** (`"400"`), not a number.
- **`cached_tokens` and `reasoning_tokens` are always 0.**
- **Cross-site requests are blocked in TCP mode.** POSTs from non-loopback origins, from `tauri://localhost`, from `null`, with `Sec-Fetch-Site: cross-site` or `same-site`, and with `text/plain` or form content types get 403. Modern browsers send `Sec-Fetch-Site`, so even a page on `http://localhost:5173` cannot POST to it. A Tauri or Electron webview cannot call it directly either. Call it from native code, or use the Unix socket.
- **No authentication.** Anyone who can reach the port can use the model. `--host 0.0.0.0` exposes it to the network.
- **Default port 1976.** A second server on the same port fails with `Address already in use`.
- **Socket replacement.** A second `fm serve --socket` on the same path silently takes over the socket file. The first server keeps running, unreachable. When either stops, the file is deleted.
- **Socket permissions** are `srwxr-xr-x`. Put the socket in a private folder (for example your app's data folder with `0700`).
- **Logs are buffered** when stdout is not a terminal. Lines arrive late, in blocks.
- **Parallel requests share the model.** 3 parallel requests took 1.5, 2.5 and 3.7 s. Queue requests in your app.
- **`Connection: close`** on every normal response. No keep-alive between requests.
- Reported by others (unverified): Pydantic schemas with titles fail (confirmed above for strings), self-referencing `$defs` can hang, `usage` is sometimes 0, `fm available --model pcc` can misreport on builds with PCC, PCC only unlocks when `fm serve` runs in a foreground Terminal.

## License

- **Machine-wide, needs `sudo`.** A normal user cannot accept it. A GUI should show the command `sudo fm license` and let the user run it in Terminal.
- **Exit code 69** for every command when not agreed (except `fm license`).
- **No terminal, no agreement.** Without a TTY it prints `No terminal is attached, so the agreement cannot be presented.` With redirected stdin: `Standard input is redirected, so there is nothing to read your answer from.`

Details: [License](10-license.md).

## Checklist for app developers

1. Run `fm license --status` and `fm available` at start. Show clear next steps.
2. Spawn `fm` with stdin set to null.
3. Strip ANSI codes from stderr before you show errors.
4. Use `--no-stream` or handle chunks.
5. Count tokens before long requests. Keep a margin of a few hundred tokens.
6. Talk to `fm serve` from native code over a private Unix socket. One path per server.
7. Always send `"stream": false` or parse SSE, including `event: error`.
8. Use `max_completion_tokens`, not `max_tokens`.
9. Use a guided-JSON router for tools, with `temperature: 0`.
10. Validate every JSON answer.
