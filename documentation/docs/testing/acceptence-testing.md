---
sidebar_position: 3
---

# Acceptance Tests

All acceptance tests are in `tests/test_acceptance.py` and use FastAPI's `TestClient` to simulate complete user scenarios from start to finish.

## How to Run

```bash
pytest tests/test_acceptance.py -v
```

## Overview

Acceptance tests cover full user flows — login, creating children, answering quizzes, setting access codes. They verify the app behaves correctly from the user's perspective.

---

## Admin Flows

| Test | What it checks |
|---|---|
| `test_admin_can_login` | admin login with correct password succeeds; wrong password fails |
| `test_admin_can_create_child_profile` | admin can create a child profile via API |
| `test_admin_cannot_create_duplicate_child_under_same_expert` | duplicate child under same parent is rejected |

## Learner Flows

| Test | What it checks |
|---|---|
| `test_learner_enters_expert_id_and_sees_children` | child login with parent ID returns children list |
| `test_learner_cannot_see_inactive_child` | deactivated children are hidden from learner view |
| `test_child_video_list_scoped_to_expert_assignments` | child only sees videos assigned to their parent |
| `test_student_loads_app_and_answers_correctly` | full flow: load config → answer question → marked correct |

## Quiz / Companion Behavior

| Test | What it checks |
|---|---|
| `test_pig_reads_back_learners_spoken_answer` | companion reads back the learner's answer |
| `test_pig_returns_almost_for_borderline_answer` | borderline answer returns "almost" feedback |
| `test_pig_reveals_correct_answer_for_wrong_response` | wrong answer reveals the correct one |
| `test_student_misspells_pikachu_and_still_gets_correct` | fuzzy matching accepts close-enough answers |
| `test_student_answers_spinning_cat_question` | multi-word answer graded correctly |

## Access Code

| Test | What it checks |
|---|---|
| `test_access_code_set_and_verify` | parent sets access code; code is stored in plain text and hashed form |

---

## Manual Tests

These require a real browser and cannot be automated.

### Child logs in and watches a video
1. Go to the Kids screen
2. Enter the parent's access code
3. Select a child profile
4. Select a video and start watching
5. Confirm quiz questions appear at the right intervals

### Parent sets access code
1. Log in to the parent dashboard
2. Click Access Code
3. Set a code (max 5 characters)
4. Log out and have a child log in with that code
5. Confirm login succeeds

### Parent claims a video
1. Log in to the parent dashboard
2. Go to My Videos
3. Click Add Video and select a processed video
4. Confirm it appears in the list
5. Click Remove and confirm it disappears
