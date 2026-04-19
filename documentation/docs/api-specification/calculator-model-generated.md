---
title: Internal Code Contract
sidebar_position: 3
description: Core backend service contracts (implementation-level).
---

# Internal Code Contract (Python)

This page documents internal service contracts that implement the backend API.

## `app/services/sqlite_store.py`

### `init_db() -> None`
- Purpose: Create all SQLite tables and run pending schema migrations on startup.
- Postconditions: `experts`, `children`, `video_assignments` tables exist and are up to date.

### `get_conn() -> sqlite3.Connection`
- Purpose: Open and return a new SQLite connection to the app database.

## `app/services/expert_auth_service.py`

### `hash_password(password: str) -> str`
- Purpose: Bcrypt-hash a plain-text password for storage.

### `verify_password(password: str, stored_hash: str) -> bool`
- Purpose: Compare a plain-text password against a stored bcrypt hash.

### `create_expert(expert_id, display_name, password) -> Dict[str, Any]`
- Purpose: Insert a new expert row with hashed password.
- Error behavior: raises `HTTPException(409)` if `expert_id` already exists.

### `update_expert(expert_id, display_name, password) -> Optional[Dict[str, Any]]`
- Purpose: Update display name and/or password for an existing expert.

### `deactivate_expert(expert_id) -> Optional[Dict[str, Any]]`
- Purpose: Soft-delete an expert by setting `is_active = 0`.

### `delete_expert(expert_id) -> bool`
- Purpose: Hard-delete an expert row.

### `authenticate_expert(expert_id, password) -> Optional[Dict[str, Any]]`
- Purpose: Verify credentials and return expert data on success, `None` on failure.

### `list_experts() -> List[Dict[str, Any]]`
- Purpose: Return all active expert rows.

### `get_expert(expert_id) -> Optional[Dict[str, Any]]`
- Purpose: Fetch a single expert by ID.

### `add_video_assignment(video_id, expert_id, source) -> None`
- Purpose: Assign a video to an expert (claim).

### `remove_video_assignment(video_id, expert_id) -> None`
- Purpose: Unclaim a video from an expert.

### `list_video_assignments() -> List[Dict[str, Any]]`
- Purpose: Return all video-to-expert assignment rows.

### `list_video_ids_for_expert(expert_id) -> List[str]`
- Purpose: Return all video IDs claimed by an expert.

### `can_expert_access_video(expert_id, video_id) -> bool`
- Purpose: Check whether an expert has access to a video.

## `app/services/children_service.py`

### `create_child(expert_id, first_name, last_name, icon_key, interaction_mode) -> Dict[str, Any]`
- Purpose: Insert a new child profile linked to an expert.
- Returns: created child dict with generated `child_id`.
- Error behavior: raises `HTTPException(404)` if expert not found.

### `get_child(child_id, include_inactive) -> Optional[Dict[str, Any]]`
- Purpose: Fetch a single child by ID.

### `list_children(expert_id, include_inactive) -> List[Dict[str, Any]]`
- Purpose: List children for an expert, optionally including inactive ones.

### `update_child(child_id, fields) -> Optional[Dict[str, Any]]`
- Purpose: Update allowed child fields (`first_name`, `last_name`, `icon_key`, `interaction_mode`).

### `deactivate_child(child_id) -> Optional[Dict[str, Any]]`
- Purpose: Soft-delete a child by setting `is_active = 0`.

### `delete_child(child_id) -> bool`
- Purpose: Hard-delete a child row.

### `generate_child_id() -> str`
- Purpose: Generate a unique random child ID.

## `app/services/report_service.py`

### `get_child_report_scoped(child_id, mode) -> Dict[str, Any]`
- Purpose: Compute a filtered report for a child scoped to a specific interaction mode.
- Returns: dict with `overall_score`, `total_retries`, `watch_minutes`, `top_categories`, `recent_sessions`.

### `get_child_report(child_id, limit) -> Dict[str, Any]`
- Purpose: Compute a full unscoped report for a child (admin view).
- Returns: same shape as `get_child_report_scoped` but across all modes.

### `_compute_top_categories(attempts, window) -> List[Dict[str, Any]]`
- Purpose: Identify the weakest question categories from recent attempts.
- Returns: sorted list of `{category, score}` dicts.

### `_load_attempts(child_id, downloads_dir) -> List[Dict[str, Any]]`
- Purpose: Load all quiz result JSON files for a child from the filesystem.

## `app/services/quiz_scoring_service.py`

### `save_quiz_result(child_id, video_id, score_data, session_id) -> dict`
- Purpose: Persist a completed quiz attempt as a JSON file under `downloads/<video_id>/scores/`.
- Returns: dict with `success`, `session_id`, `file`.

### `get_child_scores(child_id) -> dict`
- Purpose: Load all quiz attempt files for a child across all videos.
- Returns: dict with `success`, `count`, `scores`.

## `app/services/personalize_quiz_service.py`

### `generate_persona_variants(questions, best_question_text) -> Dict[str, Any]`
- Purpose: Use an LLM to rewrite questions in each companion's voice (Blossom, Pippa, Ash).
- Returns: dict keyed by companion name with rewritten question text.
- Preconditions: `OPENAI_API_KEY` configured.

## `app/services/video_files.py`

### `find_primary_video_file(video_dir: Path) -> Optional[Path]`
- Purpose: Find the main video file in a downloaded video directory.
- Returns: `Path` to the video file or `None` if not found.

### `list_question_json_files() -> List[Dict[str, str]]`
- Purpose: Scan `downloads/` and return all available question JSON files with metadata.

## `app/services/frame_service.py`

### `extract_frames_per_second_for_video(video_id: str) -> Dict[str, Any]`
- Purpose: Extract 1 frame per second from `downloads/<video_id>/` and persist frame metadata.
- Parameters: `video_id` (video folder id).
- Returns: dict with `success`, `message`, `files`, `video_id`, `output_dir`, `count`.
- Preconditions: video folder exists and contains a supported video file.
- Postconditions: writes `extracted_frames/`, `frame_data.json`, `frame_data.csv`.
- Error behavior: returns structured failure payload for missing folder/video/FPS/read issues.

## `app/services/question_generation_service.py`

### `encode_image_to_base64(image_path, max_size=(512, 512)) -> Optional[str]`
- Purpose: Convert frame image to resized base64 JPEG.
- Returns: base64 string or `None` on error.

### `time_to_seconds(time_str) -> int`
- Purpose: Convert `HH:MM:SS` / `MM:SS` / seconds text to integer seconds.
- Returns: parsed seconds or `0` on invalid input.

### `read_frame_data_from_csv(folder_name, start_time, end_time) -> Tuple[List[Dict[str, Any]], str]`
- Purpose: Load and filter frame rows for a segment; build transcript text.
- Returns: `(frame_data, complete_transcript)`.

### `generate_questions_for_segment(video_id, start_time, end_time, polite_first=False, provider=None) -> Optional[str]`
- Purpose: Generate segment question JSON from frames + transcript via LLM provider.
- Returns: JSON text on success, JSON error payload text for known failures, or `None`.
- Preconditions: frames/transcript exist; provider credentials configured.

### `generate_questions_for_segment_with_retry(video_id, start_time, end_time, max_attempts=10, provider=None) -> Optional[str]`
- Purpose: Retry orchestration for segment generation.
- Returns: successful JSON text or final failure result.

### `build_segments_from_duration(duration_seconds, interval_seconds, start_offset=0) -> List[tuple]`
- Purpose: Build inclusive segment windows `(start, end)` over duration.

### `persist_segment_questions_json(video_id, start, end, payload) -> Optional[str]`
- Purpose: Save one segment's question payload into `downloads/<video_id>/questions/`.
- Returns: downloads URL or `None` on failure.

### `resolve_question_file_param(value) -> Optional[Path]`
- Purpose: Safely resolve user-supplied question JSON path under `DOWNLOADS_DIR`.
- Returns: resolved JSON `Path` or `None` if invalid/unsafe.

## `app/services/download_service.py`

### `download_youtube(url: str) -> Dict[str, Any]`
- Purpose: Download YouTube video, gather metadata, and persist `meta.json`.
- Returns: normalized result dict (`success`, `message`, `video_id`, `title`, `thumbnail`, `files`, optional `duration`, `local_path`).
- Preconditions: valid YouTube URL.
- Postconditions: creates/updates `downloads/<video_id>/` assets.
- Error behavior: returns structured failure payload (no unhandled route-level exception expected).

## `app/services/expert_review_service.py`

### `build_expert_preview_data(file, video, mode) -> Dict[str, Any]`
- Purpose: Build expert preview context (segments, selected file/video, annotation state).

### `save_expert_annotation_payload(payload) -> Dict[str, Any]`
- Purpose: Save/update expert annotation for segment.
- Error behavior: raises `HTTPException(400/500)` on validation/persistence failure.

### `get_expert_questions_payload(video_id) -> Tuple[Dict[str, Any], int]`
- Purpose: Load stored expert questions for video.

### `save_expert_question_payload(payload) -> Tuple[Dict[str, Any], int]`
- Purpose: Upsert expert question (or skipped segment marker).

### `save_final_questions_payload(payload) -> Tuple[Dict[str, Any], int]`
- Purpose: Persist final ranked questions to `final_questions.json`.

## `app/services/clients.py`

### `get_openai_client() -> OpenAI`
- Purpose: Build cached OpenAI client from environment.
- Preconditions: `OPENAI_API_KEY` exists.
- Error behavior: raises `RuntimeError` if key missing.

## Route-to-Service Traceability

- `POST /api/download` - `download_youtube`
- `POST /api/frames/{video_id}` - `extract_frames_per_second_for_video`
- `WS /ws/questions/{video_id}` - segment generation functions in `question_generation_service.py`
- `POST /api/expert-annotations` - `save_expert_annotation_payload`
- `GET /api/expert-questions/{video_id}` - `get_expert_questions_payload`
- `POST /api/expert-questions` - `save_expert_question_payload`
- `POST /api/save-final-questions` - `save_final_questions_payload`
- `POST /api/admin/children` - `create_child`
- `GET /api/admin/children` - `list_children`
- `PUT /api/admin/children/{child_id}` - `update_child`
- `POST /api/expert/login` - `authenticate_expert`
- `GET /api/expert/report` - `get_child_report_scoped`
- `GET /api/learners/children/{child_id}/report` - `get_child_report`
- `POST /api/save-quiz-score` - `save_quiz_result`
- `GET /api/get-quiz-scores/{child_id}` - `get_child_scores`
- `GET /api/final-questions/{video_id}` - `generate_persona_variants` (companion variant lookup)
