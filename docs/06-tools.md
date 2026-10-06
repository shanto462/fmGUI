# Tools

There are two different stories:

1. **Built-in tools in the CLI** (`--tool ocr`, `--tool barcode`). These work.
2. **OpenAI-style tools over `fm serve`** (`tools`, `tool_calls`). These do **not** work on macOS 27.0.1. Use the guided-JSON router below instead.

## Built-in tools (fm respond and fm chat)

| `--tool` | Internal tool name | What it does |
|----------|--------------------|--------------|
| `ocr` | `getText` | Reads text from an attached image (Vision OCR). |
| `barcode` | `readBarcodes` | Reads barcodes and QR codes from an attached image. |

```sh
fm respond --tool ocr --image invoice.png --label invoice 'What is the total on the invoice?'
```

```text
The total on the invoice is $42.50.
```

```sh
fm respond --tool barcode --image qr.png 'What URL is in the QR code?'
```

```text
The URL in the QR code is: https://example.com/order/A-1234
```

Both tools at once, two images:

```sh
fm respond --tool ocr --tool barcode \
  --image invoice.png --label invoice \
  --image qr.png --label code \
  'What is the total on the invoice, and what URL is in the code?'
```

```text
The total on the invoice is $42.50, and the URL in the code is https://example.com/order/A-1234.
```

In `fm chat`: start with `fm chat --tool ocr`, or use `/tools add ocr`, `/tools remove ocr`, `/tools` to list.

### Labels

- `--label` names the `--image` at the same position. At most one label per image.
- Without `--label`, images are named `image_0`, `image_1`, ... (starting at **0**).
- The model passes the label to the tool. If you mention a label that does not exist in the prompt (for example "read image_1" when there is only `image_0`), the tool call fails and `fm` prints a long error that ends with `Underlying error: No image in transcript with label image_1`.
- The same happens when you enable a tool but attach no image.
- Tip: use clear labels (`invoice`, `receipt`) and do not invent labels in the prompt.

Errors:

```text
Error: --label has no effect without an image-using tool. Enable --tool barcode or --tool ocr (or drop the --label flag).
Error: Received 2 --label value(s) for 1 --image value(s). Provide at most one --label per --image.
Error: Unknown tool 'weather'. Known: barcode, ocr.
```

The binary also has `No built-in tools are available in this build. Drop the --tool flag.` for builds without these tools.

### How it works inside

When a tool is on, `fm`:

1. adds the tool definitions to the `instructions` entry of the transcript,
2. adds a hidden instruction that tells the model it must call a matching tool instead of answering from memory, then answer based on the tool result,
3. stores images as `attachment` items with their label.

You can see the tool call and the tool result in a saved transcript. See [Transcripts](04-transcripts-and-sessions.md#tool-calls-in-a-transcript).

There are **no custom tools** in the CLI. You cannot add your own tool to `fm respond` or `fm chat`.

## Tools over fm serve: what really happens

Tested on 27.0.1 with a `get_weather` function and the prompt "What is the weather in Paris right now?":

| Request | Result |
|---------|--------|
| `tools: [...]` (auto) | 200, **no `tool_calls`**. The model writes text like `{"message": "The weather in Paris right now is [insert weather description here]."}` |
| `tool_choice: "auto"` | Same as above. |
| `tool_choice: "none"` | 200, the model wrote the arguments as text: `{"city": "Paris"}` |
| `tool_choice: "required"` | **500** `An unsupported generation guide was used.` |
| `tool_choice: {"type":"function","function":{"name":"get_weather"}}` | **500** `An unsupported generation guide was used.` |
| `tool_choice` naming a missing function | 400 `tool_choice names function 'nope' which is not present in tools: [get_weather]` |
| `tool_choice: "required"` without `tools` | 500, same message |
| Tool **result** sent back (assistant `tool_calls` + `role: "tool"` with `tool_call_id`) | **Works.** Answer: `The current weather in Paris is 18°C with light rain.` Works with or without `tools` in the request. |

So: `fm serve` accepts the OpenAI tool fields but never produces `tool_calls`. Agents built for OpenAI tools (LangChain agents, OpenAI Agents SDK and others) will not call tools against `fm serve`. Community proxies such as fmToOpenAI try to turn text markers into `tool_calls` (unverified).

## Workaround: a guided-JSON tool router

Let the model choose with **structured output** instead of native tool calls:

1. Build a schema with an `anyOf`. One branch per tool. Each branch is an object with **one key: the tool name**, whose value is the arguments object. Add one more branch `{"answer": "..."}` for "no tool needed".
2. Send the request with `response_format: json_schema`.
3. Read the single key of the result. If it is a tool name, run that tool in your code.
4. Send the result back as a `tool` message (this part of the API works) and ask for the final answer.

Example outputs:

```json
{"lookup_order": {"order_id": "A-7781"}}
{"get_current_time": {}}
{"calculator": {"expression": "1234.5 * 987.25"}}
{"answer": "Owls have exceptional hearing, which helps them locate prey even in complete darkness."}
```

Why keyed by name: putting the tool name in a key (not in a `"tool": "..."` field) makes the branch and its arguments one unit, and every branch schema stays a simple object with the six keys `fm` wants.

### Router (tested)

`router.py`, needs `pip install httpx` and a running `fm serve --socket /tmp/fm.sock`:

```python
"""Guided-JSON tool router for `fm serve --socket`.

Start the server first:  fm serve --socket /tmp/fm.sock
Run:                     python3 router.py "Where is my order A-7781?"
"""
import json
import sys

import httpx

SOCKET = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fm.sock"

# 1. Describe your tools. Each tool has a description and its argument properties.
TOOLS = {
    "lookup_order": (
        "Look up the shipping status of a customer order by its order id.",
        {"order_id": {"type": "string", "description": "Order id like A-1234"}},
    ),
    "get_current_time": ("Get the current local date and time.", {}),
    "calculator": (
        "Evaluate an arithmetic expression exactly.",
        {"expression": {"type": "string"}},
    ),
}


def obj(title, props):
    """An object schema in the strict shape that fm accepts everywhere."""
    return {
        "title": title,
        "type": "object",
        "properties": props,
        "required": list(props),
        "x-order": list(props),
        "additionalProperties": False,
    }


def router_schema():
    """One anyOf branch per tool, keyed by the tool name, plus an answer branch."""
    defs, branches = {}, []
    for name, (_, props) in TOOLS.items():
        defs[name] = obj(name, {name: obj(name + "Args", props)})
        branches.append({"$ref": "#/$defs/" + name})
    defs["reply"] = obj("reply", {"answer": {"type": "string"}})
    branches.append({"$ref": "#/$defs/reply"})
    return {"title": "Step", "anyOf": branches, "$defs": defs}


SYSTEM = (
    "You can call tools. Tools:\n"
    + "\n".join(f"- {n}: {d}" for n, (d, _) in TOOLS.items())
    + "\nIf a tool is needed, output a tool call. Otherwise output an answer."
)


def step(client, question):
    body = {
        "stream": False,  # the default is true, so set it
        "temperature": 0,  # more stable tool choice
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": question},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "Step", "schema": router_schema()},
        },
    }
    r = client.post("/v1/chat/completions", json=body)
    r.raise_for_status()
    return json.loads(r.json()["choices"][0]["message"]["content"])


def main():
    question = sys.argv[1] if len(sys.argv) > 1 else "Where is my order A-7781?"
    transport = httpx.HTTPTransport(uds=SOCKET)
    with httpx.Client(transport=transport, base_url="http://localhost", timeout=120) as client:
        result = step(client, question)
    if "answer" in result:
        print("ANSWER:", result["answer"])
    else:
        (tool, args), = result.items()  # exactly one key: the tool name
        print("TOOL:", tool, "ARGS:", json.dumps(args))


if __name__ == "__main__":
    main()
```

Real output:

```text
Where is my order A-7781?          -> TOOL: lookup_order ARGS: {"order_id": "A-7781"}
What time is it?                   -> TOOL: get_current_time ARGS: {}
Compute 1234.5 * 987.25            -> TOOL: calculator ARGS: {"expression": "1234.5 * 987.25"}
Tell me a fun fact about owls.     -> ANSWER: Owls can rotate their heads up to 270 degrees, thanks to special blood vessels that allow them to keep their eyes and brain connected while they turn their heads.
Hi there!                          -> ANSWER: Hello! How can I help you today?
```

### Full loop: run the tool, send the result back (tested)

`agent.py`, in the same folder as `router.py`:

```python
"""Tiny agent loop: guided-JSON router + real tool + final answer."""
import datetime
import json
import sys

import httpx

from router import SYSTEM, router_schema

SOCKET = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fm.sock"
FAKE_ORDERS = {"A-7781": "shipped, arrives Friday", "A-1234": "processing"}


def run_tool(name, args):
    if name == "lookup_order":
        return {"order_id": args["order_id"], "status": FAKE_ORDERS.get(args["order_id"], "not found")}
    if name == "get_current_time":
        return {"now": datetime.datetime.now().isoformat(timespec="minutes")}
    if name == "calculator":
        return {"result": eval(args["expression"], {"__builtins__": {}})}  # demo only, not safe
    return {"error": "unknown tool"}


def chat(client, messages, schema=None):
    body = {"stream": False, "messages": messages}
    if schema:
        body["temperature"] = 0  # more stable tool choice
        body["response_format"] = {"type": "json_schema", "json_schema": {"name": "Step", "schema": schema}}
    r = client.post("/v1/chat/completions", json=body)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def main():
    question = sys.argv[1] if len(sys.argv) > 1 else "Where is my order A-7781?"
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]
    transport = httpx.HTTPTransport(uds=SOCKET)
    with httpx.Client(transport=transport, base_url="http://localhost", timeout=120) as client:
        step = json.loads(chat(client, messages, router_schema()))
        if "answer" in step:
            print(step["answer"])
            return
        (name, args), = step.items()
        result = run_tool(name, args)
        print(f"[tool] {name}({json.dumps(args)}) -> {json.dumps(result)}")
        # Send the result back the OpenAI way. fm serve accepts this shape.
        messages.append({"role": "assistant", "content": None, "tool_calls": [
            {"id": "call_1", "type": "function",
             "function": {"name": name, "arguments": json.dumps(args)}}]})
        messages.append({"role": "tool", "tool_call_id": "call_1", "content": json.dumps(result)})
        print(chat(client, messages))  # plain text final answer


if __name__ == "__main__":
    main()
```

Real output:

```text
Q: Where is my order A-7781?
[tool] lookup_order({"order_id": "A-7781"}) -> {"order_id": "A-7781", "status": "shipped, arrives Friday"}
Your order A-7781 is shipped and is expected to arrive on Friday.
Q: Compute 1234.5 * 987.25
[tool] calculator({"expression": "1234.5 * 987.25"}) -> {"result": 1218760.125}
The result of 1234.5 * 987.25 is 1,218,760.125.
Q: Hi there!
Hello! How can I help you today?
```

### How reliable is it?

Measured with the 5 questions above. The code above uses `temperature: 0`. The rows with "default sampling" are the same code without it:

| Setting | Correct choice |
|---------|----------------|
| Default sampling, first run | 5 / 5 |
| Default sampling, 8 runs each | 35 / 40. All 5 misses: "Hi there!" → `get_current_time`. |
| `temperature: 0` (router) | 5 / 5, two separate test runs |
| `temperature: 0` (agent loop, 3 questions × 2) | 6 / 6 |
| Agent loop, 3 questions, default sampling | 1 / 3. "Where is my order A-7781?" was answered directly with a made-up status ("in transit") instead of calling `lookup_order`, and "Hi there!" called `get_current_time`. |

Advice:

- Send `"temperature": 0` for the routing step.
- Keep tool descriptions short and clear. Few tools work better than many (8K context).
- Validate arguments in your code before you run a tool. Ask the user before tools with side effects.
- If a tool should always be used for some questions (order status), check for it in your code too, do not trust the model alone.
- Truncate long tool results. The whole conversation must fit in the context window.
