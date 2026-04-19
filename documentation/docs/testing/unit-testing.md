---
sidebar_position: 1
---

# Unit Tests

All unit tests are in `tests/test_unit.py` and run with pytest.

## How to Run

```bash
# from the project root
pytest tests/test_unit.py -v
```

## Overview

Unit tests verify individual functions and service layer logic in isolation. No real server is started. Database-touching tests use the test SQLite instance initialized by `init_db()`.

---

## Video Timestamp Helpers

| Test | What it checks |
|---|---|
| `test_time_to_seconds_mmss` | `"1:30"` → `90` |
| `test_time_to_seconds_hhmmss` | `"1:00:00"` → `3600` |
| `test_time_to_seconds_bad_input` | `"bad"` → `0` |
| `test_time_to_seconds_none` | `None` raises `AttributeError` |
| `test_time_to_seconds_seconds_only` | `"45"` → `45` |
| `test_time_to_seconds_hhmmss_full` | `"2:30:15"` → `9015` |

## Text Normalization

| Test | What it checks |
|---|---|
| `test_normalize_text_removes_stopwords` | `"the big dog"` → `"big dog"` |
| `test_normalize_text_maps_synonyms` | `"scared"` → `"afraid"` |
| `test_normalize_text_empty` | empty string → empty string |

## Segment Builder

| Test | What it checks |
|---|---|
| `test_build_segments_standard` | 180s at 60s intervals → 4 segments |
| `test_build_segments_shorter_last` | last segment shorter than interval |
| `test_build_segments_single` | single 60s segment |

## Video Assignment (Many-to-Many)

| Test | What it checks |
|---|---|
| `test_add_assignment` | adding a video-expert pair persists correctly |
| `test_two_experts_same_video` | two parents can claim the same video |
| `test_remove_assignment` | removing a pair deletes only that row |
| `test_claim_is_idempotent` | claiming the same video twice does not duplicate |
| `test_claim_video_calls_add_assignment` | claim flow calls correct service function (mocked) |
| `test_unclaim_video_calls_remove_assignment` | unclaim flow calls correct service function (mocked) |

## Child Management

| Test | What it checks |
|---|---|
| `test_generate_child_id_is_6_digit` | child IDs are always 6 numeric digits |
| `test_create_and_list_child` | created child appears in list |
| `test_same_name_different_experts_allowed` | same name under different parents is valid |
| `test_duplicate_name_same_expert_now_allowed` | duplicate names allowed under same parent |
| `test_invalid_icon_rejected` | unknown icon key raises ValueError |
| `test_update_and_deactivate_child` | updating fields and deactivating work correctly |
| `test_new_icon_keys_are_valid` | all current icon keys pass validation |
| `test_bad_icon_still_rejected` | invalid icon key still fails after new icons added |
| `test_normalize_child_id_strips_whitespace` | whitespace trimmed from child ID |
| `test_normalize_child_id_empty` | empty string returns empty |
| `test_normalize_name_collapses_spaces` | extra spaces collapsed in name |
| `test_normalize_name_empty` | empty name returns empty |
| `test_normalize_icon_key_lowercases` | icon key lowercased on save |
| `test_delete_child_removes_record` | deleted child no longer in DB |
| `test_delete_child_nonexistent_returns_false` | deleting unknown child returns false |

## Password Hashing

| Test | What it checks |
|---|---|
| `test_hash_password_is_not_plaintext` | stored hash differs from raw password |
| `test_verify_password_correct` | correct password verifies successfully |
| `test_verify_password_wrong` | wrong password fails verification |

## Database Schema

| Test | What it checks |
|---|---|
| `test_parents_table_exists` | parents table created on init |
| `test_parents_table_has_correct_columns` | all expected columns present |
| `test_children_has_parent_id_column` | children table has parent_id FK |
| `test_parents_table_has_login_code_column` | login_code plain text column exists |
| `test_upsert_login_code_stores_plain_and_hash` | access code stored in both plain and hashed form |

## Report Service

| Test | What it checks |
|---|---|
| `test_compute_top_categories_correct_scores` | correct answer scores 100% for its category |
| `test_compute_top_categories_almost_is_half_point` | almost answer scores 50% for its category |
| `test_compute_top_categories_wrong_yields_zero` | wrong answer scores 0% for its category |
| `test_report_empty_when_no_attempts` | child with no history returns zeroed-out report |
