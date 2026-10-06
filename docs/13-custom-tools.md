# Custom tools

A custom tool lets the model do something new on your Mac: run a command, call a web API, or run an Apple Shortcut.
You make one in a step by step wizard, test it, and then the model can use it in every chat.

## How the model uses a tool

The model never runs anything itself. For every message, fmGUI shows the model a short list of tools (name,
parameters and description). The model answers with the tool it wants and the arguments, for example
`{"get_weather": {"city": "Paris"}}`. fmGUI asks for your approval if needed, runs the tool, and gives the result back
to the model. Then the model writes the answer.

So two things matter most: a clear **description** (so the model picks the tool at the right time) and simple
**parameters** (so the model fills them in correctly).

## The wizard, step by step

Open **Tools** in the sidebar and click **New tool**. The wizard has six steps.

### 1. Type

Pick how the tool works:

| Type | What it does | Example |
|------|--------------|---------|
| Shell command | Runs a command with `/bin/zsh -c` and returns what it prints. | `df -h /` |
| HTTP request | Calls a web API and returns the reply. | `GET https://api.ipify.org` |
| Apple Shortcut | Runs a shortcut from the Shortcuts app. | `shortcuts run "Add Reminder"` |

Or start from a template: Weather, Battery status, Disk space, Open an app, Current Wi-Fi network, Public IP. A template
fills in every step. You can change anything before you save.

### 2. Name and description

- **Tool name**: lowercase letters, numbers and underscores, starting with a letter, for example `get_weather`. The
  model sees this name. If it is already taken (for example by a built-in tool), fmGUI shows the model a longer unique
  name such as `custom_get_weather`.
- **Description**: what the tool does and when to use it. See [Write good descriptions](#write-good-descriptions).

### 3. Parameters

Parameters are the inputs the model fills in. Leave this empty if the tool needs no input.

For each parameter you set:

- **Name**: lowercase letters, numbers and underscores, starting with a letter, for example `city`.
- **Type**: Text, Whole number, Number, or Yes / no.
- **Description**: the model reads this. Give an example, like "City name, for example Paris".
- **Required**: when it is off, the model may leave the parameter out.

### 4. Configure

This step depends on the type. See [Shell command tools](#shell-command-tools), [HTTP request tools](#http-request-tools)
and [Apple Shortcut tools](#apple-shortcut-tools) below. Every type has a **Timeout** (1 to 600 seconds). The tool is
stopped when it runs longer.

### 5. Test

Fill in example arguments, like the model would, and run the tool. You see the exact output the model would get. This
step is optional, and it does not ask for approval.

### 6. Save

- **Approval**: **Ask every time** (fmGUI shows you the arguments and waits) or **Always allow** (runs without
  asking). Ask every time is the default, and it is the safe choice for anything that changes files or sends data.
- **Enabled**: when it is off, the model does not see the tool.
- **Context cost**: about how many tokens this tool adds to every request.

You can edit, test, turn off or delete a tool later on the **Tools** page.

## Shell command tools

The command runs with `/bin/zsh -c`, like a line you type in Terminal, with the PATH of your login shell. It runs in
your home folder unless you choose a **Working folder**.

### How arguments reach your command

Arguments are **never pasted into the command text**, so the model cannot add its own commands. Your command reads
them in two ways:

1. **Environment variables** named `FM_ARG_<NAME>`, where `<NAME>` is the parameter name in upper case. A parameter
   `app_name` becomes `$FM_ARG_APP_NAME`. Numbers and yes / no values arrive as text (`42`, `true`).
2. **Standard input** (stdin): all arguments as one JSON object, for example `{"app_name": "Safari"}`. Useful for tools
   such as `jq` or a Python script.

Always put the variable in double quotes: `"$FM_ARG_APP_NAME"`. Then a value with spaces stays one argument. A
parameter the model left out is simply not set, so the variable is empty.

### What the model gets back

- What the command prints (stdout). If it also printed on stderr, that comes after a `stderr:` line.
- If the command fails (exit code not 0), the model gets `Exit code <n>` plus the output, and the step shows as an
  error.
- Long output is cut to fit the context window.

Do not put passwords, API keys or tokens in a command. Commands are saved in plain text in `config.json`.

## HTTP request tools

Set the **method** (GET, POST, PUT, PATCH or DELETE), the **URL**, optional **headers** and an optional **body**.

### `{{param}}` placeholders

Write `{{name}}` where an argument should go. fmGUI fills it in and escapes it for the place it is in:

| Where | How the value is inserted |
|-------|---------------------------|
| URL | URL-encoded (`New York` becomes `New%20York`). |
| Header values | As is. |
| Body that starts with `{` or `[` (JSON) | Escaped for a JSON string. Write the quotes yourself: `{"city": "{{city}}"}`. |
| Any other body | As is. |

A placeholder with no matching argument becomes empty text. When the body is JSON and you did not set a
`Content-Type` header, fmGUI sends `Content-Type: application/json`.

### What the model gets back

The status line and the reply as text, for example `HTTP 200` and then the body. HTML pages are turned into readable
text. Replies are cut at 2 MB, and long text is cut to fit the context. A status that is not 2xx counts as an error.

If an API needs a key, it goes in a header (for example `Authorization: Bearer <key>`). It is saved in plain text in
`config.json`.

## Apple Shortcut tools

Pick one of your shortcuts from the list (fmGUI reads it with `shortcuts list`), or type its exact name. fmGUI runs:

```sh
shortcuts run "<name>" --input-path <file> --output-path <file>
```

- **Input**: if the tool has one parameter, the shortcut gets its value as text. With more parameters, it gets all
  arguments as one JSON object. With no arguments, it gets no input. Tip: name a single parameter `input`.
- **Output**: whatever the shortcut outputs. End the shortcut with a **Stop and Output** action to send text back to
  the model. Without output, the model gets "The shortcut finished with no output."

Shortcuts can do almost anything on your Mac, so keep **Ask every time** unless the shortcut only reads data.

## Write good descriptions

The on-device model is small. It decides from the description alone, so:

- **Say what the tool does, then when to use it.** "Get the current weather for a city. Use this when the user asks
  about the weather, the temperature or rain."
- **Keep it short.** About one or two sentences, under 160 characters. Longer text is cut, and every word costs
  context in every request.
- **Name the trigger words** the user is likely to say ("battery", "storage", "Wi-Fi").
- **Give examples in parameter descriptions**: "City name, for example Paris or Tokyo".
- **Use few parameters.** One or two simple text or number parameters work best.
- **Do not overlap.** If two tools sound alike, the model picks the wrong one. Turn off the one you do not need.

## Worked examples

### Example 1: Show a month's calendar (shell)

| Field | Value |
|-------|-------|
| Type | Shell command |
| Name | `show_calendar` |
| Description | `Show the calendar of a month. Use this when the user asks which weekday a date is, or wants to see a month.` |
| Parameters | `month` (Whole number, "Month number, 1 to 12", required), `year` (Whole number, "Year, for example 2026", required) |
| Command | `cal "$FM_ARG_MONTH" "$FM_ARG_YEAR"` |
| Approval | Always allow (it only reads) |

Test it with `month = 10` and `year = 2026`. Then ask in a chat: "Which weekday is 31 October 2026?"

### Example 2: Weather for a city (HTTP)

| Field | Value |
|-------|-------|
| Type | HTTP request |
| Name | `get_weather` |
| Description | `Get the current weather for a city. Use this when the user asks about the weather, the temperature or rain.` |
| Parameters | `city` (Text, "City name, for example Paris or Tokyo", required) |
| Request | `GET https://wttr.in/{{city}}?format=3` |
| Approval | Always allow, or Ask every time if you want to see each request |

This is the Weather template. Ask: "Do I need an umbrella in Tokyo today?"

A POST version for your own API could look like this (body template):

```json
{"note": "{{text}}", "source": "fmGUI"}
```

### Example 3: Add a reminder (Apple Shortcut)

1. In the Shortcuts app, make a shortcut named **Add Reminder** with an **Add New Reminder** action that uses the
   **Shortcut Input** as its title. End it with **Stop and Output** (for example the text "Added").
2. In fmGUI, create a tool:

| Field | Value |
|-------|-------|
| Type | Apple Shortcut |
| Name | `add_reminder` |
| Description | `Add a reminder to the Reminders app. Use this when the user asks you to remind them of something.` |
| Parameters | `input` (Text, "What to remember, for example Call the dentist", required) |
| Shortcut | Add Reminder |
| Approval | Ask every time |

Ask: "Remind me to water the plants." fmGUI shows the approval card with `input: "Water the plants"`. Click
**Allow once**.

## Troubleshooting

| Problem | What to do |
|---------|------------|
| The model never uses my tool | Make the description more specific and name the trigger words. Check that the tool is enabled and that **Use tools in chats** is on (the **Tools** button in a chat). Turn off tools that sound alike. |
| The model uses my tool for everything | Add "Use this only when..." to the description. |
| "Command not found" in a shell tool | The command runs with your login shell PATH. Use the full path (`/opt/homebrew/bin/<tool>`), or add the folder to PATH in `~/.zprofile` and restart fmGUI. |
| A variable is empty | Check the spelling: parameter `app_name` is `$FM_ARG_APP_NAME`. The wizard warns about variables with no matching parameter. |
| "The tool took longer than N seconds" | Raise the timeout in step 4. |
| The shortcut returns nothing | End the shortcut with **Stop and Output**. |
