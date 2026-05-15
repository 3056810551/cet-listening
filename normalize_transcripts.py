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

    for raw_line in text.splitlines():
        line = clean_line(raw_line)
        stripped = line.strip()

        set_match = re.match(r"^##\s*第([一二三四五六七八九十\d]+)套", stripped)
        if set_match:
            if current_set is not None:
                tracks.append((current_set, trim_blank_edges(current_lines)))
            current_set = SET_NUMBERS.get(set_match.group(1))
            if current_set is None:
                raise SystemExit(f"Unsupported set number: {set_match.group(1)}")
            current_lines = []
            current_heading = None
            continue

        if current_set is None:
            continue

        if not stripped:
            append_blank(current_lines)
            continue

        if stripped.startswith("### "):
            continue

        heading = normalize_item_heading(stripped)
        if heading:
            append_blank(current_lines)
            current_lines.append(f"## {heading}")
            append_blank(current_lines)
            current_heading = heading
            continue

        if stripped.lower() in {"**questions:**", "questions:"}:
            append_blank(current_lines)
            continue

        if current_heading:
            current_lines.append(stripped)

    if current_set is not None:
        tracks.append((current_set, trim_blank_edges(current_lines)))

    return tracks


def normalize_item_heading(line):
    match = re.match(r"^####\s*(Conversation|Passage|Recording)\s+(\d+)\s*$", line, re.I)
    if not match:
        return None
    return f"{match.group(1).upper()} {match.group(2)}"


def clean_line(line):
    return (
        line.replace("\ufeff", "")
        .replace("鈥攖", "-t")
        .replace("鈥攚", "-w")
        .replace("鈥?", "-")
        .replace("鈥檚", "'s")
        .replace("鈥檛", "'t")
        .replace("鈥檙", "'r")
        .replace("鈥渢", '"t')
        .replace("鈥", "'")
        .replace("掳C", "°C")
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
