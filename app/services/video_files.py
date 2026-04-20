from pathlib import Path
from typing import Dict, List, Optional

from app.settings import DOWNLOADS_DIR
from app.settings import VIDEO_EXTENSIONS


def find_primary_video_file(video_dir: Path) -> Optional[Path]:
    if not video_dir.exists() or not video_dir.is_dir():
        return None
    base_name = video_dir.name
    for ext in VIDEO_EXTENSIONS:
        matches = sorted(video_dir.glob(f"*{ext}"), key=lambda path: _video_sort_key(path, base_name))
        if matches:
            return matches[0]
    return None


def _video_sort_key(path: Path, base_name: str):
    exact_name = 0 if path.stem == base_name else 1
    extra_parts = path.stem.count(".")
    return (exact_name, extra_parts, len(path.name), path.name.lower())


def list_question_json_files() -> List[Dict[str, str]]:
    files: List[Dict[str, str]] = []
    if not DOWNLOADS_DIR.exists():
        return files
    for video_dir in sorted(DOWNLOADS_DIR.iterdir()):
        if not video_dir.is_dir():
            continue
        questions_dir = video_dir / "questions"
        if not questions_dir.is_dir():
            continue
        for json_file in sorted(questions_dir.glob("*.json")):
            try:
                rel_path = json_file.relative_to(DOWNLOADS_DIR).as_posix()
            except ValueError:
                continue
            files.append(
                {
                    "video_id": video_dir.name,
                    "name": json_file.name,
                    "rel_path": rel_path,
                }
            )
    files.sort(key=lambda item: (item["video_id"], item["name"]))
    return files
