---
sidebar_position: 2
---

# Integration Tests

All integration tests are in `tests/test_integration.py` and use FastAPI's `TestClient` to send real HTTP requests without running a live server.

## How to Run

```bash
pytest tests/test_integration.py -v
```

## Overview

Integration tests verify that API endpoints behave correctly end-to-end - request in, response out, correct status codes and payloads. No browser or real network needed.

---

## Quiz / Answer Checking

| Test | Endpoint | What it checks | Fails if |
|---|---|---|---|
| `test_check_answer_correct` | `POST /api/check_answer` | correct answer returns success | correct answer is marked wrong or endpoint crashes |
| `test_get_config` | `GET /api/config` | config endpoint returns expected shape | response is missing required fields |
| `test_learner_can_fetch_video_list` | `GET /api/kids_videos` | video list returns successfully | endpoint errors or returns wrong format |
| `test_learner_can_fetch_questions_for_video` | `GET /api/final-questions/{video_id}` | questions returned for a valid video | questions are missing or malformed |

## Child Management

| Test | Endpoint | What it checks | Fails if |
|---|---|---|---|
| `test_admin_can_unlink_child_endpoint` | `POST /api/admin/children/{id}/unlink` | child unlinked from parent | child remains linked after the call |
| `test_admin_can_relink_child_with_put` | `PUT /api/admin/children/{id}` | child re-linked via update | update is ignored or returns wrong status |
| `test_learner_child_videos_empty_when_unlinked` | `GET /api/learners/children/{id}/videos` | unlinked child sees no videos | unlinked child can still access videos they shouldn't see |
| `test_delete_expert_endpoint_unlinks_child_not_fail` | `DELETE /api/admin/experts/{id}` | deleting parent does not hard-fail on linked children | server crashes when a parent with children is deleted |
| `test_delete_child_endpoint` | `DELETE /api/admin/children/{id}` | child deleted successfully | child record remains in DB after delete |
| `test_delete_child_nonexistent_returns_404` | `DELETE /api/admin/children/{id}` | 404 returned for unknown child | server crashes or returns 200 for a child that does not exist |

## Icon Validation

| Test | Endpoint | What it checks | Fails if |
|---|---|---|---|
| `test_new_icon_keys_accepted_by_api` | `POST /api/admin/children` | new icon keys accepted | valid icons are rejected, blocking child creation |
| `test_invalid_icon_rejected_by_api` | `POST /api/admin/children` | invalid icon key returns 400 | bad icon is silently accepted and stored |
| `test_duplicate_name_same_expert_allowed_via_api` | `POST /api/admin/children` | duplicate name allowed via API | second child with same name is incorrectly rejected |

## Video Claiming

| Test | What it checks | Fails if |
|---|---|---|
| `test_claim_and_unclaim_video_api` | claim and unclaim calls hit the correct service functions | wrong service is called or no DB change is made |

## Reports

| Test | What it checks | Fails if |
|---|---|---|
| `test_get_child_report_scoped_filters_by_mode` | report filters attempts by interaction mode correctly | all attempts are returned regardless of mode, mixing strict and flexible data |

## Parent Login

| Test | Endpoint | What it checks | Fails if |
|---|---|---|---|
| `test_parent_login_wrong_code_returns_failure` | `POST /api/learners/parents/login` | wrong access code returns `success: false` | wrong code is accepted and grants access |
| `test_parent_login_empty_code_returns_400` | `POST /api/learners/parents/login` | empty code returns 400 | empty string is treated as a valid code |

## Downloader API

| Test | Endpoint | What it checks | Fails if |
|---|---|---|---|
| `test_download_endpoint_returns_structured_failure_payload` | `POST /api/download` | protected-download failures return structured fields (`error_code`, `recovery_hint`, `auth_source`) | server crashes with an unhandled exception instead of returning a useful error to the frontend |
