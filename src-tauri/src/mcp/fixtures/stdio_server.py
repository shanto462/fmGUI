#!/usr/bin/env python3
"""Tiny MCP server over stdio for fmGUI tests. Newline-delimited JSON-RPC.

Tools: add {a, b}, fail, crash, notify, echo_env, rich.
- add asks the client three things first (ping, roots/list, an unknown
  method) and only answers if the replies are right.
- tools/list is paginated (two pages) to test nextCursor.
"""
import json
import os
import sys

state = {"extra": False}

ADD = {
    "name": "add",
    "description": "Add two numbers",
    "inputSchema": {
        "type": "object",
        "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
        "required": ["a", "b"],
    },
}
OTHERS = [
    {"name": "fail", "description": "Always fails", "inputSchema": {"type": "object"}},
    {"name": "crash", "description": "Exits with code 3"},
    {"name": "notify", "description": "Adds a tool and sends list_changed"},
    {"name": "echo_env", "description": "Returns FIXTURE_VAR"},
    {"name": "rich", "description": "Returns mixed content"},
]
EXTRA = {"name": "extra", "description": "Appears after notify"}


def send(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def read_msg():
    while True:
        line = sys.stdin.readline()
        if not line:
            sys.exit(0)  # stdin closed: exit like real servers
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except ValueError:
            continue


def ask_client(req_id, method):
    """Send a request to the client and wait for its reply (handles nothing else)."""
    send({"jsonrpc": "2.0", "id": req_id, "method": method})
    while True:
        msg = read_msg()
        if msg.get("id") == req_id and "method" not in msg:
            return msg


def text(t, is_error=False):
    out = {"content": [{"type": "text", "text": t}]}
    if is_error:
        out["isError"] = True
    return out


def call_tool(params):
    name = params.get("name")
    args = params.get("arguments") or {}
    if name == "add":
        ping = ask_client("srv-ping", "ping")
        roots = ask_client("srv-roots", "roots/list")
        other = ask_client("srv-other", "sampling/createMessage")
        if ping.get("result") != {}:
            return text("bad ping reply: %s" % ping, True)
        if roots.get("result") != {"roots": []}:
            return text("bad roots reply: %s" % roots, True)
        if other.get("error", {}).get("code") != -32601:
            return text("bad unknown-method reply: %s" % other, True)
        total = args.get("a", 0) + args.get("b", 0)
        if float(total).is_integer():
            total = int(total)
        return text(str(total))
    if name == "fail":
        return text("boom", True)
    if name == "crash":
        sys.stderr.write("fatal: crashing now\n")
        sys.stderr.flush()
        os._exit(3)
    if name == "notify":
        state["extra"] = True
        send({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"})
        return text("ok")
    if name == "echo_env":
        return text(os.environ.get("FIXTURE_VAR", "<unset>"))
    if name == "rich":
        send({"jsonrpc": "2.0", "method": "notifications/message",
              "params": {"level": "info", "logger": "fixture", "data": "rich called"}})
        return {
            "content": [
                {"type": "text", "text": "Here"},
                {"type": "image", "data": "iVBORw0KGgo=", "mimeType": "image/png"},
                {"type": "resource_link", "uri": "file:///tmp/example.txt", "name": "example"},
            ]
        }
    return None


def main():
    # A banner on stdout that is not JSON: the client must ignore it.
    sys.stdout.write("fixture server starting (not JSON)\n")
    sys.stdout.flush()
    sys.stderr.write("fixture ready\n")
    sys.stderr.flush()
    while True:
        msg = read_msg()
        method = msg.get("method")
        msg_id = msg.get("id")
        if method is None or msg_id is None:
            continue  # notifications and stray responses
        if method == "initialize":
            result = {
                "protocolVersion": "2025-03-26",
                "capabilities": {"tools": {"listChanged": True}},
                "serverInfo": {"name": "fixture", "version": "1.2.3"},
            }
        elif method == "tools/list":
            cursor = (msg.get("params") or {}).get("cursor")
            if cursor is None:
                result = {"tools": [ADD], "nextCursor": "page-2"}
            else:
                tools = list(OTHERS)
                if state["extra"]:
                    tools.append(EXTRA)
                result = {"tools": tools}
        elif method == "tools/call":
            result = call_tool(msg.get("params") or {})
            if result is None:
                send({"jsonrpc": "2.0", "id": msg_id,
                      "error": {"code": -32602, "message": "Unknown tool"}})
                continue
        elif method == "ping":
            result = {}
        else:
            send({"jsonrpc": "2.0", "id": msg_id,
                  "error": {"code": -32601, "message": "Method not found"}})
            continue
        send({"jsonrpc": "2.0", "id": msg_id, "result": result})


if __name__ == "__main__":
    main()
