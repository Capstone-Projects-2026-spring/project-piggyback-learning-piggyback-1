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

### API Routes (JSON, form, multipart)

- `POST /api/verify-password`
- `POST /api/expert-annotations`
- `GET /api/videos-list`
- `GET /api/expert-questions/{video_id}`
- `POST /api/expert-questions`
- `POST /api/save-final-questions`
- `POST /api/tts`
- `POST /api/download`
- `POST /api/frames/{video_id}`
- `GET /api/admin/videos`
- `POST /api/submit-questions`
- `GET /api/kids_videos`
- `GET /api/final-questions/{video_id}`
- `POST /api/check_answer`
- `POST /api/transcribe`
- `GET /api/config`

### WebSocket Route

- `WS /ws/questions/{video_id}`

Client payload fields:

- `start_seconds`
- `interval_seconds`
- `full_duration`

Server event types:

- `status`
- `segment_result`
- `done`
- `error`

## Authentication and Authorization (Current State)

Current implementation includes:

- `POST /api/verify-password` for admin/expert password checks.

Current limitations:

- No formal JWT/session token contract is defined in OpenAPI yet.
- Authorization is not uniformly expressed as token-based route security.
- Any auth model update requires immediate OpenAPI `securitySchemes` and route `security` updates.

## Error Handling (Current State)

Current behavior varies by endpoint:

- Some responses return JSON with failure fields (for example `success: false`, `message`).
- Some flows use `HTTPException`.
- FastAPI validation errors may return `422`.

Contract requirement:

- OpenAPI must define endpoint-specific error responses and payload schemas.

## Traceability (Endpoint -> Internal Responsibility)

- `POST /api/frames/{video_id}` -> `app/services/frame_service.py::extract_frames_per_second_for_video`
- `WS /ws/questions/{video_id}` -> orchestration in `admin_routes.py` + generation functions in `app/services/question_generation_service.py`
- `POST /api/check_answer` -> scoring flow in `video_quiz_routes.py`
- `POST /api/transcribe` -> transcription flow in `video_quiz_routes.py`
- `GET /api/kids_videos` -> local video discovery/refresh flow in `video_quiz_routes.py`

## Maintenance Requirement

Update documentation whenever any of the following changes:

- Route path or HTTP method
- Request model or response model
- Auth behavior or security policy
- Error schema
- Core service function signature or module responsibility
