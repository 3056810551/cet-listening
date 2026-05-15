from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "0.md"
DEFAULT_OUTPUT_DIR = ROOT / "transcripts"

SET_NUMBERS = {
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    "10": 10,
}

WORD_NUMBERS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Split a combined CET-6 listening transcript into per-set Markdown files.",
    )
    parser.add_argument(
        "input",
        nargs="?",
        default=DEFAULT_INPUT,
        type=Path,
        help="Combined Markdown transcript. Defaults to 0.md.",
    )
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        type=Path,
        help="Directory for generated transcript files. Defaults to transcripts/.",
    )
    parser.add_argument("--year", type=int, help="Override year detected from the title.")
    parser.add_argument("--month", type=int, help="Override month detected from the title.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing output files.")
    args = parser.parse_args(argv)

    source = args.input.resolve()
    text = source.read_text(encoding="utf-8-sig")
    year, month = detect_year_month(text, args.year, args.month)
    tracks = split_sets(text)

    if not tracks:
        raise SystemExit(f"No transcript sets found in {source}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for set_num, lines in tracks:
        output_path = args.output_dir / f"{year}-{month}-{set_num}.md"
        if output_path.exists() and not args.force:
            print(f"Skipped existing {output_path}. Use --force to overwrite.")
            continue
        output_path.write_text(format_lines(lines), encoding="utf-8")
        print(f"Wrote {output_path}")


def detect_year_month(text, year_override=None, month_override=None):
    if year_override and month_override:
        return year_override, month_override

    title_match = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月", text)
    year = year_override or (int(title_match.group(1)) if title_match else None)
    month = month_override or (int(title_match.group(2)) if title_match else None)

    if year is None or month is None:
        raise SystemExit("Could not detect year/month. Pass --year and --month explicitly.")
    return year, month


def split_sets(text):
    tracks = []
    current_set = None
    current_lines = []
    current_heading = None
    saw_explicit_set = False

    for raw_line in text.splitlines():
        line = clean_line(raw_line)
        stripped = line.strip()

        set_match = re.match(r"^##\s*第([一二三四五六七八九十\d]+)套", stripped)
        if set_match:
            saw_explicit_set = True
            if current_set is not None:
                tracks.append((current_set, trim_blank_edges(current_lines)))
            current_set = SET_NUMBERS.get(set_match.group(1))
            if current_set is None:
                raise SystemExit(f"Unsupported set number: {set_match.group(1)}")
            current_lines = []
            current_heading = None
            continue

        if not stripped:
            append_blank(current_lines)
            continue

        if re.match(r"^#{1,3}\s+", stripped) and not normalize_item_heading(stripped):
            continue

        heading = normalize_item_heading(stripped)
        if heading:
            if current_set is None:
                current_set = 1
            append_blank(current_lines)
            current_lines.append(f"## {heading}")
            append_blank(current_lines)
            current_heading = heading
            continue

        if current_set is None:
            continue

        questions = extract_questions(stripped)
        if questions:
            if not current_lines or not current_lines[-1].startswith("Q"):
                append_blank(current_lines)
            current_lines.extend(questions)
            continue

        if is_questions_prompt(stripped):
            append_blank(current_lines)
            continue

        if current_heading:
            current_lines.append(stripped)

    if current_set is not None:
        tracks.append((current_set, trim_blank_edges(current_lines)))

    if saw_explicit_set:
        return tracks
    return tracks


def normalize_item_heading(line):
    text = line.strip("*").strip()
    match = re.match(r"^(?:#{2,4}\s*)?(Conversation|Passage|Recording)\s+([A-Za-z]+|\d+)\s*$", text, re.I)
    if not match:
        return None
    number = normalize_number(match.group(2))
    if number is None:
        return None
    return f"{match.group(1).upper()} {number}"


def normalize_number(value):
    if value.isdigit():
        return int(value)
    return WORD_NUMBERS.get(value.lower())


def is_questions_prompt(line):
    return bool(re.match(r"^\*\*Questions(?:\s+\d+\s+to\s+\d+.*)?\*\*\s*$", line, re.I)) or line.lower() in {
        "**questions:**",
        "questions:",
    }


def extract_questions(line):
    text = line
    if re.match(r"^\*\*Questions", text, re.I):
        text = re.sub(r"^\*\*Questions.*?\*\*\s*", "", text, flags=re.I)
    elif not re.match(r"^\d{1,2}\.\s+", text):
        return []

    questions = []
    for number, question in re.findall(
        r"(?:^|\s)(\d{1,2})\.\s+(.+?)(?=\s+\d{1,2}\.\s+|$)",
        text,
    ):
        questions.append(f"Q{number}. {question.strip()}")
    return questions


def clean_line(line):
    return (
        line.replace("\ufeff", "")
        .replace("\u00a0", " ")
        .rstrip()
    )


def append_blank(lines):
    if lines and lines[-1] != "":
        lines.append("")


def trim_blank_edges(lines):
    while lines and lines[0] == "":
        lines.pop(0)
    while lines and lines[-1] == "":
        lines.pop()
    return lines


def format_lines(lines):
    return "\n".join(trim_blank_edges(lines)) + "\n"


if __name__ == "__main__":
    main()
