import json
import os
import re
import sys
from pathlib import Path

# Add support for calling server functions
import server

ROOT = Path(__file__).resolve().parent
AUDIO_DIR = ROOT / "audio"
TRANSCRIPT_DIR = ROOT / "transcripts"
MD_PATTERN = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})\.md")

def get_track_title(year, month, set_num):
    return f"{year} 年 {month} 月 第 {set_num} 套"

def find_audio(year, month, set_num):
    # Try to find an mp3 that contains the same year, month and set number
    for f in AUDIO_DIR.glob("*.mp3"):
        name = f.name
        if str(year) in name and str(month) in name and f"第{set_num}套" in name:
            return f"audio/{name}"
        nums = re.findall(r"\d+", name)
        if str(year) in nums and str(month) in nums and str(set_num) in nums:
            return f"audio/{name}"
    return None

def scan(generate=False):
    tracks = []
    md_files = sorted(TRANSCRIPT_DIR.glob("*.md"))
    
    for md_path in md_files:
        match = MD_PATTERN.match(md_path.name)
        if not match:
            continue
            
        year, month, set_num = match.groups()
        audio_path = find_audio(year, month, set_num)
        
        if not audio_path:
            print(f"Warning: No audio found for {md_path.name}")
            continue
            
        timings_name = md_path.with_suffix(".timings.json").name
        timings_path = TRANSCRIPT_DIR / timings_name
        
        if generate and not timings_path.exists():
            print(f"Generating timings for {md_path.name}...")
            try:
                server.build_track(md_path, ROOT / audio_path, force=False)
            except Exception as e:
                print(f"Failed to generate timings for {md_path.name}: {e}")
        
        tracks.append({
            "id": f"{year}-{month}-{set_num}",
            "title": get_track_title(year, month, set_num),
            "markdown": f"transcripts/{md_path.name}",
            "audio": audio_path,
            "timings": f"transcripts/{timings_name}",
            "available": timings_path.exists()
        })
    
    output_path = ROOT / "tracks.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(tracks, f, ensure_ascii=False, indent=2)
    
    print(f"Successfully generated {output_path} with {len(tracks)} tracks.")

if __name__ == "__main__":
    should_gen = "--gen" in sys.argv
    scan(generate=should_gen)
