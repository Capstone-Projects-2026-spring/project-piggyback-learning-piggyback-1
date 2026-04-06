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

Integration tests verify that API endpoints behave correctly end-to-end — request in, response out, correct status codes and payloads. No browser or real network needed.

---

## Quiz / Answer Checking

| Test | Endpoint | What it checks |
|---|---|---|
| `test_check_answer_correct` | `POST /api/check_answer` | correct answer returns success |
| `test_get_config` | `GET /api/config` | config endpoint returns expected shape |
| `test_learner_can_fetch_video_list` | `GET /api/kids_videos` | video list returns successfully |
| `test_learner_can_fetch_questions_for_video` | `GET /api/final-questions/{video_id}` | questions returned for a valid video |

## Child Management

| Test | Endpoint | What it checks |
|---|---|---|
| `test_admin_can_unlink_child_endpoint` | `POST /api/admin/children/{id}/unlink` | child unlinked from parent |
| `test_admin_can_relink_child_with_put` | `PUT /api/admin/children/{id}` | child re-linked via update |
| `test_learner_child_videos_empty_when_unlinked` | `GET /api/learners/children/{id}/videos` | unlinked child sees no videos |
| `test_delete_expert_endpoint_unlinks_child_not_fail` | `DELETE /api/admin/experts/{id}` | deleting parent does not hard-fail on linked children |
| `test_delete_child_endpoint` | `DELETE /api/admin/children/{id}` | child deleted successfully |
| `test_delete_child_nonexistent_returns_404` | `DELETE /api/admin/children/{id}` | 404 returned for unknown child |

## Icon Validation

| Test | Endpoint | What it checks |
|---|---|---|
| `test_new_icon_keys_accepted_by_api` | `POST /api/admin/children` | new icon keys accepted |
| `test_invalid_icon_rejected_by_api` | `POST /api/admin/children` | invalid icon key returns 400 |
| `test_duplicate_name_same_expert_allowed_via_api` | `POST /api/admin/children` | duplicate name allowed via API |

## Video Claiming

| Test | What it checks |
|---|---|
| `test_claim_and_unclaim_video_api` | claim and unclaim calls hit the correct service functions (mocked, no DB write) |

## Reports

| Test | What it checks |
|---|---|
| `test_get_child_report_scoped_filters_by_mode` | report filters attempts by interaction mode correctly (mocked) |
