---
sidebar_position: 1
description: Backend API contract overview and internal code contract scope.
---

Design Document - Part II API
=============================

This page covers the full backend API contract for Piggyback - all HTTP endpoints, authentication, error handling, and internal service contracts.

The canonical endpoint schema definitions (request/response shapes) are in the OpenAPI spec: `documentation/static/openapi.yml.yaml`.

## Frontend and Backend Split

### Frontend Contract

Frontend communicates with backend using:

- REST routes under `/api`
- WebSocket route `/ws/questions/{video_id}`

### Backend Contract

Backend is implemented with FastAPI and exposes:

- HTML page routes
- JSON/form/multipart API routes
- WebSocket streaming route

## Backend API Surface (Inventory)

### Admin Routes (`admin_routes.py`)

**Admin auth and expert management:**
- `POST /api/admin/verify-access`
- `GET /api/admin/experts`
- `POST /api/admin/experts`
- `PUT /api/admin/experts/{expert_id}`
- `POST /api/admin/experts/{expert_id}/deactivate`
- `DELETE /api/admin/experts/{expert_id}`

**Admin children management:**
- `GET /api/admin/children`
- `POST /api/admin/children`
- `PUT /api/admin/children/{child_id}`
- `POST /api/admin/children/{child_id}/deactivate`
- `POST /api/admin/children/{child_id}/unlink`
- `DELETE /api/admin/children/{child_id}`

**Admin video and question management:**
- `GET /api/admin/videos`
- `GET /api/admin/videos/assignments`
- `POST /api/admin/videos/assignments`
- `POST /api/download`
- `POST /api/frames/{video_id}`
- `POST /api/submit-questions`
- `WS /ws/questions/{video_id}`

`POST /api/download` keeps the same request body and now may include these optional response fields:
- `error_code: string`
- `recovery_hint: string`
- `auth_source: "browser" | "cookiefile" | "none"`
- `used_player_client: string[]`

The latest downloader update did not change the request or response shape. It changed backend behavior only:
- browser and cookie auth are reused across metadata, video, and subtitle fetches
- FFmpeg-backed repair is attempted when a downloaded `.mp4` is really an HLS transport stream

**Admin report:**
- `GET /api/reports/child/{child_id}`

### Parent Routes (`main.py`)

**Auth:**
- `POST /api/expert/login`
- `POST /api/expert/logout`
- `GET /api/expert/access-code`
- `PUT /api/expert/my-login-code`

**Parent management:**
- `GET /api/expert/parents`
- `GET /api/expert/parents/{parent_id}/children`
- `PUT /api/expert/parents/{parent_id}/login-code`

**Question review:**
- `GET /api/expert/video/{video_id}/final-questions`
- `POST /api/expert/video/{video_id}/update-questions`
- `POST /api/expert/video/{video_id}/regenerate-question`
- `GET /api/expert/videos`
- `GET /api/expert/videos/available`
- `POST /api/expert/videos/{video_id}/claim`
- `DELETE /api/expert/videos/{video_id}/unclaim`
- `GET /api/expert/report`

### Child (Learner) Routes (`main.py` and `video_quiz_routes.py`)

**Login and profile:**
- `POST /api/learners/parents/login`
- `GET /api/learners/experts/{expert_id}/children`
- `GET /api/learners/children/{child_id}/videos`
- `GET /api/learners/children/{child_id}/report`

**Quiz playback:**
- `GET /api/kids_videos`
- `GET /api/final-questions/{video_id}`
- `POST /api/check_answer`
- `POST /api/transcribe`
- `POST /api/save-quiz-score`
- `GET /api/get-quiz-scores/{child_id}`
- `GET /api/config`

### Shared Routes (`main.py`)

- `GET /api/videos-list`
- `GET /api/expert-questions/{video_id}`
- `POST /api/expert-questions`
- `POST /api/save-final-questions`
- `POST /api/tts`
- `POST /api/verify-password`
- `POST /api/expert-annotations`

## Authentication and Authorization (Current State)

Current implementation uses:

- `POST /api/expert/login` - parent/expert logs in with their personal access code (stored as bcrypt hash in SQLite).
- `POST /api/learners/parents/login` - child login by entering the parent's access code, returns linked child profiles.
- `POST /api/admin/verify-access` - admin authenticates with the `ADMIN_PASSWORD` environment variable.

Current limitations:

- No formal JWT/session token contract is defined in OpenAPI yet.
- Authorization is cookie/session based, not uniformly expressed as token-based route security.
- Any auth model update requires immediate OpenAPI `securitySchemes` and route `security` updates.

## Error Handling (Current State)

Current behavior varies by endpoint:

- Some responses return JSON with failure fields (for example `success: false`, `message`).
- `POST /api/download` now also returns downloader-specific failure details such as `error_code`, `recovery_hint`, `auth_source`, and `used_player_client`.
- Some flows use `HTTPException`.
- FastAPI validation errors may return `422`.

Contract requirement:

- OpenAPI must define endpoint-specific error responses and payload schemas.

## Traceability (Endpoint - Internal Responsibility)

- `POST /api/frames/{video_id}` - `app/services/frame_service.py::extract_frames_per_second_for_video`
- `POST /api/download` - `app/services/download_service.py::download_youtube`
- `WS /ws/questions/{video_id}` - orchestration in `admin_routes.py` + generation in `app/services/question_generation_service.py`
- `POST /api/check_answer` - scoring flow in `video_quiz_routes.py`
- `POST /api/transcribe` - transcription flow in `video_quiz_routes.py`
- `GET /api/kids_videos` - local video discovery in `video_quiz_routes.py`
- `GET /api/expert/report` - `app/services/report_service.py::get_child_report_scoped`
- `GET /api/learners/children/{child_id}/report` - `app/services/report_service.py::get_child_report`
- `POST /api/admin/children` - `app/services/children_service.py::create_child`
- `POST /api/expert/login` - `app/services/expert_auth_service.py::verify_password`

## Internal Service Contracts

### `app/services/sqlite_store.py`
- `init_db()` - Creates all SQLite tables and runs pending schema migrations on startup.
- `get_conn()` - Opens and returns a new SQLite connection to the app database.

### `app/services/expert_auth_service.py`
- `hash_password(password)` - Hashes a plain-text password for storage.
- `verify_password(password, stored_hash)` - Compares a plain-text password against a stored hash.
- `authenticate_expert(expert_id, password)` - Verifies credentials and returns expert data on success, `None` on failure.
- `create_expert(expert_id, display_name, password)` - Inserts a new expert row. Raises `409` if `expert_id` already exists.
- `update_expert(expert_id, display_name, password)` - Updates display name and/or password.
- `deactivate_expert(expert_id)` - Soft-deletes an expert by setting `is_active = 0`.
- `delete_expert(expert_id)` - Hard-deletes an expert row.
- `list_experts()` - Returns all active expert rows.
- `get_expert(expert_id)` - Fetches a single expert by ID.
- `add_video_assignment(video_id, expert_id, source)` - Assigns a video to an expert.
- `remove_video_assignment(video_id, expert_id)` - Removes a video assignment from an expert.
- `can_expert_access_video(expert_id, video_id)` - Returns true if the expert has access to the video.

### `app/services/children_service.py`
- `create_child(expert_id, first_name, last_name, icon_key, interaction_mode)` - Creates a child profile linked to an expert. Returns the created child dict. Raises `404` if expert not found.
- `get_child(child_id, include_inactive)` - Fetches a single child by ID.
- `list_children(expert_id, include_inactive)` - Lists children for an expert.
- `update_child(child_id, fields)` - Updates allowed child fields.
- `deactivate_child(child_id)` - Soft-deletes a child by setting `is_active = 0`.
- `delete_child(child_id)` - Hard-deletes a child row.

### `app/services/report_service.py`
- `get_child_report(child_id, limit)` - Computes a full report for a child across all videos and modes.
- `get_child_report_scoped(child_id, mode)` - Computes a filtered report scoped to a specific interaction mode. Returns `overall_score`, `total_retries`, `watch_minutes`, `top_categories`, `recent_sessions`.

### `app/services/quiz_scoring_service.py`
- `save_quiz_result(child_id, video_id, score_data, session_id)` - Saves a completed quiz attempt as a JSON file. Returns `success`, `session_id`, `file`.
- `get_child_scores(child_id)` - Loads all quiz attempt files for a child across all videos.

### `app/services/question_generation_service.py`
- `generate_questions_for_segment(video_id, start_time, end_time, provider)` - Generates quiz questions for a video segment using frames and transcript via an AI provider.
- `generate_questions_for_segment_with_retry(video_id, start_time, end_time, max_attempts, provider)` - Retry wrapper for segment generation.
- `build_segments_from_duration(duration_seconds, interval_seconds)` - Builds segment windows `(start, end)` over a video duration.
- `time_to_seconds(time_str)` - Converts `HH:MM:SS` or `MM:SS` to integer seconds.

### `app/services/personalize_quiz_service.py`
- `generate_persona_variants(questions, best_question_text)` - Rewrites questions in each companion's voice (Blossom, Pippa, Ash) using an LLM. Returns variants keyed by companion name.

### `app/services/expert_review_service.py`
- `get_expert_questions_payload(video_id)` - Loads stored expert questions for a video.
- `save_expert_question_payload(payload)` - Upserts an expert question or skipped segment marker.
- `save_final_questions_payload(payload)` - Persists final ranked questions to `final_questions.json`.
- `save_expert_annotation_payload(payload)` - Saves expert annotation for a segment.

### `app/services/frame_service.py`
- `extract_frames_per_second_for_video(video_id)` - Extracts 1 frame per second from a downloaded video. Writes `extracted_frames/`, `frame_data.json`, and `frame_data.csv`. Returns `success`, `count`, `output_dir`.

### `app/services/download_service.py`
- `download_youtube(url)` - Downloads a YouTube video, gathers metadata, and persists `meta.json`. Returns `success`, `video_id`, `title`, `thumbnail`, `files`. Returns a structured failure payload on error rather than crashing.

---

## Maintenance Requirement

Update documentation whenever any of the following changes:

- Route path or HTTP method
- Request model or response model
- Auth behavior or security policy
- Error schema
- Core service function signature or module responsibility
