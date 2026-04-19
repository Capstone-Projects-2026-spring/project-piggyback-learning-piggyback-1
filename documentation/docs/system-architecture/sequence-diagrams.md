---
sidebar_position: 6
---

# Sequence Diagrams

## Use Case 1 - Admin downloads a video and generates questions

```mermaid
sequenceDiagram
    participant Admin
    participant App
    participant YTDLP
    participant YouTube
    participant AI

    Admin->>App: Log in with admin password
    App-->>Admin: Display admin panel
    Admin->>App: Paste YouTube URL and submit
    App->>YTDLP: Download video
    YTDLP->>YouTube: Fetch video and metadata
    YouTube-->>YTDLP: Video file and subtitles
    YTDLP-->>App: Video saved locally
    App->>App: Extract frames and transcript
    App->>AI: Generate questions from frames and transcript
    AI-->>App: Questions JSON
    App-->>Admin: Questions ready for parent review
```

---

## Use Case 2 - Parent sets up their child's profile

```mermaid
sequenceDiagram
    participant Parent
    participant App
    participant DB

    Parent->>App: Enter personal access code
    App->>DB: Verify login code
    DB-->>App: Authenticated
    App-->>Parent: Display parent dashboard
    Parent->>App: Navigate to child management
    Parent->>App: Enter child name, icon, interaction mode
    App->>DB: Save child profile
    DB-->>App: Profile created
    App-->>Parent: Child profile ready
```

---

## Use Case 3 - Parent reviews and approves quiz questions

```mermaid
sequenceDiagram
    participant Parent
    participant App
    participant Storage

    Parent->>App: Navigate to question review
    Parent->>App: Select a video
    App->>Storage: Load AI-generated questions
    Storage-->>App: Questions list
    App-->>Parent: Display questions
    Parent->>App: Edit or remove questions as needed
    Parent->>App: Save final questions
    App->>Storage: Write final_questions.json
    App-->>Parent: Questions saved and ready for kids
```

---

## Use Case 4 - Child logs in and picks a companion

```mermaid
sequenceDiagram
    participant Child
    participant App
    participant DB

    Child->>App: Enter parent access code
    App->>DB: Look up access code
    DB-->>App: Return linked children
    App-->>Child: Display child profiles
    Child->>App: Select profile
    App-->>Child: Show companion selection screen
    Child->>App: Pick companion (Bunny, Pig, or Alligator)
    App-->>Child: Display video library
```

---

## Use Case 5 - Child watches a video and answers quiz questions

```mermaid
sequenceDiagram
    participant Child
    participant App
    participant Companion
    participant API

    Child->>App: Select a video
    App->>API: Load questions and interaction mode
    API-->>App: Questions and mode ready
    App->>Child: Begin playing video
    App->>App: Pause at question timestamp
    App->>Companion: Play companion prompt audio
    Companion-->>Child: Ask question out loud
    Child->>App: Speak answer (voice recorded)
    App->>API: Submit answer for evaluation
    API-->>App: Return status - correct, almost, or wrong
    App->>Companion: Play feedback audio
    Companion-->>Child: Give feedback
    App->>API: Save quiz result
    App->>Child: Resume video
```

---

## Use Case 6 - Child's voice is not recognized

```mermaid
sequenceDiagram
    participant Child
    participant App
    participant Companion

    App->>Child: Display question and start recording
    Child->>App: Speak answer
    App->>App: Silence detected - no speech recognized
    App->>Companion: Play retry prompt
    Companion-->>Child: Ask to try again
    Child->>App: Speak answer again
    App->>App: Evaluate second attempt
    App-->>Child: Show result
```

---

## Use Case 7 - Parent checks their child's report

```mermaid
sequenceDiagram
    participant Parent
    participant App
    participant ReportService
    participant Storage

    Parent->>App: Enter personal access code
    App-->>Parent: Display parent dashboard
    Parent->>App: Navigate to report section
    Parent->>App: Select child and click Load Report
    App->>ReportService: Request report for child
    ReportService->>Storage: Load quiz results
    Storage-->>ReportService: Quiz attempt history
    ReportService-->>App: Computed report data
    App-->>Parent: Display score, retries, watch time, recent sessions
    Parent->>App: Adjust child interaction mode if needed
    App->>Storage: Save updated mode
```
