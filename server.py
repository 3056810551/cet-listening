from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
MEDIA_SUFFIXES = {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac"}
APP_EXAMS = ("cet6", "cet4")
TRACK_ID_PATTERN = re.compile(r"^\d{4}-\d{1,2}-\d{1,2}$")
MAX_JSON_BYTES = 1024 * 1024
MAX_MARKDOWN_BYTES = 8 * 1024 * 1024
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_ADMIN_UPLOAD_MB", "600")) * 1024 * 1024
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


class ListeningHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if self.is_admin_entry(parsed.path):
            if not self.require_local_admin():
                return
            self.serve_admin()
            return
        if self.is_admin_api(parsed.path):
            if not self.require_local_admin():
                return
            self.handle_admin_get(parsed)
            return
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
        if self.is_admin_entry(parsed.path):
            if not self.require_local_admin():
                return
            self.serve_admin(head_only=True)
            return
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

    def do_POST(self):
        parsed = urlparse(self.path)
        if self.is_admin_api(parsed.path):
            if not self.require_local_admin():
                return
            self.handle_admin_post(parsed)
            return
        self.send_error(404, "File not found")

    def is_root_request(self, request_path):
        return request_path in {"", "/"}

    def is_app_entry(self, request_path):
        return re.fullmatch(r"/(?:cet6|cet4)(?:/[^/.]+)?/?", request_path) is not None

    def is_admin_entry(self, request_path):
        return request_path in {"/admin", "/admin/"}

    def is_admin_api(self, request_path):
        return request_path == "/api/admin/status" or request_path.startswith(
            "/api/admin/",
        )

    def serve_index(self, head_only=False):
        file_path = ROOT / "index.html"
        self.serve_file(file_path, head_only=head_only)

    def serve_admin(self, head_only=False):
        file_path = ROOT / "admin.html"
        self.serve_file(file_path, head_only=head_only)

    def serve_file(self, file_path, head_only=False):
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

    def require_local_admin(self):
        if os.environ.get("ALLOW_REMOTE_ADMIN") == "1":
            return True

        client_host = self.client_address[0]
        if client_host == "::1" or client_host.startswith("127."):
            return True

        self.send_json(
            {
                "error": "管理界面默认只允许本机访问。需要局域网访问时请设置 ALLOW_REMOTE_ADMIN=1。",
            },
            status=403,
        )
        return False

    def handle_admin_get(self, parsed):
        if parsed.path == "/api/admin/status":
            self.send_json(build_admin_status())
            return

        job_match = re.fullmatch(r"/api/admin/jobs/([0-9a-f-]+)", parsed.path)
        if job_match:
            job = get_job(job_match.group(1))
            if not job:
                self.send_json({"error": "任务不存在。"}, status=404)
                return
            self.send_json(job)
            return

        self.send_json({"error": "未知管理接口。"}, status=404)

    def handle_admin_post(self, parsed):
        if parsed.path == "/api/admin/run":
            payload = self.read_json_body()
            if payload is None:
                return
            try:
                job = start_admin_job(payload)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
                return
            self.send_json(job, status=202)
            return

        if parsed.path == "/api/admin/save-markdown":
            payload = self.read_json_body(max_bytes=MAX_MARKDOWN_BYTES)
            if payload is None:
                return
            try:
                result = save_markdown_payload(payload)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
                return
            self.send_json(result)
            return

        if parsed.path == "/api/admin/upload":
            try:
                result = self.handle_admin_upload(parsed)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
                return
            self.send_json(result)
            return

        self.send_json({"error": "未知管理接口。"}, status=404)

    def handle_admin_upload(self, parsed):
        params = parse_qs(parsed.query)
        kind = first_query_value(params, "kind")
        exam = normalize_exam(first_query_value(params, "exam"))
        track_id = validate_track_id(first_query_value(params, "id"))
        force = parse_bool(first_query_value(params, "force"))
        original_name = self.headers.get("X-File-Name", "")

        if kind not in {"audio", "markdown"}:
            raise ValueError("上传类型只能是 audio 或 markdown。")

        content_length = parse_content_length(self.headers.get("Content-Length"))
        if content_length <= 0:
            raise ValueError("上传内容为空。")
        if content_length > MAX_UPLOAD_BYTES:
            limit_mb = MAX_UPLOAD_BYTES // 1024 // 1024
            raise ValueError(f"上传文件太大，当前限制为 {limit_mb} MB。")

        target = upload_target_path(kind, exam, track_id, original_name)
        if target.exists() and not force:
            raise ValueError(f"{relative_path(target)} 已存在，请勾选覆盖后再上传。")

        target.parent.mkdir(parents=True, exist_ok=True)
        temp_path = target.with_name(f".{target.name}.{uuid.uuid4().hex}.part")

        remaining = content_length
        try:
            with temp_path.open("wb") as file:
                while remaining > 0:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    file.write(chunk)
                    remaining -= len(chunk)

            if remaining != 0:
                raise ValueError("上传中断，文件没有保存。")

            temp_path.replace(target)
        finally:
            if temp_path.exists():
                temp_path.unlink()

        return {
            "ok": True,
            "path": relative_path(target),
            "size": target.stat().st_size,
        }

    def read_json_body(self, max_bytes=MAX_JSON_BYTES):
        content_length = parse_content_length(self.headers.get("Content-Length"))
        if content_length <= 0:
            self.send_json({"error": "请求内容为空。"}, status=400)
            return None
        if content_length > max_bytes:
            self.send_json({"error": "请求内容太大。"}, status=413)
            return None

        raw = self.rfile.read(content_length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json({"error": "JSON 格式不正确。"}, status=400)
            return None

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def translate_path(self, path):
        parsed = urlparse(path)
        request_path = parsed.path or "/"
        stripped = self.strip_exam_prefix(request_path)

        return super().translate_path(stripped)

    def strip_exam_prefix(self, request_path):
        for exam in APP_EXAMS:
            prefix = f"/{exam}"
            if request_path == prefix or request_path == f"{prefix}/":
                return "/"
            if request_path.startswith(f"{prefix}/"):
                return request_path[len(prefix):]
        return request_path

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


def build_admin_status():
    tracks = read_tracks()
    enriched_tracks = [enrich_track(track) for track in tracks]
    counts = {
        exam: {
            "total": 0,
            "available": 0,
            "missingAudio": 0,
            "missingTranscript": 0,
            "missingTimings": 0,
        }
        for exam in APP_EXAMS
    }

    for track in enriched_tracks:
        exam_counts = counts.setdefault(
            track["exam"],
            {
                "total": 0,
                "available": 0,
                "missingAudio": 0,
                "missingTranscript": 0,
                "missingTimings": 0,
            },
        )
        exam_counts["total"] += 1
        if track["available"]:
            exam_counts["available"] += 1
        if not track["files"]["audio"]:
            exam_counts["missingAudio"] += 1
        if not track["files"]["transcript"]:
            exam_counts["missingTranscript"] += 1
        if not track["files"]["timings"]:
            exam_counts["missingTimings"] += 1

    return {
        "root": str(ROOT),
        "limits": {
            "uploadMb": MAX_UPLOAD_BYTES // 1024 // 1024,
        },
        "tools": {
            "python": sys.version.split()[0],
            "ffprobe": bool(shutil.which("ffprobe")),
            "fasterWhisper": importlib.util.find_spec("faster_whisper") is not None,
        },
        "directories": {
            "audio": directory_summary(ROOT / "audio"),
            "transcripts": directory_summary(ROOT / "transcripts"),
            "dataTools": directory_summary(ROOT / "data_tools"),
        },
        "combinedInputs": combined_input_files(),
        "counts": counts,
        "tracks": enriched_tracks,
        "jobs": list_jobs(),
    }


def read_tracks():
    path = ROOT / "tracks.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def enrich_track(track):
    exam = normalize_exam(track.get("exam"))
    track_id = str(track.get("id", ""))
    markdown = str(track.get("markdown") or f"transcripts/{exam}/{track_id}.md")
    transcript = str(track.get("transcript") or f"transcripts/{exam}/{track_id}.transcript.json")
    timings = str(track.get("timings") or f"transcripts/{exam}/{track_id}.timings.json")
    audio = str(track.get("audio") or f"audio/{exam}/{track_id}.mp3")

    file_map = {
        "markdown": relative_file_exists(markdown),
        "audio": relative_file_exists(audio),
        "transcript": relative_file_exists(transcript),
        "timings": relative_file_exists(timings),
    }

    return {
        **track,
        "exam": exam,
        "id": track_id,
        "title": track.get("title") or track_id,
        "markdown": markdown,
        "audio": audio,
        "transcript": transcript,
        "timings": timings,
        "available": bool(file_map["markdown"] and file_map["audio"] and file_map["transcript"] and file_map["timings"]),
        "files": file_map,
    }


def directory_summary(path):
    return {
        "path": relative_path(path),
        "exists": path.exists(),
        "fileCount": sum(1 for item in path.rglob("*") if item.is_file()) if path.exists() else 0,
    }


def combined_input_files():
    data_tools = ROOT / "data_tools"
    if not data_tools.exists():
        return []
    return [
        {
            "path": relative_path(path),
            "name": path.name,
            "size": path.stat().st_size,
        }
        for path in sorted(data_tools.glob("*.md"))
    ]


def relative_file_exists(path):
    try:
        return resolve_relative_path(path).is_file()
    except ValueError:
        return False


def save_markdown_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError("请求内容不正确。")

    exam = normalize_exam(payload.get("exam"))
    track_id = validate_track_id(payload.get("id"))
    content = payload.get("content")
    force = parse_bool(payload.get("force"))

    if not isinstance(content, str) or not content.strip():
        raise ValueError("原文内容不能为空。")

    encoded = content.encode("utf-8")
    if len(encoded) > MAX_MARKDOWN_BYTES:
        raise ValueError("原文内容太大。")

    target = ROOT / "transcripts" / exam / f"{track_id}.md"
    if target.exists() and not force:
        raise ValueError(f"{relative_path(target)} 已存在，请勾选覆盖后再保存。")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")
    return {"ok": True, "path": relative_path(target), "size": target.stat().st_size}


def start_admin_job(payload):
    if not isinstance(payload, dict):
        raise ValueError("请求内容不正确。")

    commands, label = build_job_commands(payload)
    env = build_job_env(payload.get("env") or {})
    job_id = uuid.uuid4().hex
    job = {
        "id": job_id,
        "label": label,
        "status": "queued",
        "returnCode": None,
        "startedAt": int(time.time()),
        "completedAt": None,
        "elapsedSeconds": None,
        "commands": [format_command(command) for command in commands],
        "log": [],
    }

    with JOBS_LOCK:
        JOBS[job_id] = job

    thread = threading.Thread(
        target=run_admin_job,
        args=(job_id, commands, env),
        daemon=True,
    )
    thread.start()
    return job


def build_job_commands(payload):
    task = payload.get("task")
    force = parse_bool(payload.get("force"))
    commands = []

    if task == "scan":
        command = [sys.executable, "data_tools/scan.py"]
        exam = payload.get("exam")
        if exam and exam != "all":
            command.extend(["--exam", normalize_exam(exam)])
        if parse_bool(payload.get("generate")):
            command.append("--gen")
        if force:
            command.append("--force")
        return [command], "扫描题库"

    if task == "normalize":
        exam = normalize_exam(payload.get("exam"))
        source = resolve_markdown_input(payload.get("input") or "data_tools/0.md")
        year = validate_int(payload.get("year"), "年份")
        month = validate_int(payload.get("month"), "月份")
        command = [
            sys.executable,
            "data_tools/normalize_transcripts.py",
            relative_path(source),
            "--exam",
            exam,
            "--year",
            str(year),
            "--month",
            str(month),
        ]
        set_number = payload.get("set")
        if set_number not in (None, "", "all"):
            command.extend(["--set", str(validate_int(set_number, "套数"))])
        if force:
            command.append("--force")
        return [command], "拆分整合原文"

    if task in {"transcript", "timings"}:
        exam = normalize_exam(payload.get("exam"))
        track_id = validate_track_id(payload.get("trackId") or payload.get("id"))
        markdown = ROOT / "transcripts" / exam / f"{track_id}.md"
        if not markdown.exists():
            raise ValueError(f"{relative_path(markdown)} 不存在。")

        command = [
            sys.executable,
            "data_tools/timings.py",
            relative_path(markdown),
        ]

        if task == "transcript":
            command.append("--transcript-only")
            label = "生成标准化原文"
        else:
            audio = resolve_audio_for_track(exam, track_id)
            if not audio.exists():
                raise ValueError(f"{relative_path(audio)} 不存在。")
            command.append(relative_path(audio))
            label = "生成单套时间轴"

        if force:
            command.append("--force")
        commands.append(command)

        if parse_bool(payload.get("refreshCatalog")):
            refresh = [sys.executable, "data_tools/scan.py", "--exam", exam]
            commands.append(refresh)
        return commands, label

    raise ValueError("未知任务类型。")


def build_job_env(overrides):
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"

    if not isinstance(overrides, dict):
        return env

    allowed = {
        "WHISPER_MODEL",
        "WHISPER_DEVICE",
        "WHISPER_COMPUTE_TYPE",
    }
    for key in allowed:
        value = overrides.get(key)
        if isinstance(value, str) and value.strip():
            env[key] = value.strip()
    return env


def run_admin_job(job_id, commands, env):
    started = time.time()
    update_job(job_id, status="running")
    return_code = 0

    for command in commands:
        append_job_log(job_id, f"$ {format_command(command)}")
        try:
            process = subprocess.Popen(
                command,
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
            )
        except OSError as error:
            append_job_log(job_id, f"启动失败：{error}")
            return_code = 1
            break

        update_job(job_id, pid=process.pid)
        assert process.stdout is not None
        for line in process.stdout:
            append_job_log(job_id, line.rstrip())
        return_code = process.wait()
        append_job_log(job_id, f"退出码：{return_code}")

        if return_code != 0:
            break

    completed = int(time.time())
    update_job(
        job_id,
        status="succeeded" if return_code == 0 else "failed",
        returnCode=return_code,
        completedAt=completed,
        elapsedSeconds=round(time.time() - started, 2),
        pid=None,
    )


def get_job(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        return dict(job) if job else None


def list_jobs():
    with JOBS_LOCK:
        jobs = list(JOBS.values())
    return [
        {
            "id": job["id"],
            "label": job["label"],
            "status": job["status"],
            "startedAt": job["startedAt"],
            "completedAt": job["completedAt"],
            "elapsedSeconds": job["elapsedSeconds"],
            "returnCode": job["returnCode"],
        }
        for job in sorted(jobs, key=lambda item: item["startedAt"], reverse=True)[:12]
    ]


def update_job(job_id, **updates):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job:
            job.update(updates)


def append_job_log(job_id, message):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job["log"].append(message)
        if len(job["log"]) > 3000:
            del job["log"][: len(job["log"]) - 3000]


def resolve_audio_for_track(exam, track_id):
    tracks = read_tracks()
    for track in tracks:
        if normalize_exam(track.get("exam")) == exam and track.get("id") == track_id:
            audio = track.get("audio")
            if audio:
                return resolve_relative_path(audio)
    return ROOT / "audio" / exam / f"{track_id}.mp3"


def upload_target_path(kind, exam, track_id, original_name):
    if kind == "markdown":
        return ROOT / "transcripts" / exam / f"{track_id}.md"

    suffix = Path(str(original_name)).suffix.lower()
    if suffix not in MEDIA_SUFFIXES:
        suffix = ".mp3"
    return ROOT / "audio" / exam / f"{track_id}{suffix}"


def resolve_markdown_input(value):
    path = resolve_relative_path(str(value))
    if path.suffix.lower() != ".md":
        raise ValueError("整合原文必须是 Markdown 文件。")
    if not path.exists():
        raise ValueError(f"{relative_path(path)} 不存在。")
    return path


def resolve_relative_path(value):
    if not value:
        raise ValueError("路径不能为空。")
    path = (ROOT / str(value)).resolve()
    if ROOT not in path.parents and path != ROOT:
        raise ValueError("路径必须位于项目目录内。")
    return path


def relative_path(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def normalize_exam(value):
    return value if value in APP_EXAMS else "cet6"


def validate_track_id(value):
    track_id = str(value or "").strip()
    if not TRACK_ID_PATTERN.fullmatch(track_id):
        raise ValueError("套题 ID 格式应为 YYYY-M-套数，例如 2026-6-1。")
    return track_id


def validate_int(value, label):
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label}必须是数字。") from None
    if number <= 0:
        raise ValueError(f"{label}必须大于 0。")
    return number


def first_query_value(params, key):
    values = params.get(key)
    return values[0] if values else None


def parse_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).lower() in {"1", "true", "yes", "on"}


def parse_content_length(value):
    try:
        return int(value or 0)
    except ValueError:
        return 0


def format_command(command):
    return " ".join(quote_command_part(part) for part in command)


def quote_command_part(part):
    text = str(part)
    if not text:
        return '""'
    if re.search(r"\s", text):
        return f'"{text}"'
    return text


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
    print(f"Local admin manager: http://127.0.0.1:{port}/admin/")
    print("Root path / is disabled. Open /cet6/ or /cet4/ directly.")
    print("Data tools are also available from /admin/ on this machine.")
    print("\n[IMPORTANT] If the page looks broken, please press Ctrl + F5 to force refresh your browser cache.")
    server.serve_forever()


if __name__ == "__main__":
    run()
