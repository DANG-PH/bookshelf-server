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
import os
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VI_TRANSLATE_DIR = Path(__file__).resolve().parent / "vi-translate"
SCRIPT = VI_TRANSLATE_DIR / "scripts" / "translate_pdf.py"
PORT = 8787

# 30 minutes turned out nowhere near enough for a real book — pdf2zh's own
# converter.py says it plainly: "A book is thousands of segments over tens
# of minutes" is the NORMAL case, before even counting Google throttling.
# When Google does throttle, each segment retries up to 8 times with
# exponential backoff (max 60s/attempt — see converter.py's
# request_translation), so a throttled run can run well past an hour.
# 3 hours (10800s) default, overridable via .env — keep it in sync with
# docker-compose.yml's PDF_TRANSLATOR_TIMEOUT_SECONDS and the backend's
# own copy of the same variable (src/config/env.validation.ts), all three
# meant to be the exact same number
TIMEOUT_SECONDS = int(os.environ.get("PDF_TRANSLATOR_TIMEOUT_SECONDS", 3 * 60 * 60))

# translate_pdf.py exits 0 and writes a real PDF even when every single
# segment failed translation (its own resilience: a formula/font/network
# failure never throws the whole document away, just leaves that segment
# in the source language) — confirmed the hard way: a run where Google and
# MyMemory were both already dead the whole time still came back "ok" with
# a PDF that was, in substance, still 100% English. exit code and "a file
# exists" are both useless signals for whether translation actually
# happened; this is the threshold above which "some untranslated segments"
# stops being normal wear (a stray formula, an oversized paragraph) and
# starts meaning "the translation backend was down for most/all of this
# run" — see UNTRANSLATED_RE below, matched against the line
# scripts/translate_pdf.py's main() always prints.
UNTRANSLATED_FAILURE_THRESHOLD = 50
UNTRANSLATED_RE = re.compile(r"Untranslated segments:\s*(\d+)")


# reads one pipe line by line, both printing it to *this* process's own
# stdout (so `docker compose logs -f pdf-translator` shows it live — a
# translate_pdf.py that was still legitimately working looked identical
# to one silently hung before this, since subprocess.run(capture_output=
# True) buffers everything until the process exits or times out) and
# appending it to `into` for the final HTTP response's error text
def _pump(pipe, prefix: str, into: list) -> None:
    for line in iter(pipe.readline, ""):
        into.append(line)
        print(f"[{prefix}] {line.rstrip()}", flush=True)
    pipe.close()


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
        #
        # Popen + manual pipe-pumping instead of subprocess.run(
        # capture_output=True) — see _pump()'s comment: the old version
        # gave zero visibility into whether a long-running job was still
        # actually progressing or had quietly wedged.
        proc = subprocess.Popen(
            [
                sys.executable,
                str(SCRIPT),
                input_path,
                "--output-dir",
                output_dir,
                "--overwrite",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        stdout_lines: list = []
        stderr_lines: list = []
        out_thread = threading.Thread(
            target=_pump, args=(proc.stdout, "translate", stdout_lines), daemon=True
        )
        err_thread = threading.Thread(
            target=_pump, args=(proc.stderr, "translate:err", stderr_lines), daemon=True
        )
        out_thread.start()
        err_thread.start()

        try:
            returncode = proc.wait(timeout=TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            out_thread.join(timeout=5)
            err_thread.join(timeout=5)
            self._send_json(
                504,
                {
                    "ok": False,
                    "error": f"translate_pdf.py did not finish within {TIMEOUT_SECONDS}s",
                    # whatever it printed before being killed — the real
                    # diagnostic now, instead of nothing at all
                    "stdoutTail": "".join(stdout_lines)[-4000:],
                    "stderrTail": "".join(stderr_lines)[-4000:],
                },
            )
            return

        out_thread.join(timeout=5)
        err_thread.join(timeout=5)
        stdout_text = "".join(stdout_lines)
        stderr_text = "".join(stderr_lines)

        if returncode != 0:
            # translate_pdf.py prints the actual reason to stderr on
            # failure (see its `except TranslationError` branch) — that's
            # the useful part, not a Python traceback, so surface it
            # as-is rather than a generic "translation failed"
            message = (stderr_text or stdout_text or "translate_pdf.py exited non-zero").strip()
            self._send_json(500, {"ok": False, "error": message[-4000:]})
            return

        produced = sorted(Path(output_dir).glob("*-vi.pdf"))
        if not produced:
            self._send_json(
                500,
                {
                    "ok": False,
                    "error": "translate_pdf.py exited 0 but produced no *-vi.pdf file",
                    "stdout": stdout_text[-2000:],
                },
            )
            return

        untranslated_match = UNTRANSLATED_RE.search(stdout_text)
        untranslated_count = int(untranslated_match.group(1)) if untranslated_match else None
        if untranslated_count is not None and untranslated_count > UNTRANSLATED_FAILURE_THRESHOLD:
            # exited 0, a PDF exists — by translate_pdf.py's own contract
            # that's a "success". But if almost nothing actually got
            # translated, calling it done here would let the caller mark
            # the book permanently finished (see TranslationWorkerService/
            # BooksService.queueTranslation: a 'done' book can never be
            # auto-retriggered again) over a PDF that's still substantially
            # in the source language — worse than just failing outright,
            # since failing at least allows a retry once the underlying
            # cause (translation backends being down) is resolved.
            produced[0].unlink(missing_ok=True)
            self._send_json(
                422,  # valid request, tool ran fine, result just isn't usable
                {
                    "ok": False,
                    "error": (
                        f"{untranslated_count} segments stayed untranslated "
                        f"(over the {UNTRANSLATED_FAILURE_THRESHOLD}-segment threshold) — "
                        "translate_pdf.py finished without error, but this isn't a "
                        "usable translation"
                    ),
                    "stderrTail": stderr_text[-4000:],
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
