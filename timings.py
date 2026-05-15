from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import time
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

# Suppress HuggingFace/Whisper warnings on Windows before faster-whisper loads.
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

CACHE_VERSION = 2
MODEL_CACHE = {}


def build_track(markdown_path, audio_path, force=False):
    markdown_path = Path(markdown_path)
    audio_path = Path(audio_path)
    sections, lines = parse_markdown(markdown_path.read_text(encoding="utf-8-sig"))
    cache_path = markdown_path.with_name(f"{markdown_path.stem}.timings.json")
    source = source_metadata(markdown_path, audio_path)
    model_name = os.environ.get("WHISPER_MODEL", "small.en")
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
        data = json.loads(Path(cache_path).read_text(encoding="utf-8"))
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
            transcribe_meta = {"wordCount": 0}
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
    stat = Path(path).stat()
    return {
        "name": Path(path).name,
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
        .replace("\ufeff", "")
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


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate a CET-6 .timings.json file for one transcript/audio pair.")
    parser.add_argument("markdown", help="Markdown transcript path, for example transcripts/2025-12-2.md")
    parser.add_argument("audio", help="Audio path, for example audio/2025...mp3")
    parser.add_argument("--force", action="store_true", help="Regenerate even if the .timings.json file already exists.")
    args = parser.parse_args(argv)

    payload = build_track(Path(args.markdown), Path(args.audio), force=args.force)
    mode = payload.get("mode", "cached")
    line_count = len(payload.get("lines", []))
    verb = "Loaded" if payload.get("cached") else "Generated"
    print(f"{verb} {Path(args.markdown).with_suffix('.timings.json')} ({line_count} lines, {mode}).")


if __name__ == "__main__":
    main()
