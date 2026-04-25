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

Test runtime files stay inside repo-local temporary folders and are cleaned after the run, so pytest should not leave random `tmp_*` project folders behind.

---

## Video Timestamp Helpers

| Test | What it checks | Fails if |
|---|---|---|
| `test_time_to_seconds_mmss` | `"1:30"` → `90` | returns a value other than `90`, or crashes on valid input |
| `test_time_to_seconds_hhmmss` | `"1:00:00"` → `3600` | hours are ignored or parsed incorrectly |
| `test_time_to_seconds_bad_input` | `"bad"` → `0` | raises an exception instead of returning `0` |
| `test_time_to_seconds_none` | `None` raises `AttributeError` | silently returns a value instead of raising |
| `test_time_to_seconds_seconds_only` | `"45"` → `45` | single-segment input is misread as minutes |
| `test_time_to_seconds_hhmmss_full` | `"2:30:15"` → `9015` | hours or seconds component is dropped |

## Text Normalization

| Test | What it checks | Fails if |
|---|---|---|
| `test_normalize_text_removes_stopwords` | `"the big dog"` → `"big dog"` | stopwords are kept, causing fuzzy match to underperform |
| `test_normalize_text_maps_synonyms` | `"scared"` → `"afraid"` | synonym is not mapped, so a correct-but-different-word answer is marked wrong |
| `test_normalize_text_empty` | empty string → empty string | returns `None` or raises on empty input |

## Segment Builder

| Test | What it checks | Fails if |
|---|---|---|
| `test_build_segments_standard` | 180s at 60s intervals → 4 segments | wrong segment count means questions appear at wrong times |
| `test_build_segments_shorter_last` | last segment shorter than interval | last segment is dropped or padded to full interval |
| `test_build_segments_single` | single 60s segment | returns empty list or two segments for a short video |

## Video Assignment (Many-to-Many)

| Test | What it checks | Fails if |
|---|---|---|
| `test_add_assignment` | adding a video-expert pair persists correctly | assignment is not saved to DB |
| `test_two_experts_same_video` | two parents can claim the same video | second claim overwrites the first |
| `test_remove_assignment` | removing a pair deletes only that row | other assignments are also deleted |
| `test_claim_is_idempotent` | claiming the same video twice does not duplicate | duplicate rows are inserted |
| `test_claim_video_calls_add_assignment` | claim flow calls correct service function | wrong service function is called |
| `test_unclaim_video_calls_remove_assignment` | unclaim flow calls correct service function | unclaim silently does nothing |

## Child Management

| Test | What it checks | Fails if |
|---|---|---|
| `test_generate_child_id_is_6_digit` | child IDs are always 6 numeric digits | shorter IDs or non-numeric IDs are generated |
| `test_create_and_list_child` | created child appears in list | child is saved but not retrievable |
| `test_same_name_different_experts_allowed` | same name under different parents is valid | child creation is incorrectly rejected |
| `test_duplicate_name_same_expert_now_allowed` | duplicate names allowed under same parent | creation is incorrectly blocked |
| `test_invalid_icon_rejected` | unknown icon key raises `ValueError` | invalid icon is silently accepted and stored |
| `test_update_and_deactivate_child` | updating fields and deactivating work correctly | fields do not persist or child remains active after deactivation |
| `test_new_icon_keys_are_valid` | all current icon keys pass validation | a valid icon key is rejected after being added |
| `test_bad_icon_still_rejected` | invalid icon key still fails after new icons added | validation is too loose and accepts anything |
| `test_normalize_child_id_strips_whitespace` | whitespace trimmed from child ID | ID with spaces fails lookup even though it should match |
| `test_normalize_child_id_empty` | empty string returns empty | raises instead of returning empty |
| `test_normalize_name_collapses_spaces` | extra spaces collapsed in name | name stored with inconsistent spacing |
| `test_normalize_name_empty` | empty name returns empty | raises on empty name input |
| `test_normalize_icon_key_lowercases` | icon key lowercased on save | `"Pig"` and `"pig"` treated as different icons |
| `test_delete_child_removes_record` | deleted child no longer in DB | child record remains after delete |
| `test_delete_child_nonexistent_returns_false` | deleting unknown child returns false | raises an exception instead of returning false |

## Password Hashing

| Test | What it checks | Fails if |
|---|---|---|
| `test_hash_password_is_not_plaintext` | stored hash differs from raw password | password is stored in plain text (security failure) |
| `test_verify_password_correct` | correct password verifies successfully | valid login is rejected |
| `test_verify_password_wrong` | wrong password fails verification | incorrect password is accepted (authentication bypass) |

## Database Schema

> These tests use a temporary in-memory SQLite instance that is created fresh for each run and wiped clean after. No real data is stored and nothing carries over between test runs - it is safe and isolated.

| Test | What it checks | Fails if |
|---|---|---|
| `test_parents_table_exists` | parents table created on init | table is missing and parent login crashes |
| `test_parents_table_has_correct_columns` | all expected columns present | a missing column causes runtime errors on insert or select |
| `test_children_has_parent_id_column` | children table has parent_id FK | parent-child linking is silently broken |
| `test_parents_table_has_login_code_column` | login_code plain text column exists | access code lookup fails at runtime |
| `test_upsert_login_code_stores_plain_and_hash` | access code stored in both plain and hashed form | plain code is missing so parent login with custom code fails |

## Report Service

| Test | What it checks | Fails if |
|---|---|---|
| `test_compute_top_categories_correct_scores` | correct answer scores 100% for its category | correct answer is underscored, unfairly lowering the report |
| `test_compute_top_categories_almost_is_half_point` | almost answer scores 50% for its category | almost is treated as fully correct or fully wrong |
| `test_compute_top_categories_wrong_yields_zero` | wrong answer scores 0% for its category | wrong answer contributes to score, inflating the report |
| `test_report_empty_when_no_attempts` | child with no history returns zeroed-out report | report crashes or returns `None` for a new child |

## Downloader Logic

| Test | What it checks | Fails if |
|---|---|---|
| `test_select_auth_profile_prefers_windows_browser_order` | Windows downloader tries Chrome, Firefox, then Edge | wrong browser order causes unnecessary auth failures |
| `test_select_auth_profile_mac_order_skips_safari` | macOS downloader prefers Chrome and Firefox, not Safari | Safari is tried first and fails on protected videos |
| `test_metadata_and_download_opts_share_browser_auth` | metadata and download requests use the same browser auth | auth mismatch causes metadata to succeed but download to fail |
| `test_select_auth_profile_falls_back_to_cookiefile` | cookie file is used when browser probing fails | downloader gives up instead of trying the cookie fallback |
| `test_classify_auth_error_returns_stable_code_and_hint` | protected-download auth failures map to stable API error fields | frontend receives a raw crash message instead of a useful error |
| `test_subtitle_opts_reuse_used_player_client` | subtitle fetches reuse the successful player client | subtitle fetch uses a different client and fails on protected videos |
| `test_preferred_download_format_has_broad_ffmpeg_fallback` | FFmpeg-enabled format selection keeps a broader fallback | download fails when the preferred format is unavailable |
| `test_download_with_format_fallback_keeps_player_client_first` | format fallback does not drop the chosen protected-video client too early | client is dropped prematurely and protected video download fails |
| `test_apply_runtime_options_enables_remote_ejs_components` | downloader enables remote EJS components for YouTube JS challenges | YouTube JS challenge breaks the download silently |
| `test_resolve_ffmpeg_path_uses_winget_link` | Windows Winget FFmpeg install can be discovered automatically | FFmpeg is not found and video processing fails on Windows |
| `test_repair_invalid_mp4_replaces_file` | invalid HLS `.mp4` downloads are repaired into valid MP4 files | corrupted file is kept and video playback fails |
