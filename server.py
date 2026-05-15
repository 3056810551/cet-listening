from __future__ import annotations

import json
import math
import os
import re
import subprocess
import time
from collections import defaultdict
from difflib import SequenceMatcher
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DEFAULT_MARKDOWN = "2025-12-1.md"
DEFAULT_AUDIO = "2025年12月六级听力音频第1套.mp3"
CACHE_VERSION = 2
MEDIA_SUFFIXES = {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac"}

MODEL_CACHE = {}


class Cet6Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/track":
            self.handle_track(parsed)
            return
        if self.is_media_request(parsed.path):
            self.handle_media(parsed, head_only=False)
            return
        super().do_GET()

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if self.is_media_request(parsed.path):
            self.handle_media(parsed, head_only=True)
            return
        super().do_HEAD()

    def handle_track(self, parsed):
        query = parse_qs(parsed.query)
        markdown_name = first(query.get("markdown"), DEFAULT_MARKDOWN)
        audio_name = first(query.get("audio"), DEFAULT_AUDIO)
        force = first(query.get("force"), "0") in {"1", "true", "yes"}

        try:
            markdown_path = safe_child(markdown_name)
            audio_path = safe_child(audio_name)
            payload = build_track(markdown_path, audio_path, force=force)
            self.send_json(payload)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

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


def first(values, fallback):
    if not values:
        return fallback
    return values[0] or fallback


def safe_child(name):
    path = (ROOT / name).resolve()
    if path != ROOT and ROOT not in path.parents:
        raise ValueError(f"Path escapes project folder: {name}")
    if not path.exists():
        raise FileNotFoundError(f"Missing file: {name}")
    return path


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


def build_track(markdown_path, audio_path, force=False):
    sections, lines = parse_markdown(markdown_path.read_text(encoding="utf-8-sig"))
    cache_path = markdown_path.with_name(f"{markdown_path.stem}.timings.json")
    source = source_metadata(markdown_path, audio_path)
    model_name = os.environ.get("WHISPER_MODEL", "base.en")
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

    if not force and cache_path.exists():
        cached = read_timings_file(cache_path)
        if cached:
            return with_current_transcript(cached, sections, lines, cached=True)

    payload = generate_track(markdown_path, audio_path, sections, lines, source, model_name, device, compute_type)
    cache_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def read_timings_file(cache_path):
    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    if not isinstance(data.get("lines"), list):
        return None
    return data


def with_current_transcript(data, sections, lines, cached):
    rows = data.get("lines", [])
    by_id = {row.get("id"): row for row in rows if isinstance(row, dict)}

    for index, line in enumerate(lines):
        timing = by_id.get(line["id"]) or (rows[index] if index < len(rows) else {})
        line["start"] = float(timing.get("start", 0))
        line["end"] = float(timing.get("end", line["start"] + 1))

    result = dict(data)
    result["cached"] = cached
    result["sections"] = sections
    result["lines"] = lines
    return result


def generate_track(markdown_path, audio_path, sections, lines, source, model_name, device, compute_type):
    started = time.time()
    duration = ffprobe_duration(audio_path)
    mode = "faster-whisper"
    warning = None

    try:
        words, transcribe_meta = transcribe_words(audio_path, model_name, device, compute_type)
        if words:
            apply_aligned_timings(lines, words, duration)
        else:
            mode = "estimated-fallback"
            warning = "Whisper returned no word timestamps; used text-length estimate."
            apply_estimated_timings(lines, duration)
            transcribe_meta = {"word_count": 0}
    except Exception as exc:
        mode = "estimated-fallback"
        warning = f"Whisper failed, used text-length estimate: {exc}"
        transcribe_meta = {"error": str(exc)}
        apply_estimated_timings(lines, duration)

    return {
        "version": CACHE_VERSION,
        "audio": audio_path.name,
        "markdown": markdown_path.name,
        "duration": round(duration, 3),
        "source": source,
        "generatedAt": int(time.time()),
        "elapsedSeconds": round(time.time() - started, 2),
        "mode": mode,
        "model": model_name if mode == "faster-whisper" else None,
        "device": device if mode == "faster-whisper" else None,
        "computeType": compute_type if mode == "faster-whisper" else None,
        "warning": warning,
        "transcription": transcribe_meta,
        "cached": False,
        "sections": sections,
        "lines": lines,
    }


def source_metadata(markdown_path, audio_path):
    return {
        "markdown": file_metadata(markdown_path),
        "audio": file_metadata(audio_path),
    }


def file_metadata(path):
    stat = path.stat()
    return {
        "name": path.name,
        "size": stat.st_size,
        "mtimeNs": stat.st_mtime_ns,
    }


def parse_markdown(markdown):
    sections = []
    lines = []
    current_section = None

    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        heading = re.match(r"^##\s+(.+)", line)
        if heading:
            current_section = {
                "id": slugify(heading.group(1)),
                "title": heading.group(1).strip(),
                "firstLineId": None,
            }
            sections.append(current_section)
            continue

        if current_section is None:
            current_section = {
                "id": "intro",
                "title": "INTRO",
                "firstLineId": None,
            }
            sections.append(current_section)

        for item in split_transcript_line(clean_mojibake(line)):
            line_id = f"line-{len(lines)}"
            if current_section["firstLineId"] is None:
                current_section["firstLineId"] = line_id
            text = item["text"]
            lines.append({
                "id": line_id,
                "sectionId": current_section["id"],
                "sectionTitle": current_section["title"],
                "speaker": item["speaker"],
                "text": text,
                "type": item["type"],
                "words": count_words(text),
                "start": 0,
                "end": 0,
            })

    return sections, lines


def split_transcript_line(line):
    question = re.match(r"^(Q\d+\.)\s*(.+)$", line)
    if question:
        return [{
            "speaker": question.group(1),
            "text": question.group(2),
            "type": "question",
        }]

    speaker = re.match(r"^([A-Z]):\s*(.+)$", line)
    if speaker:
        return [{
            "speaker": f"{speaker.group(1)}:",
            "text": text,
            "type": "dialogue",
        } for text in split_sentences(speaker.group(2))]

    return [{
        "speaker": "",
        "text": text,
        "type": "narration",
    } for text in split_sentences(line)]


def split_sentences(text):
    normalized = re.sub(r"\s+", " ", text).strip()

    def guard_abbreviation(match):
        return match.group(0).replace(".", "__DOT__")

    guarded = re.sub(r"\b(?:[A-Z]\.){2,}", guard_abbreviation, normalized)
    guarded = re.sub(r"\b(Mr|Mrs|Ms|Dr|Prof|St|No|vs|etc)\.", r"\1__DOT__", guarded, flags=re.I)
    chunks = re.findall(r"[^.!?]+(?:[.!?]+[\"']?|$)", guarded) or [guarded]
    return [chunk.replace("__DOT__", ".").strip() for chunk in chunks if chunk.strip()]


def clean_mojibake(text):
    return (
        text
        .replace(" 鈥? ", " - ")
        .replace("鈥?", " - ")
        .replace("鈥檚", "'s")
        .replace("鈥檛", "'t")
        .replace("鈥檙", "'r")
        .replace("鈥渢", '"t')
        .replace("鈥", "'")
    )


def count_words(text):
    words = tokenize(text)
    return len(words) if words else max(1, math.ceil(len(text) / 4))


def slugify(text):
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", text.lower()))


def ffprobe_duration(audio_path):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def transcribe_words(audio_path, model_name, device, compute_type):
    from faster_whisper import WhisperModel

    key = (model_name, device, compute_type)

    if key not in MODEL_CACHE:
        print(f"Loading Whisper model {model_name} on {device} ({compute_type})...")
        MODEL_CACHE[key] = WhisperModel(model_name, device=device, compute_type=compute_type)

    model = MODEL_CACHE[key]
    segments, info = model.transcribe(
        str(audio_path),
        language="en",
        beam_size=5,
        word_timestamps=True,
        vad_filter=False,
        condition_on_previous_text=False,
    )

    words = []
    segment_count = 0
    for segment in segments:
        segment_count += 1
        if segment.words:
            for item in segment.words:
                for token in tokenize(item.word):
                    words.append({
                        "token": normalize_token(token),
                        "start": float(item.start),
                        "end": float(item.end),
                    })
        else:
            tokens = tokenize(segment.text)
            span = max(0.01, segment.end - segment.start)
            step = span / max(1, len(tokens))
            for index, token in enumerate(tokens):
                start = segment.start + index * step
                words.append({
                    "token": normalize_token(token),
                    "start": float(start),
                    "end": float(start + step),
                })

    return words, {
        "language": getattr(info, "language", "en"),
        "languageProbability": round(float(getattr(info, "language_probability", 0)), 4),
        "duration": round(float(getattr(info, "duration", 0)), 3),
        "segmentCount": segment_count,
        "wordCount": len(words),
    }


def apply_aligned_timings(lines, audio_words, duration):
    reference = []
    for line_index, line in enumerate(lines):
        for token in tokenize(line["text"]):
            reference.append({
                "token": normalize_token(token),
                "line": line_index,
            })

    if not reference:
        apply_estimated_timings(lines, duration)
        return

    matcher = SequenceMatcher(
        a=[item["token"] for item in reference],
        b=[item["token"] for item in audio_words],
        autojunk=False,
    )
    matched_by_line = defaultdict(list)

    for tag, ref_start, ref_end, audio_start, audio_end in matcher.get_opcodes():
        if tag != "equal":
            continue
        span = min(ref_end - ref_start, audio_end - audio_start)
        for offset in range(span):
            ref = reference[ref_start + offset]
            audio = audio_words[audio_start + offset]
            matched_by_line[ref["line"]].append((audio["start"], audio["end"]))

    starts = [None] * len(lines)
    match_counts = [0] * len(lines)

    for index, matches in matched_by_line.items():
        required = max(1, min(4, math.ceil(lines[index]["words"] * 0.25)))
        if len(matches) >= required:
            starts[index] = min(start for start, _ in matches)
            match_counts[index] = len(matches)

    starts = fill_missing_starts(lines, starts, duration)
    apply_starts(lines, starts, duration)

    for line, matches in zip(lines, match_counts):
        line["matchedWords"] = matches


def fill_missing_starts(lines, starts, duration):
    if not any(start is not None for start in starts):
        return estimated_starts(lines, duration)

    weights = [timing_weight(line) for line in lines]
    known = [index for index, start in enumerate(starts) if start is not None]
    filled = list(starts)

    first = known[0]
    if first > 0:
        fill_span(filled, weights, 0, first, 0.0, starts[first])

    for left, right in zip(known, known[1:]):
        if right - left > 1:
            fill_span(filled, weights, left, right, starts[left], starts[right])

    last = known[-1]
    if last < len(lines) - 1:
        fill_span(filled, weights, last, len(lines) - 1, starts[last], duration)

    return enforce_monotonic([0.0 if start is None else start for start in filled], duration)


def fill_span(starts, weights, left, right, left_time, right_time):
    if right <= left:
        return
    gap = max(0.01, right_time - left_time)
    total_weight = sum(weights[left:right]) or 1
    elapsed = 0

    for index in range(left + 1, right):
        elapsed += weights[index - 1]
        starts[index] = left_time + gap * (elapsed / total_weight)


def estimated_starts(lines, duration):
    weights = [timing_weight(line) for line in lines]
    total = sum(weights) or 1
    starts = []
    cursor = 0.0

    for weight in weights:
        starts.append(cursor)
        cursor += duration * (weight / total)

    return enforce_monotonic(starts, duration)


def apply_estimated_timings(lines, duration):
    apply_starts(lines, estimated_starts(lines, duration), duration)


def apply_starts(lines, starts, duration):
    for index, line in enumerate(lines):
        start = starts[index]
        end = starts[index + 1] if index + 1 < len(lines) else duration
        line["start"] = round(max(0.0, min(start, duration)), 3)
        line["end"] = round(max(line["start"] + 0.05, min(end, duration)), 3)


def enforce_monotonic(starts, duration):
    clean = []
    previous = -0.05

    for start in starts:
        value = max(0.0, min(float(start), duration))
        if value <= previous:
            value = previous + 0.05
        clean.append(min(value, duration))
        previous = clean[-1]

    return clean


def timing_weight(line):
    base = max(4, int(line.get("words", 4)))
    question_weight = 9 if line.get("type") == "question" else 0
    return base + question_weight


def tokenize(text):
    return re.findall(r"[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?", text)


def normalize_token(token):
    return re.sub(r"[^a-z0-9]", "", token.lower())


def run():
    start_port = int(os.environ.get("PORT", "5173"))
    server = None
    port = start_port

    for candidate in range(start_port, start_port + 50):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate), Cet6Handler)
            port = candidate
            break
        except OSError:
            continue

    if server is None:
        raise RuntimeError("No available local port found.")

    print(f"CET-6 listening player: http://127.0.0.1:{port}/")
    print("Backend endpoint: /api/track")
    print("Whisper model can be changed with WHISPER_MODEL, for example: tiny.en, base.en, small.en")
    server.serve_forever()


if __name__ == "__main__":
    run()
