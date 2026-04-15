from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import urllib.request
import urllib.error


GEMINI_MODELS = [
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
]


def _json(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def _call_gemini(key: str, model: str, prompt: str, max_tokens: int) -> tuple[int, dict]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.7},
    }
    req = urllib.request.Request(
        url,
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps(body).encode("utf-8"),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return 502, {"error": {"message": "Invalid JSON from Gemini"}}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="ignore") if e.fp else ""
        try:
            return e.code, json.loads(raw) if raw else {"error": {"message": f"Gemini HTTP {e.code}"}}
        except json.JSONDecodeError:
            return e.code, {"error": {"message": f"Gemini HTTP {e.code}"}}
    except Exception as e:
        return 502, {"error": {"message": str(e)}}


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 (stdlib naming)
        if self.path != "/api/gemini":
            _json(self, 404, {"error": {"message": "Not found"}})
            return

        key = os.environ.get("GEMINI_KEY", "").strip()
        if not key:
            _json(self, 500, {"error": {"message": "Server missing GEMINI_KEY env var"}})
            return

        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            data = json.loads(raw.decode("utf-8", errors="ignore") or "{}")
        except json.JSONDecodeError:
            _json(self, 400, {"error": {"message": "Invalid JSON body"}})
            return

        prompt = str(data.get("prompt") or "").strip()
        max_tokens = int(data.get("maxTokens") or 1024)
        if not prompt:
            _json(self, 400, {"error": {"message": "prompt is required"}})
            return
        if max_tokens < 1:
            max_tokens = 1
        if max_tokens > 4096:
            max_tokens = 4096

        last_error = None
        for model in GEMINI_MODELS:
            status, resp = _call_gemini(key, model, prompt, max_tokens)
            if 200 <= status < 300:
                text = (
                    resp.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                _json(self, 200, {"text": text, "model": model})
                return

            # If rate-limited, try next model; otherwise return the error
            last_error = {"status": status, "resp": resp, "model": model}
            if status == 429:
                continue
            _json(self, status, {"error": resp.get("error") or resp, "model": model})
            return

        _json(self, 429, {"error": {"message": "Rate limited on all models", "detail": last_error}})


def main() -> None:
    host = "127.0.0.1"
    port = 5173
    print(f"Serving on http://{host}:{port}")
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.serve_forever()


if __name__ == "__main__":
    main()

