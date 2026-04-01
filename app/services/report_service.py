"""
Report service for expert-scoped parental reports.
Reads quiz result JSON files and computes summary stats per child.
"""

import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional


def _get_downloads_dir() -> Path:
    from app.settings import DOWNLOADS_DIR
    return DOWNLOADS_DIR


def _get_video_title(video_id: str, downloads_dir: Path) -> str:
    meta_path = downloads_dir / video_id / "meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            return meta.get("title") or video_id
        except Exception:
            pass
    return video_id


def _load_attempts(child_id: str, downloads_dir: Path) -> List[Dict[str, Any]]:
    results_file = downloads_dir / "quiz_results" / f"{child_id}_results.json"
    if not results_file.exists():
        return []
    try:
        data = json.loads(results_file.read_text(encoding="utf-8"))
        return data.get("attempts", [])
    except Exception:
        return []


def _compute_top_categories(attempts: List[Dict[str, Any]], window: int = 10) -> List[Dict[str, Any]]:
    """
    Compute top 3 question-type categories from the last `window` attempts.
    Per-answer points: correct=1, almost=0.5, wrong=0.
    Category score: round((points_sum / answer_count) * 100).
    Rank by score desc, then answer_count desc.
    """
    recent = attempts[-window:]
    category_points: Dict[str, float] = defaultdict(float)
    category_counts: Dict[str, int] = defaultdict(int)

    for attempt in recent:
        for detail in attempt.get("details", []):
            q_type = detail.get("question_type")
            if not q_type:
                continue
            status = detail.get("status", "wrong")
            if status == "correct":
                points = 1.0
            elif status == "almost":
                points = 0.5
            else:
                points = 0.0
            category_points[q_type] += points
            category_counts[q_type] += 1

    if not category_counts:
        return []

    categories = []
    for q_type, count in category_counts.items():
        score = round((category_points[q_type] / count) * 100)
        categories.append({
            "type": q_type,
            "score": score,
            "answer_count": count,
        })

    categories.sort(key=lambda c: (-c["score"], -c["answer_count"]))
    return categories[:3]


def get_child_report(child_id: str, limit: int = 10) -> Dict[str, Any]:
    """
    Return a full report payload for one child.
    """
    downloads_dir = _get_downloads_dir()
    attempts = _load_attempts(child_id, downloads_dir)

    if not attempts:
        return {
            "success": True,
            "child_id": child_id,
            "overall_score": 0,
            "total_attempts": 0,
            "total_retries": 0,
            "avg_retries_per_question": 0.0,
            "top_categories": [],
            "recent_videos": [],
        }

    # Enrich each attempt with video title
    enriched = []
    for attempt in attempts:
        video_id = attempt.get("video_id", "")
        enriched.append({
            **attempt,
            "video_title": _get_video_title(video_id, downloads_dir),
        })

    # Overall score: average percentage across all attempts
    percentages = [a.get("percentage", 0) for a in enriched]
    overall_score = round(sum(percentages) / len(percentages)) if percentages else 0

    # Total attempts
    total_attempts = len(enriched)

    # Aggregate retry metrics across all attempts
    total_retries = sum(a.get("total_retries", 0) for a in enriched)
    total_questions_answered = sum(a.get("total", 0) for a in enriched)
    avg_retries_per_question = round(
        total_retries / total_questions_answered, 2
    ) if total_questions_answered > 0 else 0.0

    # Top categories
    top_categories = _compute_top_categories(attempts)

    # Recent videos: latest 4, newest first
    recent_videos = [
        {
            "video_id": a.get("video_id"),
            "video_title": a.get("video_title"),
            "percentage": a.get("percentage", 0),
            "timestamp": a.get("timestamp"),
        }
        for a in reversed(enriched[-4:])
    ]

    return {
        "success": True,
        "child_id": child_id,
        "overall_score": overall_score,
        "total_attempts": total_attempts,
        "total_retries": total_retries,
        "avg_retries_per_question": avg_retries_per_question,
        "top_categories": top_categories,
        "recent_videos": recent_videos,
    }
