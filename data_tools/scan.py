from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

try:
    from . import timings
except ImportError:
    import timings

ROOT = Path(__file__).resolve().parents[1]
AUDIO_DIR = ROOT / "audio"
TRANSCRIPT_DIR = ROOT / "transcripts"
DEFAULT_EXAM = "cet6"
SUPPORTED_EXAMS = ("cet6", "cet4")
EXAM_ORDER = {exam: index for index, exam in enumerate(SUPPORTED_EXAMS)}
MD_PATTERN = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})\.md$")


def get_track_title(year: str, month: str, set_num: str) -> str:
    return f"{year} 年 {month} 月第 {set_num} 套"


def normalize_exam(value: str | None) -> str:
    return value if value in SUPPORTED_EXAMS else DEFAULT_EXAM


def infer_exam(md_path: Path) -> str:
    try:
        first_part = md_path.relative_to(TRANSCRIPT_DIR).parts[0]
    except ValueError:
        return DEFAULT_EXAM
    return normalize_exam(first_part)


def relative_asset_path(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def candidate_audio_dirs(exam: str) -> list[Path]:
    exam = normalize_exam(exam)
    candidates = [AUDIO_DIR / exam, AUDIO_DIR]
    unique = []
    for path in candidates:
        if path not in unique:
            unique.append(path)
    return unique


def find_audio(exam: str, year: str, month: str, set_num: str) -> str | None:
    for directory in candidate_audio_dirs(exam):
        canonical = directory / f"{year}-{month}-{set_num}.mp3"
        if canonical.exists():
            return relative_asset_path(canonical)

        for file_path in directory.glob("*.mp3"):
            name = file_path.name
            nums = re.findall(r"\d+", name)
            if str(year) in nums and str(month) in nums and str(set_num) in nums:
                return relative_asset_path(file_path)
    return None


def iter_markdown_files(exam: str | None = None):
    targets = [normalize_exam(exam)] if exam else SUPPORTED_EXAMS

    seen = set()
    for exam_name in targets:
        exam_dir = TRANSCRIPT_DIR / exam_name
        if exam_dir.exists():
            for md_path in sorted(exam_dir.glob("*.md")):
                seen.add(md_path.resolve())
                yield md_path

    if not exam or normalize_exam(exam) == DEFAULT_EXAM:
        for md_path in sorted(TRANSCRIPT_DIR.glob("*.md")):
            resolved = md_path.resolve()
            if resolved in seen:
                continue
            yield md_path


def build_track_entry(md_path: Path) -> dict | None:
    match = MD_PATTERN.match(md_path.name)
    if not match:
        return None

    year, month, set_num = match.groups()
    exam = infer_exam(md_path)
    audio_path = find_audio(exam, year, month, set_num)
    if not audio_path:
        print(f"Warning: No audio found for {md_path}")
        return None

    transcript_path = timings.transcript_path_for(md_path)
    timings_path = md_path.with_name(f"{md_path.stem}.timings.json")

    return {
        "exam": exam,
        "id": f"{year}-{month}-{set_num}",
        "title": get_track_title(year, month, set_num),
        "markdown": relative_asset_path(md_path),
        "transcript": relative_asset_path(transcript_path),
        "audio": audio_path,
        "timings": relative_asset_path(timings_path),
        "available": transcript_path.exists() and timings_path.exists(),
    }


def scan(generate: bool = False, force: bool = False, exam: str | None = None):
    tracks = []

    for md_path in iter_markdown_files(exam):
        entry = build_track_entry(md_path)
        if not entry:
            continue

        try:
            timings.build_transcript(md_path, force=force)
        except Exception as error:
            print(f"Failed to generate transcript JSON for {md_path.name}: {error}")

        timings_path = ROOT / entry["timings"]
        if generate and (force or not timings_path.exists()):
            print(f"Generating timings for {md_path.name}...")
            try:
                timings.build_track(md_path, ROOT / entry["audio"], force=force)
            except Exception as error:
                print(f"Failed to generate timings for {md_path.name}: {error}")

        entry["available"] = (ROOT / entry["transcript"]).exists() and timings_path.exists()
        tracks.append(entry)

    tracks.sort(
        key=lambda item: (EXAM_ORDER.get(item["exam"], 99), *parse_track_id(item["id"])),
    )

    output_path = ROOT / "tracks.json"
    output_path.write_text(
        json.dumps(tracks, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Successfully generated {output_path} with {len(tracks)} tracks.")


def parse_track_id(track_id: str):
    match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", str(track_id))
    if not match:
        return (9999, 99, 99)
    return tuple(int(value) for value in match.groups())


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Scan CET listening materials and generate tracks.json.",
    )
    parser.add_argument(
        "--exam",
        choices=SUPPORTED_EXAMS,
        help="Only scan one exam type. Defaults to scanning both cet6 and cet4.",
    )
    parser.add_argument(
        "--gen",
        action="store_true",
        help="Generate timings JSON for tracks that are missing timings.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate transcript/timings files even if they already exist.",
    )
    args = parser.parse_args(argv)

    scan(generate=args.gen, force=args.force, exam=args.exam)


if __name__ == "__main__":
    main()
