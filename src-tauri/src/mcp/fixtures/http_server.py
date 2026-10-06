#!/usr/bin/env python3
"""Tiny MCP Streamable HTTP server for fmGUI tests.

Prints the port on the first stdout line. Endpoints:
  POST /mcp     MCP (JSON answers; tools/call "add" answers with an SSE stream)
  DELETE /mcp   ends the session
  POST /old     405, like an old HTTP+SSE server
  GET /stats    counters for the test
Requests to /mcp need the header X-Test-Token: test-token-123.
"""
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

lock = threading.Lock()
stats = {"inits": 0, "pings": 0, "deletes": 0, "bad_version": 0}
sessions = set()

TOOLS = [
    {"name": "add", "description": "Add two numbers",
     "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}}},
    {"name": "expire", "description": "Forget all sessions"},
]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code, body=None, headers=None, content_type="application/json"):
        data = b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/stats":
            with lock:
                self.reply(200, dict(stats, sessions=len(sessions)))
        else:
            self.reply(405, b"Method Not Allowed", content_type="text/plain")

    def do_DELETE(self):
        sid = self.headers.get("Mcp-Session-Id")
        with lock:
            if sid in sessions:
                sessions.discard(sid)
                stats["deletes"] += 1
        self.reply(200)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"null")
        if self.path == "/old":
            self.reply(405, b"Method Not Allowed", content_type="text/plain")
            return
        if self.path != "/mcp":
            self.reply(404, b"Not Found", content_type="text/plain")
            return
        if self.headers.get("X-Test-Token") != "test-token-123":
            self.reply(401, b"Unauthorized", content_type="text/plain")
            return
        accept = self.headers.get("Accept", "")
        if "application/json" not in accept or "text/event-stream" not in accept:
            self.reply(406, b"Bad Accept header", content_type="text/plain")
            return

        # A reply from the client to our ping.
        if isinstance(body, dict) and "method" not in body:
            if body.get("id") == "srv-ping" and body.get("result") == {}:
                with lock:
                    stats["pings"] += 1
            self.reply(202)
            return

        method = body.get("method")
        if method == "initialize":
            with lock:
                stats["inits"] += 1
                sid = "session-%d" % stats["inits"]
                sessions.add(sid)
            result = {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "http-fixture", "version": "0.9.0"},
            }
            self.reply(200, {"jsonrpc": "2.0", "id": body["id"], "result": result}, {"Mcp-Session-Id": sid})
            return

        sid = self.headers.get("Mcp-Session-Id")
        if sid is None:
            self.reply(400, {"jsonrpc": "2.0", "id": None,
                             "error": {"code": -32000, "message": "Missing session id"}})
            return
        with lock:
            known = sid in sessions
        if not known:
            self.reply(404, b"Session not found", content_type="text/plain")
            return
        if self.headers.get("MCP-Protocol-Version") != "2025-06-18":
            with lock:
                stats["bad_version"] += 1
            self.reply(400, b"Bad protocol version", content_type="text/plain")
            return
        if "id" not in body:
            self.reply(202)  # notification
            return

        msg_id = body["id"]
        if method == "tools/list":
            self.reply(200, {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}})
        elif method == "tools/call":
            name = body["params"]["name"]
            args = body["params"].get("arguments") or {}
            if name == "add":
                self.stream_add(msg_id, args)
            elif name == "expire":
                with lock:
                    sessions.clear()
                self.reply(200, {"jsonrpc": "2.0", "id": msg_id,
                                 "result": {"content": [{"type": "text", "text": "ok"}]}})
            else:
                self.reply(200, {"jsonrpc": "2.0", "id": msg_id,
                                 "error": {"code": -32602, "message": "Unknown tool"}})
        else:
            self.reply(200, {"jsonrpc": "2.0", "id": msg_id,
                             "error": {"code": -32601, "message": "Method not found"}})

    def stream_add(self, msg_id, args):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def event(obj):
            return ("event: message\ndata: %s\n\n" % json.dumps(obj)).encode()

        log = {"jsonrpc": "2.0", "method": "notifications/message",
               "params": {"level": "info", "data": "adding"}}
        ping = {"jsonrpc": "2.0", "id": "srv-ping", "method": "ping"}
        total = args.get("a", 0) + args.get("b", 0)
        if float(total).is_integer():
            total = int(total)
        result = {"jsonrpc": "2.0", "id": msg_id,
                  "result": {"content": [{"type": "text", "text": str(total)}]}}
        self.wfile.write(b": keep-alive\n\n" + event(log))
        self.wfile.flush()
        self.wfile.write(event(ping))
        self.wfile.flush()
        time.sleep(0.2)
        data = event(result)
        half = len(data) // 2
        self.wfile.write(data[:half])
        self.wfile.flush()
        time.sleep(0.05)
        self.wfile.write(data[half:])
        self.wfile.flush()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    sys.stdout.write("%d\n" % server.server_address[1])
    sys.stdout.flush()
    # Stop when the test closes our stdin.
    threading.Thread(target=server.serve_forever, daemon=True).start()
    sys.stdin.read()
    server.shutdown()


if __name__ == "__main__":
    main()
