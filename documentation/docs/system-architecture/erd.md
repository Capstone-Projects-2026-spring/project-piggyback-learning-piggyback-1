---
sidebar_position: 6
---

# ERD Diagram

**How to read this:** Each box is a database table. Lines show how the tables connect. `||` means "exactly one" and `o{` means "zero or more."

**How this program works:**
- An **Expert** (admin) downloads videos and creates parent accounts. They can view both parents and children for management but cannot access the child interface.
- A **Parent** is created by the admin and creates their children's profiles. They log in to view progress reports and configure their child's interaction mode.
- A **Child** is the learner - they belong to one expert and optionally one parent.
- **Videos** are YouTube videos the expert has downloaded into the system.
- **Video Expert Assignments** tracks which expert manages which video.
- **Quiz Attempts** is a record saved every time a child finishes a quiz on a video.

```mermaid
erDiagram
    EXPERTS {
        text expert_id PK
        text display_name
        text password_hash
        int is_active
    }
    PARENTS {
        text parent_id PK
        text display_name
        text login_code_hash
        text login_code
        int is_active
    }
    CHILDREN {
        text child_id PK
        text expert_id FK
        text parent_id FK
        text first_name
        text last_name
        text icon_key
        text interaction_mode
        int is_active
    }
    VIDEOS {
        text id PK
        text title
        text thumbnail
        float duration
    }
    VIDEO_EXPERT_ASSIGNMENTS {
        text video_id FK
        text expert_id FK
        text assignment_source
        text assigned_at
    }
    QUIZ_ATTEMPTS {
        int attempt_id PK
        text child_id FK
        text video_id FK
        text interaction_mode
        text timestamp
        int total_questions
        int correct
        int incorrect
        float percentage
    }

    EXPERTS ||--o{ PARENTS : "creates and manages"
    PARENTS ||--o{ CHILDREN : "creates and manages"
    EXPERTS ||--o{ VIDEO_EXPERT_ASSIGNMENTS : "is assigned"
    VIDEOS ||--o{ VIDEO_EXPERT_ASSIGNMENTS : "managed by"
    CHILDREN ||--o{ QUIZ_ATTEMPTS : "completes"
    VIDEOS ||--o{ QUIZ_ATTEMPTS : "is watched in"
```
