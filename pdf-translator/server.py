#!/usr/bin/env python3
"""Minimal HTTP wrapper around VI-Translate's translate_pdf.py.

One /translate in flight at a time is the intent — this container gets
one CPU's worth of budget on a small VPS, and the caller (tech-books-
backend's TranslationWorkerService) only ever has one book queued at a
time anyway, see docs/vi-translate.md. But that does NOT mean the whole
server should go single-threaded: a plain HTTPServer processes exactly
one connection at a time full stop, so a long /translate call (a real
book easily runs past 5+ minutes) makes even a trivial /health check
hang for the entire duration — confirmed the hard way with `curl
/health` sitting there unanswered while a translation was in flight.
ThreadingHTTPServer fixes that (each connection gets its own thread) —
the concurrency limit that actually matters is enforced Node-side
(TranslationWorkerService never sends a second /translate while one is
running), not by however many threads this process happens to have.

No framework (no FastAPI/uvicorn) — stdlib only. This is two routes and
one subprocess call; a dependency here would just be one more thing that
can drift out of sync with whatever's actually pinned in requirements.txt.
"""
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VI_TRANSLATE_DIR = Path(__file__).resolve().parent / "vi-translate"
SCRIPT = VI_TRANSLATE_DIR / "scripts" / "translate_pdf.py"
PORT = 8787

# a book-length PDF through the "google" engine is minutes, not seconds —
# see VI-Translate's own README benchmark (8 pages: 27-48s depending on
# thread count) — but this is a hard ceiling against something hanging
# forever, not the expected case
TIMEOUT_SECONDS = 30 * 60


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True})
            return
        self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/translate":
            self._send_json(404, {"ok": False, "error": "not found"})
            return

        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._send_json(400, {"ok": False, "error": "invalid JSON body"})
            return

        input_path = body.get("inputPath")
        output_dir = body.get("outputDir")
        if not input_path or not output_dir:
            self._send_json(
                400,
                {"ok": False, "error": "inputPath and outputDir are both required"},
            )
            return
        if not Path(input_path).is_file():
            self._send_json(400, {"ok": False, "error": f"no such file: {input_path}"})
            return

        # engine defaults to "google" (translate_pdf.py's own default) —
        # deliberate: keeps this service fully self-contained with no LLM
        # API key of its own. See docs/vi-translate.md for why (Gemini's
        # quota/budget in this app stays reserved for the chatbot).
        try:
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    input_path,
                    "--output-dir",
                    output_dir,
                    "--overwrite",
                ],
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            self._send_json(
                504,
                {"ok": False, "error": f"translate_pdf.py did not finish within {TIMEOUT_SECONDS}s"},
            )
            return

        if result.returncode != 0:
            # translate_pdf.py prints the actual reason to stderr on
            # failure (see its `except TranslationError` branch) — that's
            # the useful part, not a Python traceback, so surface it
            # as-is rather than a generic "translation failed"
            message = (result.stderr or result.stdout or "translate_pdf.py exited non-zero").strip()
            self._send_json(500, {"ok": False, "error": message[-4000:]})
            return

        produced = sorted(Path(output_dir).glob("*-vi.pdf"))
        if not produced:
            self._send_json(
                500,
                {
                    "ok": False,
                    "error": "translate_pdf.py exited 0 but produced no *-vi.pdf file",
                    "stdout": result.stdout[-2000:],
                },
            )
            return

        self._send_json(200, {"ok": True, "outputPath": str(produced[0])})

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        # `docker logs` already captures stdout for this container; the
        # default per-request access log is just noise for a service with
        # exactly one caller
        pass


if __name__ == "__main__":
    print(f"pdf-translator listening on :{PORT}", flush=True)
    # daemon_threads so a still-running /translate thread never blocks
    # the process from exiting on shutdown (docker stop, restart, ...)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()
