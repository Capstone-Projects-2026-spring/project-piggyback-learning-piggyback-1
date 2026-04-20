---
sidebar_position: 1
description: Backend API contract overview and internal code contract scope.
---

Design Document - Part II API
=============================

This page defines the backend API contract scope for this project and points to the two required contract artifacts.

This project maintains two contracts:

- `HTTP API Contract (OpenAPI/Swagger)`: external behavior (endpoints, request/response schemas, errors, auth).
- `Internal Code Contract (Python Javadoc-style)`: internal implementation responsibilities (core modules, function purpose, params, returns, exceptions, pre/post conditions).

If implementation changes, both contracts must be updated.

## Required Artifacts

- OpenAPI spec source: `documentation/static/openapi.yml.yaml`
- Rendered API docs page: `documentation/docs/api-specification/openapi-spec.md`
- Internal code contract page: `documentation/docs/api-specification/internal-code-contract.md` (recommended)

This page is an overview. The canonical endpoint schema definitions belong in `openapi.yml.yaml`.

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

### Parent (Expert) Routes (`main.py`)

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

## Maintenance Requirement

Update documentation whenever any of the following changes:

- Route path or HTTP method
- Request model or response model
- Auth behavior or security policy
- Error schema
- Core service function signature or module responsibility
