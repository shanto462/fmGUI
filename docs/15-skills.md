# Skills

A skill is a set of instructions for one kind of task, saved as a `SKILL.md` file. For example: how you like your
emails written, or how to turn meeting notes into action items. The model reads the skill when it needs it, so you do
not have to repeat yourself in every chat.

Skills work like Claude skills, so you can import the ones you already have.

## The SKILL.md format

A skill is a folder with a `SKILL.md` file. The file starts with front matter (between two `---` lines), then the
instructions in Markdown:

```markdown
---
name: email-writer
description: Use when the user asks to write or reply to an email. Writes short, polite and clear emails.
---

# Email writer

Write emails that are short, polite and clear.

## Rules
- Put the main point in the first two sentences.
- Keep it under 120 words unless the user asks for more.
```

| Field | Rules |
|-------|-------|
| `name` | Lowercase letters, digits and hyphens, 1 to 64 characters, for example `email-writer`. If it is missing, the folder name is used. |
| `description` | Required. Up to 1,024 characters. Say **when** to use the skill. The model reads it to decide when to load the skill. |
| Body | The instructions. Plain Markdown. |

Other front matter keys (for example `license` or `allowed-tools` from an imported skill) are kept when you save, but
fmGUI does not use them.

fmGUI stores skills in `~/Library/Application Support/io.shanto.fmgui/skills/<name>/SKILL.md`.

## The three modes

Every skill has a mode. You set it on the **Skills** page.

| Mode | What the model sees | Context cost | Good for |
|------|---------------------|--------------|----------|
| **Off** | Nothing. | None. | Skills you keep for later. |
| **On demand** (default) | The name and description. It loads the full text when a request needs it. | Small, in every request. The full text only in the turn that uses it. | Most skills. |
| **Always** | The full text, added to the instructions of every chat. | The whole skill, in every request. | Short rules you want everywhere, like "answer in British English". |

On-demand skills need tools: they only work when **Use tools in chats** is on (the **Tools** button in a chat).
Always-on skills work even when tools are off.

## How use_skill works

When at least one skill is **On demand**, fmGUI adds a tool called `use_skill` to the model's tool list. It also adds
a short list to the tool guide:

```text
Skills you can load with use_skill:
- email-writer: Use when the user asks to write or reply to an email. Writes short, polite and clear emails.
- meeting-notes: Use when the user pastes meeting notes or a transcript. Turns them into a short summary and a list of action items.
```

When you ask "Write an email to Ada about Friday's meeting", the model calls `{"use_skill": {"name": "email-writer"}}`.
fmGUI sends back the full body of the skill as the tool result, and the model writes the answer with it. In the chat
you see a **Use skill** step, and the status line says "Loading skill email-writer".

Details:

- `use_skill` never asks for approval. It only reads the skill.
- The model can only pick names of on-demand skills.
- A loaded skill counts for that turn only. In the next message, the model loads it again if it needs it.
- Descriptions in the list are cut at 160 characters, so put the important words first.
- Only the `SKILL.md` body goes to the model. Other files in the skill folder are listed on the Skills page, but the
  model does not read them.

## Create a skill

1. Open **Skills** in the sidebar and click **New skill**.
2. **Start**: pick a template (Email writer, Meeting notes, Explain like I am 10) or **Blank skill**.
3. **Name**: a name like `email-writer`, and a description that says when to use the skill.
4. **Instructions**: write the body in Markdown.
5. **Mode**: Off, On demand or Always. The wizard shows how much context it costs.
6. **Save**. fmGUI writes `<name>/SKILL.md` in its skills folder.

You can edit, rename or delete a skill later. A renamed skill keeps its mode. **Count exactly** counts the tokens of
the body with `fm count-tokens` (the first number is an estimate of about 4 characters per token).

## Import skills you already have

Click **Import** on the Skills page. fmGUI lists the skills it finds in:

- `~/.claude/skills`
- `~/.agents/skills`

You can also choose any folder that has a `SKILL.md` file.

Import **copies** the folder into fmGUI's skills folder, so changes in the original do not affect fmGUI. While
copying, it skips `.git`, `node_modules`, `__pycache__` and `.venv` folders, folders that are symlinks, files over
2 MB, and everything after 200 files. A name that does not follow the rules is changed, for example `My PDF_Tools`
becomes `my-pdf-tools`.

Skills written for large cloud models are often long. Read an imported skill before you turn it on, and shorten it if
you can.

## Keep skills short

The on-device model sees about 8,192 tokens at once. That has to hold the instructions, the tools, the chat and the
answer.

- Aim for **under 500 tokens** per skill (about 2,000 characters). The Skills page warns you above 1,500 tokens.
- Use **On demand** for anything longer than a few lines.
- Write short rules and one example, not long explanations. A small model follows a clear list better than prose.
- Write the description for the model: start with "Use when ...".
- Keep only one skill per task. Two skills that overlap confuse the model.

## Example skills

### Example 1: Release notes (on demand)

```markdown
---
name: release-notes
description: Use when the user asks for release notes or a changelog entry from a list of changes.
---

# Release notes

Turn a list of changes into short release notes.

## Output
1. A title line: "Version X.Y.Z" if the user gave a version.
2. Up to three groups, in this order: **New**, **Improved**, **Fixed**. Leave out empty groups.
3. One bullet per change. Start with a verb ("Add", "Fix", "Speed up").

## Rules
- Write for users, not developers. No file names or code.
- Keep each bullet under 15 words.
- Do not invent changes.
```

### Example 2: House style (always)

A short skill like this is fine as **Always**, because it costs only about 60 tokens:

```markdown
---
name: house-style
description: Use for every answer. The user's preferred writing style.
---

- Use British English spelling.
- Use short sentences and simple words.
- Use a list when there are three or more items.
- Give the answer first, then the reason.
```

## Troubleshooting

| Problem | What to do |
|---------|------------|
| The model never loads my skill | Check that the mode is **On demand** and that tools are on for chats. Make the description start with "Use when" and name the words a user would say. |
| "This chat is too long for the model's context window" | Switch big skills from **Always** to **On demand**, or shorten them. |
| An imported skill does not show up | The folder must contain a `SKILL.md` file (any letter case works). |
| "Use only lowercase letters, digits and hyphens in the name" | Rename it, for example `pdf-tools`. |
