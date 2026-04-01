# Quiz Scoring Service-saves quiz results to JSON files

import json
import re
from datetime import datetime
from pathlib import Path


def get_downloads_dir():
    """Import DOWNLOADS_DIR from settings"""
    from app.settings import DOWNLOADS_DIR
    return DOWNLOADS_DIR


def save_quiz_result(child_id: str, video_id: str, score_data: dict) -> dict:
    """
    Save quiz results to a JSON file.
    
    Args:
        child_id: unique identifier for child (ex., "user_12345")
        video_id: the video they watched
        score_data: dict containing score information
        
    Returns:
        Dict with success status
    """
    DOWNLOADS_DIR = get_downloads_dir()
    child_id = re.sub(r'[^a-zA-Z0-9_-]', '', child_id)
    
    # Create quiz_results folder
    results_dir = DOWNLOADS_DIR / "quiz_results"
    results_dir.mkdir(exist_ok=True)
    
    # File for specific child's results
    results_file = results_dir / f"{child_id}_results.json"
    
    # Load existing results or create new
    if results_file.exists():
        try:
            data = json.loads(results_file.read_text(encoding="utf-8"))
        except Exception:
            data = {"child_id": child_id, "attempts": []}
    else:
        data = {"child_id": child_id, "attempts": []}
    
    # Add this quiz attempt
    attempt = {
        "video_id": video_id,
        "timestamp": datetime.now().isoformat(),
        "total": score_data.get("total", 0),
        "questions_total": score_data.get("total", 0),
        "questions_correct": score_data.get("correct", 0),
        "questions_wrong": score_data.get("wrong", 0),
        "percentage": score_data.get("percentage", 0),
        "total_retries": score_data.get("total_retries", 0),
        "avg_retries_per_question": score_data.get("avg_retries_per_question", 0.0),
        "details": score_data.get("details", [])
}
    
    data["attempts"].append(attempt)
    
    # Save to file
    try:
        results_file.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )
        return {
            "success": True,
            "message": "Score saved!",
            "file": str(results_file)
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Error saving: {str(e)}"
        }


def get_child_scores(child_id: str) -> dict:
    """
    Get all quiz attempts for a child.
    
    Returns their full history and summary stats.
    """
    DOWNLOADS_DIR = get_downloads_dir()
    results_file = DOWNLOADS_DIR / "quiz_results" / f"{child_id}_results.json"
    
    if not results_file.exists():
        return {
            "success": False,
            "message": "No scores found for this child"
        }
    
    try:
        data = json.loads(results_file.read_text(encoding="utf-8"))
        
        # Calculate summary
        attempts = data.get("attempts", [])
        total_correct = sum(a.get("questions_correct", 0) for a in attempts)
        total_questions = sum(a.get("questions_total", 0) for a in attempts)
        
        return {
            "success": True,
            "child_id": child_id,
            "total_attempts": len(attempts),
            "total_correct": total_correct,
            "total_questions": total_questions,
            "overall_percentage": round(total_correct / total_questions * 100, 1) if total_questions > 0 else 0,
            "attempts": attempts
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Error reading scores: {str(e)}"
        }