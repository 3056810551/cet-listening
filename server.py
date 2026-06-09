from __future__ import annotations

import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
LEGACY_APP_ROOT = ROOT
REACT_APP_ROOT = ROOT / "frontend" / "dist"
MEDIA_SUFFIXES = {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac"}
APP_EXAMS = {"cet6", "cet4"}


def get_requested_frontend_mode():
    return os.environ.get("FRONTEND_MODE", "legacy").strip().lower()


def get_active_frontend_mode():
    requested_mode = get_requested_frontend_mode()
    if requested_mode == "react" and (REACT_APP_ROOT / "index.html").is_file():
        return "react"
    return "legacy"


def get_app_index_path():
    if get_active_frontend_mode() == "react":
        return REACT_APP_ROOT / "index.html"
    return LEGACY_APP_ROOT / "index.html"


def get_static_roots():
    if get_active_frontend_mode() == "react":
        return [REACT_APP_ROOT, ROOT]
    return [ROOT]


class ListeningHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if self.is_root_request(parsed.path):
            self.send_error(404, "File not found")
            return
        if self.is_app_entry(parsed.path):
            self.serve_index()
            return
        if self.is_media_request(parsed.path):
            self.handle_media(parsed, head_only=False)
            return
        super().do_GET()

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if self.is_root_request(parsed.path):
            self.send_error(404, "File not found")
            return
        if self.is_app_entry(parsed.path):
            self.serve_index(head_only=True)
            return
        if self.is_media_request(parsed.path):
            self.handle_media(parsed, head_only=True)
            return
        super().do_HEAD()

    def is_root_request(self, request_path):
        return request_path in {"", "/"}

    def is_app_entry(self, request_path):
        return re.fullmatch(r"/(?:cet6|cet4)(?:/[^/.]+)?/?", request_path) is not None

    def serve_index(self, head_only=False):
        file_path = get_app_index_path()
        if not file_path.is_file():
            self.send_error(404, "File not found")
            return

        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(file_path)))
        self.send_header("Content-Length", str(file_path.stat().st_size))
        self.end_headers()

        if head_only:
            return

        with file_path.open("rb") as file:
            self.copyfile(file, self.wfile)

    def translate_path(self, path):
        parsed = urlparse(path)
        request_path = parsed.path or "/"
        relative_path = self.get_relative_static_path(request_path)

        for static_root in get_static_roots():
            candidate = self.safe_join(static_root, relative_path)
            if candidate.exists():
                return str(candidate)

        return str(self.safe_join(ROOT, relative_path))

    def strip_exam_prefix(self, request_path):
        for exam in APP_EXAMS:
            prefix = f"/{exam}"
            if request_path == prefix or request_path == f"{prefix}/":
                return "/"
            if request_path.startswith(f"{prefix}/"):
                return request_path[len(prefix):]
        return request_path

    def get_relative_static_path(self, request_path):
        stripped = self.strip_exam_prefix(request_path)
        parts = []
        for part in PurePosixPath(unquote(stripped)).parts:
            if part in {"", "/", ".", ".."}:
                continue
            parts.append(part)
        return Path(*parts)

    def safe_join(self, root, relative_path):
        root_path = Path(root).resolve()
        candidate = (root_path / relative_path).resolve()
        try:
            candidate.relative_to(root_path)
        except ValueError:
            return root_path
        return candidate

    def is_media_request(self, request_path):
        return Path(request_path).suffix.lower() in MEDIA_SUFFIXES

    def handle_media(self, parsed, head_only=False):
        file_path = Path(self.translate_path(parsed.path))
        if not file_path.is_file():
            self.send_error(404, "File not found")
            return

        file_size = file_path.stat().st_size
        byte_range = parse_range(self.headers.get("Range"), file_size)

        if byte_range == "invalid":
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{file_size}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if byte_range:
            start, end = byte_range
            status = 206
            content_length = end - start + 1
        else:
            start, end = 0, file_size - 1
            status = 200
            content_length = file_size

        self.send_response(status)
        self.send_header("Content-Type", self.guess_type(str(file_path)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(content_length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()

        if head_only:
            return

        with file_path.open("rb") as file:
            file.seek(start)
            remaining = content_length
            while remaining > 0:
                chunk = file.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                    return
                remaining -= len(chunk)

    def log_message(self, format, *args):
        print("[%s] %s" % (self.log_date_time_string(), format % args))


def parse_range(range_header, file_size):
    if not range_header:
        return None
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
    if not match:
        return "invalid"

    start_text, end_text = match.groups()
    if not start_text and not end_text:
        return "invalid"

    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1
    else:
        suffix_length = int(end_text)
        if suffix_length <= 0:
            return "invalid"
        start = max(0, file_size - suffix_length)
        end = file_size - 1

    if start >= file_size or end < start:
        return "invalid"

    return start, min(end, file_size - 1)


def run():
    start_port = int(os.environ.get("PORT", "5173"))
    requested_mode = get_requested_frontend_mode()
    active_mode = get_active_frontend_mode()
    server = None
    port = start_port

    for candidate in range(start_port, start_port + 50):
        try:
            server = ThreadingHTTPServer(("0.0.0.0", candidate), ListeningHandler)
            port = candidate
            break
        except OSError:
            continue

    if server is None:
        raise RuntimeError("No available local port found.")

    print(f"CET-6 listening player: http://0.0.0.0:{port}/cet6/")
    print(f"CET-4 listening player: http://0.0.0.0:{port}/cet4/")
    print("Root path / is disabled. Open /cet6/ or /cet4/ directly.")
    if requested_mode == "react" and active_mode != "react":
        print("Frontend mode: legacy (React build not found, fallback applied)")
    elif active_mode == "react":
        print(f"Frontend mode: react ({REACT_APP_ROOT})")
    else:
        print("Frontend mode: legacy")
    print("Static server only. Generate timings locally with: python data_tools/scan.py --gen")
    print("\n[IMPORTANT] If the page looks broken, please press Ctrl + F5 to force refresh your browser cache.")
    server.serve_forever()


if __name__ == "__main__":
    run()
