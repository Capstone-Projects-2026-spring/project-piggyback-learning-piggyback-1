# admin_routes.py
import json
import csv
import asyncio
import sqlite3
from typing import Any, Dict, List, Optional
from app.services.frame_service import (
    extract_frames_per_second_for_video as extract_frames_per_second_for_video_service,
)
from fastapi import (
    APIRouter,
    Body,
    Form,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
)

from app.services.children_service import(
    ALLOWED_CHILD_ICON_KEYS,
    create_child,
    list_children,
    update_child,
    deactivate_child,
    delete_child,
)
from app.services.report_service import get_child_report

from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
#Pulls shared path from settings.py so all module uses the same directory
from app.settings import DOWNLOADS_DIR, TEMPLATES_DIR

from app.services.expert_auth_service import (
    add_video_assignment,
    create_expert,
    deactivate_expert,
    list_experts,
    delete_expert,
    update_expert,
    remove_video_assignment,
    list_experts_for_video,
)
# ----- Local paths (keep consistent with main.py) -----
#maybe needed if not delete later, should be duplicates with shared setting imports.
#TODO- might delete this 
# BASE_DIR = Path(__file__).parent.resolve()
# TEMPLATES_DIR = BASE_DIR / "templates"
# DOWNLOADS_DIR = BASE_DIR / "downloads"

# Use shared templates path from app.settings to avoid path drift across modules.
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Three routers:
#  - pages: mounted under /admin
#  - api:   mounted under /api
#  - ws:    mounted with NO prefix (keeps /ws/... as-is)
router_admin_pages = APIRouter()
router_admin_api = APIRouter()
router_admin_ws = APIRouter()

# ===== Helpers duplicated here (tiny / no circulars) =====
def format_hhmmss(total_seconds: int) -> str:
    h = total_seconds // 3600
    m = (total_seconds % 3600) // 60
    s = total_seconds % 60
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"




def _collect_downloaded_videos(include_without_frames: bool = False) -> List[Dict[str, Any]]:
    """
    Enumerate downloads/<video_id> folders so the admin UI can reuse existing assets.
    """
    entries: List[Dict[str, Any]] = []
    if not DOWNLOADS_DIR.exists():
        return entries

    for folder in sorted(DOWNLOADS_DIR.iterdir()):
        if not folder.is_dir():
            continue

        video_id = folder.name
        meta_path = folder / "meta.json"
        title = video_id
        duration_seconds: Optional[int] = None
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                title = meta.get("title") or title
                duration_seconds = meta.get("duration")
            except Exception:
                pass

        frames_dir = folder / "extracted_frames"
        frames_json = frames_dir / "frame_data.json"
        has_frames = frames_json.exists()
        frame_count = None
        if frames_json.exists():
            try:
                frame_payload = json.loads(frames_json.read_text(encoding="utf-8"))
                frame_count = frame_payload.get("video_info", {}).get("extracted_frames")
            except Exception:
                frame_count = None

        questions_path = folder / "questions" / f"{video_id}.json"
        has_questions = questions_path.exists()
        if not include_without_frames and not has_frames:
            continue

        duration_label = None
        if duration_seconds:
            try:
                duration_label = format_hhmmss(int(float(duration_seconds)))
            except Exception:
                duration_label = None

        entry: Dict[str, Any] = {
            "video_id": video_id,
            "title": title,
            "duration_seconds": duration_seconds,
            "duration_formatted": duration_label,
            "has_frames": has_frames,
            "frame_count": frame_count,
            "has_questions": has_questions,
        }
        if has_frames:
            try:
                entry["frames_dir"] = (
                    f"/downloads/{frames_dir.relative_to(DOWNLOADS_DIR).as_posix()}"
                )
            except ValueError:
                entry["frames_dir"] = None
        if has_questions:
            try:
                entry["question_file"] = (
                    f"/downloads/{questions_path.relative_to(DOWNLOADS_DIR).as_posix()}"
                )
            except ValueError:
                entry["question_file"] = None
        entries.append(entry)

    return entries


def _segment_frame_debug(video_id: str, start: int, end: int) -> Dict[str, Any]:
    """
    Inspect extracted frame coverage for a segment to explain generation failures.
    """
    frames_dir = DOWNLOADS_DIR / video_id / "extracted_frames"
    csv_path = frames_dir / "frame_data.csv"
    debug: Dict[str, Any] = {"video_id": video_id, "start": start, "end": end}

    if not frames_dir.exists():
        debug["reason"] = "frames_dir_missing"
        return debug
    if not csv_path.exists():
        debug["reason"] = "frame_data_csv_missing"
        return debug

    min_ts = None
    max_ts = None
    total_rows = 0
    in_range = 0
    missing_files = 0

    try:
        with csv_path.open("r", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                total_rows += 1
                ts_raw = row.get("Timestamp") or row.get("Time_Seconds") or row.get("Time_Formatted")
                try:
                    if ts_raw is None:
                        continue
                    if isinstance(ts_raw, str) and ":" in ts_raw:
                        parts = [int(p) for p in ts_raw.split(":") if p.strip()]
                        if len(parts) == 3:
                            ts = parts[0] * 3600 + parts[1] * 60 + parts[2]
                        elif len(parts) == 2:
                            ts = parts[0] * 60 + parts[1]
                        else:
                            ts = int(parts[0])
                    else:
                        ts = int(float(ts_raw))
                except Exception:
                    continue

                if min_ts is None or ts < min_ts:
                    min_ts = ts
                if max_ts is None or ts > max_ts:
                    max_ts = ts

                if start <= ts <= end:
                    in_range += 1
                    filename = row.get("Filename") or ""
                    if filename and not (frames_dir / filename).exists():
                        missing_files += 1

        debug.update(
            {
                "total_frames": total_rows,
                "frames_in_range": in_range,
                "min_timestamp": min_ts,
                "max_timestamp": max_ts,
                "missing_frame_files": missing_files,
            }
        )
        if in_range == 0:
            debug["reason"] = "no_frames_in_range"
        elif missing_files > 0:
            debug["reason"] = "missing_frame_files"
        else:
            debug["reason"] = "frames_present"
    except Exception as exc:
        debug["reason"] = "csv_parse_error"
        debug["error"] = str(exc)

    return debug


def _wrap_segment_result(
    video_id: str,
    start: int,
    end: int,
    result_text: Optional[str],
    result_obj: Any,
) -> Any:
    """
    Normalize failed generations into a structured error payload.
    """
    if isinstance(result_obj, dict) and "error" in result_obj:
        return result_obj

    error_info: Optional[Dict[str, Any]] = None

    if result_text is None:
        error_info = {"reason": "generation_returned_none"}
    elif isinstance(result_obj, str):
        error_info = {
            "reason": "invalid_json",
            "raw_preview": result_obj[:300],
        }
    elif isinstance(result_obj, dict) and "questions" not in result_obj:
        error_info = {
            "reason": "missing_questions",
            "keys": list(result_obj.keys()),
        }

    if error_info:
        frame_debug = _segment_frame_debug(video_id, start, end)
        return {"error": error_info, "frame_debug": frame_debug}

    return result_obj


# =========================================================
# Admin page
# =========================================================
@router_admin_pages.get("/", response_class=HTMLResponse)
def admin_page(request: Request):
    # admin.html is self-contained (fetches data via JS), so no heavy context needed
    return templates.TemplateResponse("admin.html", {"request": request})


# =========================================================
# Admin API
# =========================================================
# Admin loads all expert accounts for management UI.
@router_admin_api.get("/admin/experts")
def api_admin_list_experts():
    return {"success": True, "experts": list_experts()}


# Admin creates a new expert with ID + display name + password.
@router_admin_api.post("/admin/experts")
async def api_admin_create_expert(payload: Dict[str, Any] = Body(...)):
    expert_id = str(payload.get("expert_id") or "").strip()
    display_name = str(payload.get("display_name") or "").strip()
    password = str(payload.get("password") or "")

    try:
        expert = create_expert(expert_id, display_name, password)
        return {"success": True, "expert": expert}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        if str(exc) == "duplicate_expert_id":
            raise HTTPException(status_code=409, detail="expert_id already exists")
        raise


# Admin updates fields selectively (rename, reset password, activate/deactivate).
@router_admin_api.put("/admin/experts/{expert_id}")
async def api_admin_update_expert(expert_id: str, payload: Dict[str, Any] = Body(...)):
    display_name = payload.get("display_name")
    password = payload.get("password")
    is_active = payload.get("is_active")

    if display_name is not None:
        display_name = str(display_name)
    if password is not None:
        password = str(password)
    if is_active is not None and not isinstance(is_active, bool):
        raise HTTPException(status_code=400, detail="is_active must be true or false")

    try:
        expert = update_expert(
            expert_id,
            display_name=display_name,
            password=password,
            is_active=is_active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not expert:
        raise HTTPException(status_code=404, detail="expert not found")
    return {"success": True, "expert": expert}

# Explicit deactivate action for a simple one-click admin control.
@router_admin_api.post("/admin/experts/{expert_id}/deactivate")
async def api_admin_deactivate_expert(expert_id: str):
    expert = deactivate_expert(expert_id)
    if not expert:
        raise HTTPException(status_code=404, detail="expert not found")
    return {"success": True, "expert": expert}

#delete
@router_admin_api.delete("/admin/experts/{expert_id}")
async def api_admin_delete_expert(expert_id: str):
    try:
        deleted = delete_expert(expert_id)
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="cannot delete expert while children are linked; reassign or deactivate children first",
        )
    if not deleted:
        raise HTTPException(status_code=404, detail="expert not found")
    return {"success": True}

# Permanently delete a child from the database
@router_admin_api.delete("/admin/children/{child_id}")
async def api_admin_delete_child(child_id: str):
    deleted = delete_child(child_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="child not found")
    return {"success": True}


#Admin loads video + current expert assignment state for assignment UI bootstrap
@router_admin_api.get("/admin/videos/assignments")
def api_admin_list_video_assignments():
    videos = _collect_downloaded_videos(include_without_frames=True)

    rows: List[Dict[str, Any]] = []
    for video in videos:
        assigned_experts = list_experts_for_video(video["video_id"])
        rows.append(
            {
                "video_id": video["video_id"],
                "title": video.get("title") or video["video_id"],
                "duration_formatted": video.get("duration_formatted"),
                "has_frames": bool(video.get("has_frames")),
                "has_questions": bool(video.get("has_questions")),
                "assigned_experts": assigned_experts,
            }
        )

    return {
        "success": True,
        "experts": list_experts(),
        "assignments": rows,
    }


# Admin adds or removes a single expert-video pair.
@router_admin_api.post("/admin/videos/assignments")
async def api_admin_set_video_assignment(payload: Dict[str, Any] = Body(...)):
    video_id = str(payload.get("video_id") or "").strip()
    expert_id = str(payload.get("expert_id") or "").strip()
    op = str(payload.get("op") or "").strip()

    if not video_id:
        raise HTTPException(status_code=400, detail="video_id is required")
    if not expert_id:
        raise HTTPException(status_code=400, detail="expert_id is required")
    if op not in {"add", "remove"}:
        raise HTTPException(status_code=400, detail="op must be 'add' or 'remove'")

    video_dir = DOWNLOADS_DIR / video_id
    if not video_dir.exists() or not video_dir.is_dir():
        raise HTTPException(status_code=404, detail="video not found in downloads")

    try:
        if op == "add":
            add_video_assignment(video_id, expert_id, source="admin")
        else:
            remove_video_assignment(video_id, expert_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "success": True,
        "video_id": video_id,
        "assigned_experts": list_experts_for_video(video_id),
    }

@router_admin_api.post("/download")
async def api_download(url: str = Form(...)):
    # Lazy import to avoid circular dependency
    from app.services.download_service import download_youtube

    outcome = download_youtube(url)
    return outcome


@router_admin_api.post("/frames/{video_id}")
async def api_extract_frames(video_id: str):
    from app.services.frame_service import extract_frames_per_second_for_video
    return extract_frames_per_second_for_video(video_id)


@router_admin_api.get("/admin/videos")
def admin_list_downloaded_videos(include_without_frames: bool = False):
    """
    Provide a lightweight manifest of downloaded videos so admins can reuse them.
    """
    videos = _collect_downloaded_videos(include_without_frames=include_without_frames)
    return {
        "success": True,
        "count": len(videos),
        "videos": videos,
        "message": (
            "Videos with extracted frames ready for question generation."
            if not include_without_frames
            else "All downloaded videos."
        ),
    }


@router_admin_api.post("/submit-questions")
async def submit_questions(payload: Dict[str, Any] = Body(...)):
    """
    Submit and save finalized questions (admin 'Submit' in UI).
    Saves to downloads/<video_id>/questions/<video_id>.json
    """
    video_id = payload.get("video_id")
    questions_data = payload.get("questions", [])
    if not video_id or not questions_data:
        raise HTTPException(status_code=400, detail="Missing video_id or questions")

    from datetime import datetime

    questions_dir = DOWNLOADS_DIR / video_id / "questions"
    questions_dir.mkdir(parents=True, exist_ok=True)
    out_path = questions_dir / f"{video_id}.json"

    aggregated = {
        "video_id": video_id,
        "submitted_at": datetime.utcnow().isoformat(),
        "status": "submitted",
        "segments": questions_data,
    }

    try:
        out_path.write_text(
            json.dumps(aggregated, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save: {e}")

    return {
        "success": True,
        "message": "Questions submitted successfully",
        "file_url": f"/downloads/{video_id}/questions/{out_path.name}",
        "file_path": str(out_path),
    }

#learner should only see video inherited from selected child's expert

@router_admin_api.get("/admin/children")
def api_admin_list_children(
    expert_id: Optional[str] = None,
    include_inactive: bool = False,
):
    try:
        children = list_children(expert_id=expert_id, include_inactive=include_inactive)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {
        "success": True,
        "children": children,
        "experts": list_experts(),  # for dropdown in admin UI
        "icon_keys": list(ALLOWED_CHILD_ICON_KEYS),
        "count": len(children),
    }


@router_admin_api.post("/admin/children")
async def api_admin_create_child(payload: Dict[str, Any] = Body(...)):
    expert_id = str(payload.get("expert_id") or "").strip()
    first_name = str(payload.get("first_name") or "").strip()
    last_name = str(payload.get("last_name") or "").strip()
    icon_key = str(payload.get("icon_key") or "").strip().lower()
    interaction_mode = str(payload.get("interaction_mode") or "flexible").strip().lower()

    try:
        child = create_child(
            expert_id=expert_id,
            first_name=first_name,
            last_name=last_name,
            icon_key=icon_key,
            interaction_mode=interaction_mode,
        )
        return {"success": True, "child": child}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        if str(exc) == "duplicate_child_profile":
            raise HTTPException(status_code=409, detail="duplicate child profile for this expert")
        raise HTTPException(status_code=500, detail=str(exc))


@router_admin_api.put("/admin/children/{child_id}")
async def api_admin_update_child(child_id: str, payload: Dict[str, Any] = Body(...)):
    expert_id = payload.get("expert_id")
    first_name = payload.get("first_name")
    last_name = payload.get("last_name")
    icon_key = payload.get("icon_key")
    interaction_mode = payload.get("interaction_mode")
    is_active = payload.get("is_active")

    if expert_id is not None:
        expert_id = str(expert_id)
    if first_name is not None:
        first_name = str(first_name)
    if last_name is not None:
        last_name = str(last_name)
    if interaction_mode is not None:
        interaction_mode = str(interaction_mode).strip().lower()
    if icon_key is not None:
        icon_key = str(icon_key)
    if is_active is not None and not isinstance(is_active, bool):
        raise HTTPException(status_code=400, detail="is_active must be true or false")

    try:
        child = update_child(
            child_id=child_id,
            first_name=first_name,
            last_name=last_name,
            icon_key=icon_key,
            interaction_mode=interaction_mode,
            is_active=is_active,
            expert_id=expert_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        if str(exc) == "duplicate_child_profile":
            raise HTTPException(status_code=409, detail="duplicate child profile for this expert")
        raise HTTPException(status_code=500, detail=str(exc))

    if not child:
        raise HTTPException(status_code=404, detail="child not found")
    return {"success": True, "child": child}


@router_admin_api.post("/admin/children/{child_id}/unlink")
async def api_admin_unlink_child(child_id: str):
    child = update_child(child_id=child_id, expert_id="")
    if not child:
        raise HTTPException(status_code=404, detail="child not found")
    return {"success": True, "child": child}


@router_admin_api.post("/admin/children/{child_id}/deactivate")
async def api_admin_deactivate_child(child_id: str):
    child = deactivate_child(child_id)
    if not child:
        raise HTTPException(status_code=404, detail="child not found")
    return {"success": True, "child": child}


# =========================================================
# WebSocket – keep original path: /ws/questions/{video_id}
# =========================================================
@router_admin_ws.websocket("/ws/questions/{video_id}")
async def ws_questions(websocket: WebSocket, video_id: str):
    await websocket.accept()
    try:
        #recives the full JSON message from the browser 
        params = await websocket.receive_json()
        #starting time.
        start_seconds = int(params.get("start_seconds", 0))
        interval_seconds = int(params.get("interval_seconds", 60))
        #generate for the whole video.
        full_duration = bool(params.get("full_duration", False))
        #browser should send providers 
        provider = params.get("provider","openai")


        # Lazy imports to avoid circulars
        from app.services.question_generation_service import (
        generate_questions_for_segment_with_retry,
        build_segments_from_duration,
        _maybe_parse_json,
        )

        frames_dir = DOWNLOADS_DIR / video_id / "extracted_frames"
        if not frames_dir.exists():
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Frames not found. Please extract frames first.",
                }
            )
            await websocket.close()
            return

        # Load duration if available
        duration_seconds = None
        json_path = frames_dir / "frame_data.json"
        if json_path.exists():
            try:
                info = json.loads(json_path.read_text(encoding="utf-8"))
                duration_seconds = int(
                    float(info.get("video_info", {}).get("duration_seconds", 0))
                )
            except Exception:
                duration_seconds = None

        # One-shot interval
        if not full_duration:
            start = max(0, int(start_seconds))
            end = start + max(1, int(interval_seconds)) - 1
            if duration_seconds is not None and end > duration_seconds:
                end = duration_seconds

            await websocket.send_json(
                {
                    "type": "status",
                    "message": f"Generating questions for {start}-{end}s...",
                }
            )
            #calls generate question,  without freezing the server while it waits for the AI response.
            result_text = await asyncio_to_thread(
                generate_questions_for_segment_with_retry, video_id, start, end, provider = provider
            )
            result_obj = _maybe_parse_json(result_text)
            result_obj = _wrap_segment_result(
                video_id, start, end, result_text, result_obj
            )

            await websocket.send_json(
                {
                    "type": "segment_result",
                    "start": start,
                    "end": end,
                    "result": result_obj,
                }
            )
            await websocket.send_json({"type": "done", "auto_saved": False})
            await websocket.close()
            return

        # Full loop
        if duration_seconds is None or duration_seconds <= 0:
            await websocket.send_json(
                {"type": "error", "message": "Unable to determine video duration."}
            )
            await websocket.close()
            return

        segments = build_segments_from_duration(
            duration_seconds, interval_seconds, start_seconds
        )
        await websocket.send_json(
            {
                "type": "status",
                "message": f"Starting full-duration generation over {len(segments)} segments.",
            }
        )

        aggregated = {
            "video_id": video_id,
            "interval_seconds": int(interval_seconds),
            "start_offset": int(start_seconds),
            "duration_seconds": duration_seconds,
            "segments": [],
        }

        for idx, (seg_start, seg_end) in enumerate(segments, start=1):
            await websocket.send_json(
                {
                    "type": "status",
                    "message": f"[{idx}/{len(segments)}] {seg_start}-{seg_end}s",
                }
            )
            result_text = await asyncio_to_thread(
                generate_questions_for_segment_with_retry,
                video_id,
                seg_start,
                seg_end,
                provider = provider,
            )
            result_obj = _maybe_parse_json(result_text)
            result_obj = _wrap_segment_result(
                video_id, seg_start, seg_end, result_text, result_obj
            )
            aggregated["segments"].append(
                {"start": seg_start, "end": seg_end, "result": result_obj}
            )
            await websocket.send_json(
                {
                    "type": "segment_result",
                    "start": seg_start,
                    "end": seg_end,
                    "result": result_obj,
                }
            )

        await websocket.send_json(
            {
                "type": "done",
                "segments_count": len(segments),
                "auto_saved": False,
                "data": aggregated,
            }
        )
        await websocket.close()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
            await websocket.close()
        except Exception:
            pass


# small helper: run sync function in thread (keeps this file standalone)
def asyncio_to_thread(func, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(None, lambda: func(*args, **kwargs))


@router_admin_api.get("/reports/child/{child_id}")
async def api_get_child_report(child_id: str):
    """Return quiz score report for one child, used by parental reports tab."""
    report = get_child_report(child_id)
    return JSONResponse({"success": True, "report": report})