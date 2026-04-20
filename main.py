# main.py
from pathlib import Path
from typing import List, Dict, Any, Optional
import base64
import json
import asyncio
from datetime import datetime, timezone
from app.services.sqlite_store import init_db, get_conn
from app.services.expert_auth_service import (
    add_video_assignment,
    authenticate_expert,
    can_expert_access_video,
    claim_video_for_expert,
    ensure_video_assignment_rows,
    list_experts_for_video,
    list_video_assignments,
    get_expert,
    list_video_ids_for_expert,
    normalize_expert_id,
    remove_video_assignment,
    verify_password,
)
from app.services.children_service import get_child, list_children
from video_quiz_routes import router_video_quiz, router_api, refresh_kids_videos_json
from app.services.clients import get_openai_client
from fastapi import (
    FastAPI,
    Form,
    Request,
    Body,
    Query,
    HTTPException,
)
from app.services.video_files import find_primary_video_file
from app.services.expert_review_service import (
    build_expert_preview_data,
    save_expert_annotation_payload,
    get_expert_questions_payload,
    save_expert_question_payload,
    save_final_questions_payload,
)
from app.services.personalize_quiz_service import generate_persona_variants
#Stores expert login session in single cookie
from starlette.middleware.sessions import SessionMiddleware

from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from app.web import templates



from admin_routes import router_admin_pages, router_admin_api, router_admin_ws
from app.settings import (
    ADMIN_PASSWORD,
    DOWNLOADS_DIR,
    EXPERT_PASSWORD,
    PUBLIC_ASSETS_DIR,
    EXPERT_QUESTION_TYPE_LABELS,
    EXPERT_QUESTION_TYPES,
    EXPERT_QUESTION_TYPE_VALUES,
    SESSION_SECRET,
    HUME_API_KEY,
    HUME_VOICE_IDS,
)
from app.services.clients import get_openai_client


app = FastAPI(title="Piggyback Learning")

#middleware enables request.session
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    same_site="lax",
    https_only=False,
)

#Startup ensures SQLite schema exisit every booot.
@app.on_event("startup")
def startup_init_db():
    init_db()

def require_expert_session(request: Request) -> Dict[str,str]:
    role = request.session.get("role")
    expert_id = request.session.get("expert_id")
    display_name = request.session.get("display_name")

    if role != "expert" or not expert_id:
        raise HTTPException(status_code = 403, detail = "Expert login required")
    
    return {
        "expert_id":str(expert_id),
        "display_name":str(display_name or expert_id),
    }


def require_expert_video_access(
    request: Request, video_id: str, auto_claim: bool = False
) -> Dict[str, str]:
    #keep one gate for all expert-protected route
    expert_identity = require_expert_session(request)
    normalized_video_id = (video_id or "").strip()

    if not normalized_video_id:
        raise HTTPException(status_code=400, detail="video_id is required")
    #Assigned-only policy : no auto-claim access path
    if can_expert_access_video(expert_identity["expert_id"], normalized_video_id):
        return expert_identity

    raise HTTPException(status_code=403, detail="Forbidden")



app.include_router(router_video_quiz, prefix="/api")  # kids_videos etc
app.include_router(router_api, prefix="/api")  # transcribe, check_answer, config

# Mount admin routers
app.include_router(router_admin_pages, prefix="/admin")
app.include_router(router_admin_api, prefix="/api")
app.include_router(router_admin_ws)

# Serve the downloads directory so the user can click the files
app.mount("/downloads", StaticFiles(directory=str(DOWNLOADS_DIR)), name="downloads")
if PUBLIC_ASSETS_DIR.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(PUBLIC_ASSETS_DIR)),
        name="public-assets",
    )

# -----------------------------
@app.get("/health")
def healthcheck():
    return JSONResponse({"ok": True})


@app.get("/", response_class=HTMLResponse)
def home_page(request: Request):
    """Learner landing page"""
    return templates.TemplateResponse("children.html", {"request": request})


@app.get("/home", response_class=HTMLResponse)
def home_redirect():
    """Redirect old home route to learner landing"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/")


@app.get("/children", response_class=HTMLResponse)
def children_page(request: Request):
    """Children's learning interface - no password required"""
    return templates.TemplateResponse("children.html", {"request": request})

@app.get("/api/learners/experts/{expert_id}/children")
async def learner_list_children_for_expert(expert_id: str):
    # Learner starts by entering expert ID; return active child profiles.
    normalized_expert_id = normalize_expert_id(expert_id)
    if not normalized_expert_id:
        return JSONResponse(
            {"success": False, "message": "expert_id is required", "children": []},
            status_code=400,
        )

    expert = get_expert(normalized_expert_id)
    if not expert or not bool(expert.get("is_active")):
        return JSONResponse(
            {"success": False, "message": "Expert not found", "children": []},
            status_code=404,
        )

    children = list_children(expert_id=normalized_expert_id, include_inactive=False)
    return JSONResponse(
        {
            "success": True,
            "expert": {
                "expert_id": expert["expert_id"],
                "display_name": expert.get("display_name") or expert["expert_id"],
            },
            "children": children,
            "count": len(children),
        }
    )


@app.post("/api/learners/parents/login")
async def parent_login(request: Request):
    body = await request.json()
    code = (body.get("login_code") or body.get("parent_id") or "").strip()

    if not code:
        return JSONResponse({"success": False, "error": "Please enter your access code."}, status_code=400)

    parent_id = None
    display_name = None

    with get_conn() as conn:
        # Try plain text custom code first
        row = conn.execute(
            "SELECT * FROM parents WHERE login_code = ? AND is_active = 1", (code,)
        ).fetchone()

        if row:
            parent_id = row["parent_id"]
            display_name = row["display_name"]
        else:
            # Try matching by parent_id in parents table (no custom code set)
            row = conn.execute(
                "SELECT * FROM parents WHERE parent_id = ? AND is_active = 1", (code.lower(),)
            ).fetchone()
            if row:
                # Only allow this if no custom code has been set
                if not row["login_code"]:
                    parent_id = row["parent_id"]
                    display_name = row["display_name"]
            else:
                # Parent never saved a code — look up in experts table by expert_id
                expert_row = conn.execute(
                    "SELECT * FROM experts WHERE expert_id = ? AND is_active = 1", (code.lower(),)
                ).fetchone()
                if expert_row:
                    parent_id = expert_row["expert_id"]
                    display_name = expert_row["display_name"] or expert_row["expert_id"]

    if not parent_id:
        return JSONResponse({"success": False, "error": "Invalid Login Code. Please try again."}, status_code=401)

    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM children
            WHERE is_active = 1
              AND (parent_id = ? OR (parent_id IS NULL AND expert_id = ?))
            """,
            (parent_id, parent_id),
        ).fetchall()

    children = [dict(r) for r in rows]
    return JSONResponse({
        "success": True,
        "parent": {"parent_id": parent_id, "display_name": display_name},
        "children": children
    })


@app.get("/api/learners/children/{child_id}/report")
async def learner_child_report(child_id: str):
    from app.services.report_service import get_child_report
    report = get_child_report(child_id)
    return JSONResponse(report)


# ── Expert Card 3 APIs ────────────────────────────────────────────────────────

@app.get("/api/expert/parents")
async def expert_list_parents(expert_id: str):
    """Return parents that have at least one active child assigned to this expert."""
    expert_id = (expert_id or "").strip().lower()
    if not expert_id:
        return JSONResponse({"success": False, "error": "expert_id required"}, status_code=400)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT p.parent_id, p.display_name
            FROM parents p
            JOIN children c ON c.parent_id = p.parent_id
            WHERE c.expert_id = ? AND c.is_active = 1 AND p.is_active = 1
            ORDER BY p.display_name
            """,
            (expert_id,),
        ).fetchall()
    return JSONResponse({"success": True, "parents": [dict(r) for r in rows]})


@app.get("/api/expert/parents/{parent_id}/children")
async def expert_list_parent_children(parent_id: str, expert_id: str):
    """Return active children under a parent that are assigned to this expert."""
    expert_id = (expert_id or "").strip().lower()
    if not expert_id:
        return JSONResponse({"success": False, "error": "expert_id required"}, status_code=400)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT child_id, first_name, last_name, icon_key, interaction_mode, is_active
            FROM children
            WHERE parent_id = ? AND expert_id = ? AND is_active = 1
            ORDER BY first_name
            """,
            (parent_id, expert_id),
        ).fetchall()
    return JSONResponse({"success": True, "children": [dict(r) for r in rows]})


@app.put("/api/expert/parents/{parent_id}/login-code")
async def expert_update_parent_login_code(parent_id: str, request: Request):
    """Allow an expert to reset a parent's login code if they have a child under that parent."""
    from app.services.expert_auth_service import hash_password
    body = await request.json()
    expert_id = (body.get("expert_id") or "").strip().lower()
    new_code = (body.get("login_code") or "").strip()

    if not expert_id or not new_code:
        return JSONResponse({"success": False, "error": "expert_id and login_code are required."}, status_code=400)
    if len(new_code) < 4:
        return JSONResponse({"success": False, "error": "Login code must be at least 4 characters."}, status_code=400)

    with get_conn() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM children WHERE expert_id = ? AND parent_id = ? AND is_active = 1",
            (expert_id, parent_id),
        ).fetchone()[0]
        if count == 0:
            return JSONResponse({"success": False, "error": "Not authorized to update this parent's login code."}, status_code=403)

        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE parents SET login_code_hash = ?, updated_at = ? WHERE parent_id = ?",
            (hash_password(new_code), now, parent_id),
        )
        conn.commit()

    return JSONResponse({"success": True, "message": "Login code updated."})


@app.get("/api/expert/access-code")
async def expert_access_code(request: Request):
    identity = require_expert_session(request)
    parent_id = identity["expert_id"]
    with get_conn() as conn:
        row = conn.execute(
            "SELECT login_code_hash, login_code FROM parents WHERE parent_id = ?", (parent_id,)
        ).fetchone()
    has_custom_code = bool(row and row["login_code_hash"])
    plain_code = row["login_code"] if row and row["login_code"] else None
    return JSONResponse({"parent_id": parent_id, "has_custom_code": has_custom_code, "login_code": plain_code})


@app.put("/api/expert/my-login-code")
async def expert_update_own_login_code(request: Request):
    from app.services.expert_auth_service import hash_password
    identity = require_expert_session(request)
    parent_id = identity["expert_id"]
    body = await request.json()
    new_code = (body.get("login_code") or "").strip()

    if not new_code or len(new_code) > 5:
        return JSONResponse({"success": False, "error": "Login code must be 5 characters or fewer."}, status_code=400)

    now = datetime.now(timezone.utc).isoformat()
    code_hash = hash_password(new_code)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO parents (parent_id, display_name, login_code_hash, login_code, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(parent_id) DO UPDATE SET
                login_code_hash = excluded.login_code_hash,
                login_code = excluded.login_code,
                updated_at = excluded.updated_at
            """,
            (parent_id, identity["display_name"], code_hash, new_code, now, now),
        )
        conn.commit()
    return JSONResponse({"success": True})


@app.get("/api/expert/report")
async def expert_child_report(child_id: str, video_id: str = None, mode: str = "all"):
    """Scoped report for a child, optionally filtered by video and interaction mode."""
    from app.services.report_service import get_child_report_scoped
    report = get_child_report_scoped(child_id, video_id=video_id or None, mode=mode)
    return JSONResponse(report)


@app.get("/api/learners/children/{child_id}/videos")
async def learner_list_videos_for_child(child_id: str):
    # Child inherits expert video permissions (no child-video table in this phase).
    child = get_child(child_id, include_inactive=False)
    if not child:
        return JSONResponse(
            {"success": False, "message": "Child not found", "videos": []},
            status_code=404,
        )

    expert_id = (child.get("expert_id") or "").strip()
    if not expert_id:
        return JSONResponse(
            {
                "success": True,
                "child": child,
                "videos": [],
                "count": 0,
                "message": "Child is not linked to an expert",
            }
        )

    assigned_video_ids = {
        (video_id or "").strip().lower()
        for video_id in list_video_ids_for_expert(expert_id)
        if (video_id or "").strip()
    }

    if not assigned_video_ids:
        return JSONResponse({"success": True, "child": child, "videos": [], "count": 0})

    all_videos = refresh_kids_videos_json()
    scoped_videos = [
        video
        for video in all_videos
        if str(video.get("video_id") or "").strip().lower() in assigned_video_ids
    ]

    return JSONResponse(
        {"success": True, "child": child, "videos": scoped_videos, "count": len(scoped_videos)}
    )


#Route: Handles expert login requests from the frontend
@app.post("/api/expert/login")
async def expert_login(request: Request, payload: Dict[str,Any]= Body(...)):
    # Extract the expert_id and password from the request body.
    expert_id = str(payload.get("expert_id")or "").strip().lower()
    password = str(payload.get("password")or "")

    #need to check if the expert credentials are valid. right 

    account = authenticate_expert(expert_id, password)

    # If authentication fails, return an error response.
    if not account:
        return JSONResponse(
            {"success": False, "message": "Invalid expert ID or password"},
            status_code=401,
        )
    
    # Save the role so we know this user is an expert , so is id so is name.
    request.session["role"] = "expert"
    request.session["expert_id"] = account["expert_id"]
    request.session["display_name"] = account["display_name"]

    return JSONResponse(
        {
            "success": True,
            "redirect": "/expert-preview",
            "expert": account,
        }
    )

#Logout feature, clear expert session cleanly.
@app.post("/api/expert/logout")
async def expert_logout(request: Request):
    request.session.clear()
    return JSONResponse({"success": True})


@app.post("/api/verify-password")
async def verify_password(
    user_type: str = Form(...), password: str = Form(...)
):
    """Verify password for admin access (expert uses ID+password endpt)"""
    if user_type == "admin" and password.strip().lower() == ADMIN_PASSWORD.strip().lower():
        return JSONResponse({"success": True, "redirect": "/admin"})

    if user_type == "expert":
        return JSONResponse(
            {"success": False, "message": "Use expert ID + password login."}
        )

    return JSONResponse({"success": False, "message": "Invalid password"})


# -----------------------------
# YouTube Search API (child-safe with duration filters)
# -----------------------------
@app.get("/expert-preview", response_class=HTMLResponse)
def expert_preview(
    request: Request,
    file: Optional[str] = Query(None),
    video: Optional[str] = Query(None),
    mode: Optional[str] = Query("review"),
):
    expert_identity = require_expert_session(request)
    if video:
        require_expert_video_access(request, video, auto_claim=False)

    preview_data = build_expert_preview_data(file=file, video=video, mode=mode)
    context = {
        "request": request,
        **preview_data,
        "question_type_options": [
            {"value": value, "label": label} for value, label in EXPERT_QUESTION_TYPES
        ],
        "expert_identity": expert_identity,
    }
    return templates.TemplateResponse("expert_preview.html", context)


@app.post("/api/expert-annotations")
async def save_expert_annotation(payload: Dict[str, Any] = Body(...)):
    result = save_expert_annotation_payload(payload)
    return JSONResponse(result)


@app.get("/api/videos-list")
async def list_videos():
    """List all downloaded videos with title, thumbnail, duration, and question counts."""
    try:
        videos = []
        if not DOWNLOADS_DIR.exists():
            return JSONResponse({"success": True, "videos": []})

        for video_dir in sorted(DOWNLOADS_DIR.iterdir()):
            if not video_dir.is_dir():
                continue

            video_id = video_dir.name
            meta_path = video_dir / "meta.json"
            meta_data = {}

            if meta_path.exists():
                try:
                    meta_data = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception:
                    meta_data = {}

            title = meta_data.get("title", video_id)
            thumbnail = meta_data.get("thumbnail", "")
            duration = meta_data.get("duration", 0)

            video_file = find_primary_video_file(video_dir)
            if not video_file:
                continue

            questions_dir = video_dir / "questions"
            question_files = []
            if questions_dir.exists():
                question_files = [
                    p for p in questions_dir.glob("*.json") if p.is_file()
                ]

            question_count = len(question_files)

            # Create video URL
            video_url = f"/downloads/{video_file.relative_to(DOWNLOADS_DIR).as_posix()}"

            videos.append(
                {
                    "id": video_id,
                    "title": title,
                    "thumbnail": thumbnail,
                    "duration": duration,
                    "videoUrl": video_url,
                    "questionCount": question_count,
                }
            )

        return JSONResponse({"success": True, "videos": videos})

    except Exception as e:
        return JSONResponse(
            {"success": False, "message": f"Error listing videos: {e}", "videos": []}
        )


@app.get("/api/expert-questions/{video_id}")
async def get_expert_questions(request: Request, video_id: str):
    try:
        require_expert_video_access(request, video_id, auto_claim=False)
    except HTTPException as exc:
        return JSONResponse(
            {"success": False, "message": exc.detail}, status_code=exc.status_code
        )

    result, status_code = get_expert_questions_payload(video_id)
    return JSONResponse(result, status_code=status_code)

#protect save expert question route
@app.post("/api/expert-questions")
async def save_expert_question(request: Request, payload: Dict[str, Any] = Body(...)):
    video_id = str(payload.get("videoId") or payload.get("video_id") or "").strip()
    if not video_id:
        return JSONResponse(
            {"success": False, "message": "videoId is required"}, status_code=400
        )

    if not (DOWNLOADS_DIR / video_id).exists():
        return JSONResponse({"success": False, "message": "Video not found"}, status_code=404)

    try:
        require_expert_video_access(request, video_id, auto_claim=False)
    except HTTPException as exc:
        return JSONResponse(
            {"success": False, "message": exc.detail}, status_code=exc.status_code
        )

    result, status_code = save_expert_question_payload(payload)
    return JSONResponse(result, status_code=status_code)


@app.post("/api/save-final-questions")
async def save_final_questions(request: Request, payload: Dict[str, Any] = Body(...)):
    video_id = str(payload.get("videoId") or "").strip()
    if not video_id:
        return JSONResponse({"success": False, "message": "videoId is required"}, status_code=400)

    if not (DOWNLOADS_DIR / video_id).exists():
        return JSONResponse({"success": False, "message": "Video not found"}, status_code=404)

    try:
        require_expert_video_access(request, video_id, auto_claim=False)
    except HTTPException as exc:
        return JSONResponse(
            {"success": False, "message": exc.detail}, status_code=exc.status_code
        )

    result, status_code = save_final_questions_payload(payload)
    return JSONResponse(result, status_code=status_code)


# ============================================================
# Expert: edit finalized questions (re-edit after finalize)
# ============================================================

@app.get("/expert/edit/{video_id}", response_class=HTMLResponse)
async def expert_edit_questions_page(request: Request, video_id: str):
    """Page for editing finalized questions after finalization."""
    expert_identity = require_expert_session(request)
    require_expert_video_access(request, video_id, auto_claim=False)
    return templates.TemplateResponse("edit_questions.html", {
        "request": request,
        "video_id": video_id,
        "expert_identity": expert_identity,
    })


@app.get("/api/expert/video/{video_id}/persona-variants")
async def get_persona_variants_for_video(request: Request, video_id: str):
    """Load saved persona variant questions for a video."""
    try:
        require_expert_session(request)
        require_expert_video_access(request, video_id, auto_claim=False)
    except HTTPException as exc:
        return JSONResponse({"success": False, "message": exc.detail}, status_code=exc.status_code)

    path = DOWNLOADS_DIR / video_id / "persona_variants" / "persona_variants.json"
    if not path.exists():
        return JSONResponse({"success": True, "data": {}})

    data = json.loads(path.read_text(encoding="utf-8"))
    return JSONResponse({"success": True, "data": data})


@app.post("/api/expert/video/{video_id}/persona-variants")
async def save_persona_variants_for_video(request: Request, video_id: str, payload: Dict[str, Any] = Body(...)):
    """Save or update persona variant questions for one or more segments of a video."""
    try:
        require_expert_session(request)
        require_expert_video_access(request, video_id, auto_claim=False)
    except HTTPException as exc:
        return JSONResponse({"success": False, "message": exc.detail}, status_code=exc.status_code)

    folder = DOWNLOADS_DIR / video_id / "persona_variants"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "persona_variants.json"

    # Load existing data and merge
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"videoId": video_id, "segments": {}}
    existing.setdefault("segments", {})

    incoming = payload.get("segments", {})
    for seg_key, seg_data in incoming.items():
        if seg_key not in existing["segments"]:
            existing["segments"][seg_key] = {}
        if "persona_variants" in seg_data:
            existing["segments"][seg_key]["persona_variants"] = seg_data["persona_variants"]
        if "persona_winners" in seg_data:
            existing["segments"][seg_key]["persona_winners"] = seg_data["persona_winners"]

    existing["updatedAt"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
    return JSONResponse({"success": True})


@app.get("/api/expert/video/{video_id}/final-questions")
async def get_final_questions_for_edit(request: Request, video_id: str):
    """Returns the full raw final_questions.json so the expert can re-edit all questions."""
    try:
        require_expert_session(request)
        require_expert_video_access(request, video_id, auto_claim=False)
    except HTTPException as exc:
        return JSONResponse({"success": False, "message": exc.detail}, status_code=exc.status_code)

    path = DOWNLOADS_DIR / video_id / "final_questions" / "final_questions.json"
    if not path.exists():
        return JSONResponse({"success": False, "message": "No finalized questions found. Finalize from expert preview first."}, status_code=404)

    data = json.loads(path.read_text(encoding="utf-8"))
    return JSONResponse({"success": True, "data": data})


@app.post("/api/expert/video/{video_id}/update-questions")
async def update_final_questions(request: Request, video_id: str, payload: Dict[str, Any] = Body(...)):
    """Saves edited question/answer text back to final_questions.json."""
    try:
        require_expert_session(request)
        require_expert_video_access(request, video_id, auto_claim=False)
    except HTTPException as exc:
        return JSONResponse({"success": False, "message": exc.detail}, status_code=exc.status_code)

    path = DOWNLOADS_DIR / video_id / "final_questions" / "final_questions.json"
    if not path.exists():
        return JSONResponse({"success": False, "message": "No finalized questions found."}, status_code=404)

    # Load existing data so we only overwrite segments (preserve metadata fields)
    existing = json.loads(path.read_text(encoding="utf-8"))
    existing["segments"] = payload.get("segments", existing.get("segments", []))
    existing["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(existing, indent=2), encoding="utf-8")

    return JSONResponse({"success": True, "message": "Questions updated successfully."})


@app.post("/api/expert/video/{video_id}/regenerate-question")
async def regenerate_single_question(request: Request, video_id: str, payload: Dict[str, Any] = Body(...)):
    """Uses OpenAI to regenerate a single question+answer for a segment."""
    try:
        require_expert_session(request)
        require_expert_video_access(request, video_id, auto_claim=False)
    except HTTPException as exc:
        return JSONResponse({"success": False, "message": exc.detail}, status_code=exc.status_code)

    question_type = payload.get("question_type", "open_ended")
    current_question = payload.get("current_question", "")
    current_answer = payload.get("current_answer", "")
    segment_start = payload.get("segment_start", "")
    segment_end = payload.get("segment_end", "")

    prompt = (
        f"You are helping an expert improve a quiz question for a children's educational video.\n"
        f"Segment time range: {segment_start}s to {segment_end}s\n"
        f"Question type: {question_type}\n"
        f"Current question: {current_question}\n"
        f"Current answer: {current_answer}\n\n"
        f"Please write an improved version of this question and answer. "
        f"Keep it age-appropriate for children ages 5-10. "
        f"Return ONLY a JSON object with keys 'question' and 'answer', nothing else."
    )

    try:
        response = get_openai_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0.7,
        )
        raw = response.choices[0].message.content.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        return JSONResponse({"success": True, "question": result.get("question", ""), "answer": result.get("answer", "")})
    except Exception as e:
        return JSONResponse({"success": False, "message": f"Regeneration failed: {e}"}, status_code=500)


@app.get("/api/expert/videos")
async def list_expert_videos(request: Request):
    try:
        expert_identity = require_expert_session(request)
    except HTTPException as exc:
        return JSONResponse(
            {"success": False, "message": exc.detail, "videos": []},
            status_code=exc.status_code,
        )

    videos: List[Dict[str, Any]] = []
    if not DOWNLOADS_DIR.exists():
        return JSONResponse({"success": True, "videos": []})

    for video_dir in sorted(DOWNLOADS_DIR.iterdir()):
        if not video_dir.is_dir():
            continue

        video_id = video_dir.name
        meta_path = video_dir / "meta.json"
        meta_data: Dict[str, Any] = {}
        if meta_path.exists():
            try:
                meta_data = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta_data = {}

        title = meta_data.get("title", video_id)
        thumbnail = meta_data.get("thumbnail", "")
        duration = meta_data.get("duration", 0)

        video_file = find_primary_video_file(video_dir)
        if not video_file:
            continue

        questions_dir = video_dir / "questions"
        question_files = []
        if questions_dir.exists():
            question_files = [p for p in questions_dir.glob("*.json") if p.is_file()]

        video_url = f"/downloads/{video_file.relative_to(DOWNLOADS_DIR).as_posix()}"
        videos.append(
            {
                "id": video_id,
                "title": title,
                "thumbnail": thumbnail,
                "duration": duration,
                "videoUrl": video_url,
                "questionCount": len(question_files),
            }
        )
    expert_id_norm = (expert_identity["expert_id"] or "").strip().lower()
    filtered: List[Dict[str, Any]] = []
    for video in videos:
        #get all experts assigned to this video from the new many -to - many table
        assigned_experts = list_experts_for_video(video["id"])
        assigned_to_me = any(
            str(e.get("expert_id") or "").strip().lower() == expert_id_norm
            for e in assigned_experts
        )
        if assigned_to_me:
            filtered.append(
                {
                    **video,
                    "assigned_to_me":True,
                    "assigned_expert_count": len(assigned_experts),
                }
            )
    return JSONResponse({"success": True, "videos": filtered})


@app.get("/api/expert/videos/available")
async def list_available_videos(request: Request):
    """Return all processed videos with their title so parent can pick one to claim."""
    try:
        require_expert_session(request)
    except HTTPException as exc:
        return JSONResponse({"success": False, "message": exc.detail}, status_code=exc.status_code)

    videos = []
    if DOWNLOADS_DIR.exists():
        for video_dir in sorted(DOWNLOADS_DIR.iterdir()):
            if not video_dir.is_dir():
                continue
            meta_path = video_dir / "meta.json"
            title = video_dir.name
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    title = meta.get("title") or title
                except Exception:
                    pass
            videos.append({"id": video_dir.name, "title": title})
    return JSONResponse({"success": True, "videos": videos})


@app.post("/api/expert/videos/{video_id}/claim")
async def claim_expert_video(request: Request, video_id: str):
    normalized_video_id = (video_id or "").strip()
    if not normalized_video_id:
        return JSONResponse({"success": False, "message": "video_id is required"}, status_code=400)

    if not (DOWNLOADS_DIR / normalized_video_id).exists():
        return JSONResponse({"success": False, "message": "Video not found"}, status_code=404)

    try:
        expert_identity = require_expert_session(request)
    except HTTPException as exc:
        return JSONResponse({"success": False, "message": exc.detail}, status_code=exc.status_code)

    try:
        add_video_assignment(normalized_video_id, expert_identity["expert_id"], source="expert_claim")
    except Exception as exc:
        return JSONResponse({"success": False, "message": str(exc)}, status_code=400)

    return JSONResponse({"success": True})


@app.delete("/api/expert/videos/{video_id}/unclaim")
async def unclaim_expert_video(request: Request, video_id: str):
    normalized_video_id = (video_id or "").strip()
    if not normalized_video_id:
        return JSONResponse({"success": False, "message": "video_id is required"}, status_code=400)

    try:
        expert_identity = require_expert_session(request)
    except HTTPException as exc:
        return JSONResponse({"success": False, "message": exc.detail}, status_code=exc.status_code)

    try:
        remove_video_assignment(normalized_video_id, expert_identity["expert_id"])
    except Exception as exc:
        return JSONResponse({"success": False, "message": str(exc)}, status_code=400)

    return JSONResponse({"success": True})


@app.post("/api/expert/questions/persona-variants")
async def get_persona_variants(request: Request, payload: Dict[str, Any] = Body(...)):
    """Rephrase AI-generated questions into Bunny, Alligator, and Pig personas."""
    try:
        require_expert_session(request)
    except HTTPException as exc:
        return JSONResponse({"success": False, "message": exc.detail}, status_code=exc.status_code)

    questions = payload.get("questions")
    if not isinstance(questions, dict) or not questions:
        return JSONResponse({"success": False, "message": "questions dict is required"}, status_code=400)

    best_question = payload.get("best_question")
    result = await asyncio.to_thread(generate_persona_variants, questions, best_question)
    print (result)
    return JSONResponse(result)


@app.post("/api/tts")
async def synthesize_tts(payload: Dict[str, Any] = Body(...)):
    text = str(payload.get("text") or "").strip()
    if not text:
        return JSONResponse({"success": False, "message": "text is required"}, status_code=400)

    # Use Hume when a companion is specified and API key is configured
    companion = str(payload.get("companion") or "").lower()
    voice_id = HUME_VOICE_IDS.get(companion) if companion else None
    if voice_id and HUME_API_KEY:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.hume.ai/v0/tts",
                    headers={"X-Hume-Api-Key": HUME_API_KEY, "Content-Type": "application/json"},
                    json={"utterances": [{"text": text, "voice": {"id": voice_id}}], "format": {"type": "mp3"}},
                )
                resp.raise_for_status()
                audio_b64 = resp.json()["generations"][0]["audio"]
            return JSONResponse({"success": True, "audio": audio_b64, "format": "mp3"})
        except Exception as e:
            return JSONResponse({"success": False, "message": str(e)}, status_code=502)

    voice = str(payload.get("voice") or "sage").strip() or "sage"
    raw_speed = payload.get("speed", 0.75)
    try:
        speed = float(raw_speed)
    except (TypeError, ValueError):
        speed = 0.75
    speed = max(0.25, min(speed, 4.0))
    response_format = str(payload.get("format") or "mp3").strip() or "mp3"

    def _synthesize(voice_name: str) -> bytes:
        with get_openai_client().audio.speech.with_streaming_response.create(
            model="gpt-4o-mini-tts",
            voice=voice_name,
            input=text,
            speed=speed,
        ) as response:
            return response.read()

    try:
        audio_bytes = await asyncio.to_thread(_synthesize, voice)
    except Exception as exc:
        # Attempt a graceful fallback if the requested voice is unavailable.
        fallback_voice = "alloy"
        error_message = str(exc)
        should_retry_with_fallback = (
            voice.lower() != fallback_voice
            and any(
                keyword in error_message.lower()
                for keyword in ("voice", "unknown", "not found", "unsupported")
            )
        )
        if should_retry_with_fallback:
            try:
                audio_bytes = await asyncio.to_thread(_synthesize, fallback_voice)
                voice = fallback_voice
            except Exception as retry_exc:
                error_message = f"{error_message} | fallback_failed={retry_exc}"
                return JSONResponse(
                    {
                        "success": False,
                        "message": f"TTS generation failed: {error_message}",
                    },
                    status_code=502,
                )
        else:
            return JSONResponse(
                {
                    "success": False,
                    "message": f"TTS generation failed: {error_message}",
                },
                status_code=502,
            )
    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
    return JSONResponse(
        {"success": True, "audio": audio_b64, "format": response_format, "voice": voice}
    )


app.mount("/static", StaticFiles(directory="static"), name="static")
