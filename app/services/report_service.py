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


def _get_video_meta(video_id: str, downloads_dir: Path) -> Dict[str, Any]:
    meta_path = downloads_dir / video_id / "meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            duration_seconds = meta.get("duration", 0) or 0
            return {
                "title": meta.get("title") or video_id,
                "duration_minutes": round(duration_seconds / 60, 1),
            }
        except Exception:
            pass
    return {"title": video_id, "duration_minutes": 0}


def _get_video_title(video_id: str, downloads_dir: Path) -> str:
    return _get_video_meta(video_id, downloads_dir)["title"]


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


def get_child_report_scoped(
    child_id: str,
    video_id: Optional[str] = None,
    mode: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Return a report filtered by optional video_id and/or interaction_mode.
    mode='all' (or None) means no mode filter.
    """
    downloads_dir = _get_downloads_dir()
    all_attempts = _load_attempts(child_id, downloads_dir)

    # Filter by video
    if video_id:
        all_attempts = [a for a in all_attempts if a.get("video_id") == video_id]

    # Filter by mode (skip filter when mode is None or 'all')
    if mode and mode != "all":
        all_attempts = [a for a in all_attempts if a.get("interaction_mode") == mode]

    if not all_attempts:
        return {
            "success": True,
            "child_id": child_id,
            "overall_score": 0,
            "total_attempts": 0,
            "total_retries": 0,
            "avg_retries_per_question": 0.0,
            "top_categories": [],
            "recent_videos": [],
            "videos_watched": 0,
            "total_watch_minutes": 0,
        }

    enriched = [
        {**a, "video_title": _get_video_title(a.get("video_id", ""), downloads_dir)}
        for a in all_attempts
    ]

    percentages = [a.get("percentage", 0) for a in enriched]
    overall_score = round(sum(percentages) / len(percentages)) if percentages else 0
    total_retries = sum(a.get("total_retries", 0) for a in enriched)
    total_questions_answered = sum(a.get("total", 0) for a in enriched)
    avg_retries_per_question = round(
        total_retries / total_questions_answered, 2
    ) if total_questions_answered > 0 else 0.0

    recent_videos = []
    for a in reversed(enriched[-6:]):
        vid_id = a.get("video_id", "")
        meta = _get_video_meta(vid_id, downloads_dir)
        watch_min = round(a.get("watch_minutes", 0), 1)
        dur_min = meta["duration_minutes"]
        finished = dur_min > 0 and watch_min >= dur_min * 0.9
        recent_videos.append({
            "video_id": vid_id,
            "video_title": a.get("video_title"),
            "percentage": a.get("percentage", 0),
            "timestamp": a.get("timestamp"),
            "interaction_mode": a.get("interaction_mode"),
            "watch_minutes": watch_min,
            "duration_minutes": dur_min,
            "finished": finished,
            "manual_pauses": a.get("manual_pauses", 0),
        })

    return {
        "success": True,
        "child_id": child_id,
        "overall_score": overall_score,
        "total_attempts": len(enriched),
        "total_retries": total_retries,
        "avg_retries_per_question": avg_retries_per_question,
        "top_categories": _compute_top_categories(all_attempts),
        "recent_videos": recent_videos,
        "videos_watched": len(enriched),
        "total_watch_minutes": sum(round(a.get("watch_minutes", 0)) for a in enriched),
    }


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
    # Passive metrics
    videos_watched = len(enriched)
    total_watch_minutes = sum(
        round(a.get("watch_minutes", 0)) for a in enriched
    )

    # Aggregate retry metrics across all attempts
    total_retries = sum(a.get("total_retries", 0) for a in enriched)
    total_questions_answered = sum(a.get("total", 0) for a in enriched)
    avg_retries_per_question = round(
        total_retries / total_questions_answered, 2
    ) if total_questions_answered > 0 else 0.0

    # Top categories
    top_categories = _compute_top_categories(attempts)

    # Recent videos: latest 4, newest first
    recent_videos = []
    for a in reversed(enriched[-4:]):
        vid_id = a.get("video_id", "")
        meta = _get_video_meta(vid_id, downloads_dir)
        watch_min = round(a.get("watch_minutes", 0), 1)
        dur_min = meta["duration_minutes"]
        finished = dur_min > 0 and watch_min >= dur_min * 0.9
        recent_videos.append({
            "video_id": vid_id,
            "video_title": a.get("video_title"),
            "percentage": a.get("percentage", 0),
            "timestamp": a.get("timestamp"),
            "watch_minutes": watch_min,
            "duration_minutes": dur_min,
            "finished": finished,
            "manual_pauses": a.get("manual_pauses", 0),
        })

    return {
        "success": True,
        "child_id": child_id,
        "overall_score": overall_score,
        "total_attempts": total_attempts,
        "total_correct": sum(a.get("questions_correct", 0) for a in enriched),
        "total_wrong": sum(a.get("questions_wrong", 0) for a in enriched),
        "total_questions_answered": sum(a.get("total", 0) for a in enriched),
        "total_retries": total_retries,
        "avg_retries_per_question": avg_retries_per_question,
        "top_categories": top_categories,
        "recent_videos": recent_videos,
        "videos_watched": videos_watched,
        "total_watch_minutes": total_watch_minutes,
    }
