# Overview

## What `fm` is

`fm` is a command-line tool from Apple. It ships with macOS 27 at `/usr/bin/fm`. It gives you Apple's on-device language model (the same model the Swift Foundation Models framework uses) from the Terminal.

With `fm` you can:

- ask one question and get an answer (`fm respond`)
- have a multi-turn chat in a terminal UI (`fm chat`)
- count tokens (`fm count-tokens`)
- build a JSON schema for structured output (`fm schema object`)
- run a local HTTP server that speaks the OpenAI Chat Completions API (`fm serve`)
- check if the model is ready (`fm available`)
- read and accept the license (`fm license`)

There is a man page: `man fm` (dated June 8, 2026 on this Mac).

Everything in these docs was checked on this Mac unless marked "(unverified)":

| Item | Value |
|------|-------|
| macOS | 27.0.1 (build 26A434) |
| Chip | Apple M4 Pro |
| Date checked | 2026-10-06 |

## Requirements

- A Mac with Apple Silicon.
- macOS 27 or later.
- Apple Intelligence turned on (System Settings → Apple Intelligence & Siri).
- The model downloaded. macOS downloads it after you turn on Apple Intelligence.
- The `fm` license accepted once per Mac (see [License](10-license.md)).

Check it with:

```sh
fm available
```

Real output on this Mac:

```text
System model available
```

Other messages that exist in the binary (not seen here):

| Message | Meaning |
|---------|---------|
| `System model unavailable: <reason>` | The model cannot be used right now. |
| `Apple Intelligence is not enabled.` | Turn it on in System Settings. |
| `This device does not support Apple Intelligence.` | The Mac is not eligible. |
| `The model is not available. Try again later.` | Often: the model is still downloading. |

## Models

| Name | Status on this Mac | Notes |
|------|--------------------|-------|
| `system` | Available, default | On-device model. Asset names say `instruct_3b`, so it is the ~3B parameter model. |
| `pcc` | Not in `fm` | `fm available -m pcc` fails: `The value 'pcc' is invalid for '-m <model>'. Please provide one of 'system'.` (exit 64). WWDC26 session 334 shows `--model pcc` and `/model` in chat for Private Cloud Compute (unverified here). The Swift framework on this Mac reports `PrivateCloudComputeLanguageModel` as available with a 32,768 token context, so only `fm` lacks it. |

The model is made of several assets. You can see them with the hidden flag `--show-assets` (prints to stderr):

```sh
fm respond --show-assets 'Say OK.'
```

```text
OK.
Assets used:
- com.apple.fm.language.instruct_3b.fm_api_generic_3b?variant=generic_sparse_16.1.0.13.103120,0
- com.apple.fm.language.instruct_3b.fm_api_generic.draft?variant=generic_sparse_16.0.81624.13.204770,0
- com.apple.fm.language.instruct_3b.tokenizer?variant=generic_sparse_16.0.0.13.204691,0
```

When the prompt has an image, a fourth asset is used: `...instruct_3b.image_encoder?...`. The `draft` asset is a small helper model for faster generation (speculative decoding).

## Context size

- On this Mac the context window is **8,192 tokens**. The `fm chat` status bar shows `71 / 8,192 (0% used)`, and `SystemLanguageModel.default.contextSize` in Swift returns `8192`.
- Some testers report **4,096** on older Macs such as M2 (unverified, from [apfel issue 510](https://github.com/Arthur-Ficial/apfel/issues/510)).
- So read the size at runtime. Do not hard-code it.
- Instructions, every message, the answer, and images all count.
- When you go over, you get: `The session's transcript exceeded the model's context size.`

## First run and the license

1. The first time you run any `fm` command, `fm` shows the "Legal Notice & Terms" and asks you to agree.
2. Agreement is for the whole Mac (all users), so it must run as admin: `sudo fm license`.
3. Answer `yes` or `y`. Any other answer means "no", and `fm` exits with status **69**.
4. `fm license` itself always works, so you can read the terms first.

Details: [License](10-license.md).

## Files `fm` uses

| Path | What it holds |
|------|---------------|
| `/usr/bin/fm` | The tool. |
| `/usr/share/man/man1/fm.1` | The man page. |
| `/Library/Preferences/com.apple.fm.plist` | License acceptance (owned by root). |
| `~/.fm/sessions/<name>.json` | Saved `fm chat` sessions. |
| `~/.fm/config.json` | Per-user settings, such as the default chat model. Created by `fm chat --set-default-model`. |

## Speed on this Mac (M4 Pro)

| Task | Time |
|------|------|
| `fm available`, `fm schema`, `fm count-tokens` | 5 to 45 ms |
| `fm respond` short answer, total | about 1.6 to 1.7 s |
| First token over `fm serve`, warm | about 0.36 to 0.42 s |
| First token after 30 s idle | about 1 s |
| Generation speed | about 46 to 50 tokens per second |
| Request that overflows the context | fails after about 18 to 20 s |

Other people report about 113 tokens per second and 377 ms first token on an M5 Pro, and that the model unloads after about 6 s idle (unverified).

## What the model is good at

From testing and community reports:

- Good: extraction to JSON, tagging, short summaries, rewriting, reading text in images, simple classification and routing.
- Weak: world facts, math, code, long reasoning. Always check facts it gives you.

## Exit codes

| Code | When |
|------|------|
| 0 | Success. Also `fm` with no arguments (prints help). |
| 1 | Runtime or validation error (bad schema, bad guardrail value, model error, unknown command). |
| 64 | Command-line usage error (unknown option, invalid value for `-m`, bad port). |
| 69 | License not agreed. |

## Quick start

```sh
fm available
fm respond 'Give me three names for a cat.'
echo 'Summarize: The meeting moved to Friday at 10.' | fm respond
fm respond --image invoice.png --text 'What is the total?'
fm chat
fm serve            # http://127.0.0.1:1976
```

Next: [Commands](02-commands.md).
