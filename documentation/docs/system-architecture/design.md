---
sidebar_position: 1
---

# Design

## Architecture Overview

Piggyback Learning is a web application with a FastAPI backend that serves pages and APIs for three user types:

- **Child:** logs in with a parent access code, picks a profile and companion, watches videos, and answers quiz questions by voice.
- **Parent:** logs in with a personal access code, reviews AI-generated questions, manages their child's profile and interaction mode, and views progress reports.
- **Admin:** downloads YouTube videos, generates AI questions, and manages parent accounts.

### Related Diagrams

- System Block Diagram: see `Requirements - System Block Diagram`
- Sequence Diagrams: see `System Architecture - Sequence Diagrams`
- Class Diagrams: see `System Architecture - Class Diagrams`
- ERD Diagram: see `System Architecture - ERD Diagram`

---

## Components

### Web Client (Frontend)
HTML pages served by FastAPI with vanilla JavaScript handling all interactivity. Separate interfaces for children, parents, and admins. The child interface (`children.js`) controls all quiz session behavior - it enforces the active interaction mode, pauses or resumes the video at question timestamps, triggers a rewind to the relevant segment when a child answers incorrectly in Strict mode, and reveals hints and the correct answer in Flexible mode. Parents use the dashboard to review AI-generated questions before they reach children. Communicates with the backend over REST and WebSocket.

### API Server (Backend)
A FastAPI server that acts as the central orchestrator - routing requests, managing user sessions, coordinating video processing, question generation, and quiz evaluation. Full endpoint details are in the API Specification section.

### Answer Evaluation (`check_answer`)
A backend service that receives the child's transcribed voice answer and compares it to the expected answer using fuzzy text matching. For borderline cases, it escalates to OpenAI to make a final judgment. Returns a result of correct, almost, or wrong, which the frontend uses to decide whether to continue, rewind, or reveal the answer.

### Quiz Scoring Service
Saves each quiz attempt to a result file per child, recording the video, score, correct and incorrect counts, retry counts, and watch time. This data feeds the parent progress report.

### Access Code Authentication
Parents receive a personal access code from an admin. Children log in using their parent's access code and then select their profile. This keeps the login flow simple for young children while still linking each child to a parent account.

### Video Acquisition and Processing
Downloads YouTube videos and extracts frames and subtitles for use in question generation.

### AI Question Generation
Sends video frames and transcripts to OpenAI, Anthropic, or Gemini to generate child-friendly comprehension questions. Supports multiple providers so the app is not locked to one.

### Companion and Voice Module
Manages the three companion characters - Blossom the Bunny, Pippa the Pig, and Ash the Alligator. Uses Hume AI to deliver expressive spoken feedback and encouragement during quizzes.

### Report Service
Aggregates each child's quiz results, scores, retries, and watch time into a structured report for parents to review.

### Storage Layer
SQLite stores user accounts, access codes, and child-parent relationships. The local filesystem holds downloaded videos, extracted frames, generated questions, and quiz result files.

---

## Requirements to Architecture Mapping

| Requirement | Components involved |
|---|---|
| Voice-based quiz answers | Web Client (microphone) + Answer Evaluation + API Server |
| Three interaction modes (Flexible, Strict, Passive) | Web Client (`children.js`) + API Server + SQLite |
| Rewind on incorrect answer (Strict mode) | Web Client (`children.js`) uses answer result to seek video |
| Hints and correct answer reveal (Flexible mode) | Web Client (`children.js`) on wrong/almost result |
| Companion-guided experience | Companion and Voice Module + Hume AI |
| AI question generation | Video Acquisition + AI Question Generation + Storage |
| Parent question review | Web Client (parent dashboard) + API Server + Storage |
| Parent progress reports | Report Service + Quiz Scoring Service + Storage |
| Access code login | Access Code Authentication + API Server + SQLite |
| Parent configures child interaction mode | Web Client (parent dashboard) + API Server + SQLite |
| Role-based access (Child, Parent, Admin) | Access Code Authentication + API Server + SQLite |
