---
sidebar_position: 1
---

# Design

## Purpose

This document describes the software architecture for Piggyback Learning and shows how our requirements map to the design. It focuses on the components, their responsibilities, interfaces, and data flow at a high level.

> Note: the system block diagram and sequence diagrams are documented on their dedicated pages and are referenced here rather than duplicated.

## Architecture Overview

Piggyback Learning is a web application with a FastAPI backend that serves pages and APIs for three user types:

- **Child:** logs in with a parent access code, picks a profile and companion, watches videos, and answers quiz questions by voice.
- **Parent:** logs in with a personal access code, reviews AI-generated questions, manages their child's profile and interaction mode, and views progress reports.
- **Admin:** downloads YouTube videos, generates AI questions, and manages parent accounts.

### Related Diagrams

- System Block Diagram: see `Requirements - System Block Diagram`
- Sequence Diagrams: see `System Architecture - Sequence Diagrams`
- Class Diagrams: see `System Architecture - Class Diagrams`

---

## Design Entities

### 1) Web Client (Browser UI)

- **Type:** Frontend - server-rendered templates and static assets
- **Purpose:** Provide usable interfaces for Child, Parent, and Admin.
- **Function:** Renders pages, sends REST requests, uses WebSockets for streaming updates during question generation.
- **Dependencies:** Backend API, browser runtime, microphone for voice input.
- **Interface:** HTTP pages + REST calls to `/api/*` + WebSocket for progress updates.
- **Processing:** User input, voice recording, video playback, quiz interaction, companion animations.
- **Data:** Session state in browser; no secrets stored client-side.

### 2) API Server (FastAPI)

- **Type:** Backend service
- **Purpose:** Central orchestrator for all app logic - video processing, question generation, user management, and quiz evaluation.
- **Function:** Routes requests, validates payloads, coordinates external services, reads and writes to SQLite and the filesystem.
- **Dependencies:** `admin_routes`, `video_quiz_routes`, SQLite, yt-dlp, FFmpeg, OpenAI, Anthropic, Gemini, Hume AI.
- **Interface:**
  - Pages: `/children`, `/admin/*`, `/expert-preview`
  - REST: `/api/*`
  - WebSocket: `/ws/questions/{video_id}` for streaming question generation progress

**Key API endpoints:**

- `POST /api/verify-password` - admin login
- `POST /api/learners/parents/login` - parent login with access code
- `GET /api/learners/experts/{expert_id}/children` - list children for a parent
- `GET /api/learners/children/{child_id}/videos` - get videos available to a child
- `POST /api/check_answer` - evaluate a child's voice answer
- `GET /api/expert/report` - load a child's progress report
- `PUT /api/expert/parents/{parent_id}/login-code` - update a parent's access code
- `GET /api/final-questions/{video_id}` - get quiz questions for a video
- `POST /api/download` - download a YouTube video

### 3) Video Acquisition Module (yt-dlp)

- **Type:** Integration component
- **Purpose:** Download a YouTube video and its metadata for local use.
- **Function:** Extracts title, thumbnail, and duration; downloads the video file; optionally downloads subtitles.
- **Dependencies:** `yt_dlp`, optional Node.js runtime, optional cookies file, FFmpeg for remuxing.
- **Interface:** Internal Python functions called by the API server.
- **Processing:** Tries multiple player clients on 403 errors; falls back on format unavailability.

### 4) Media Processing Module (Frames and Subtitles)

- **Type:** Processing component
- **Purpose:** Convert video into structured inputs for AI question generation.
- **Function:** Extracts 1 frame per second, stores frame index and timestamps, collects transcript lines for segment windows.
- **Dependencies:** OpenCV, PIL, pandas; relies on downloaded video and subtitle files.
- **Processing:** Video read - frame sampling - write CSV/JSON summaries.

### 5) AI Question Generation Engine

- **Type:** External service integration
- **Purpose:** Generate child-friendly comprehension questions from video frames and transcripts.
- **Function:** For each video segment, returns questions across 7 categories - character, setting, feeling, action, causal, outcome, prediction.
- **Dependencies:** OpenAI, Anthropic (Claude), and Gemini API clients; environment API keys; retry/backoff logic.
- **Processing:** Prompt creation - send frames and transcript - validate JSON response - retry on failure.

### 6) Companion and Voice Module

- **Type:** Application module
- **Purpose:** Give each child a character companion that guides them through quizzes with voice and personality.
- **Function:** Plays companion voice lines using Hume AI voices for Blossom the Bunny, Pippa the Pig, and Ash the Alligator. Provides feedback, hints, and encouragement based on the child's answers.
- **Dependencies:** Hume AI API, browser Web Speech API for voice recording, OpenAI TTS as fallback.
- **Interface:** Frontend JS module managing audio playback and companion animations.

### 7) Report Service

- **Type:** Application module
- **Purpose:** Compute and deliver per-child progress reports for parents.
- **Function:** Reads quiz result files, aggregates scores by interaction mode, computes category breakdowns, and returns structured report data.
- **Dependencies:** SQLite, quiz result JSON files, `report_service.py`.
- **Interface:** `GET /api/expert/report?child_id=...`
- **Data:** Overall score, total attempts, retries, watch time, category scores, recent sessions.

### 8) Storage Layer (SQLite and Filesystem)

- **Type:** Data component
- **Purpose:** Persist all user data, quiz artifacts, and video files.
- **Function:**
  - SQLite stores users (parents, children, admins), access codes, and child-parent relationships.
  - Filesystem stores video files, extracted frames, AI-generated questions, and quiz results.
- **Dependencies:** SQLite via `sqlite_store.py`, OS filesystem.

**SQLite tables:**
- `parents` - parent accounts, login code hash, access code
- `children` - child profiles, icon, interaction mode, linked parent
- `experts` - admin/expert accounts

**Filesystem artifacts (per video):**
- `downloads/<video_id>/meta.json` - title, thumbnail, duration
- `downloads/<video_id>/<file>.mp4` - video asset
- `downloads/<video_id>/extracted_frames/` - sampled frames and metadata
- `downloads/<video_id>/questions/` - AI-generated questions per segment
- `downloads/<video_id>/final_questions/final_questions.json` - finalized questions
- `downloads/quiz_results/<child_id>_results.json` - per-child quiz history

---

## Requirements to Architecture Mapping

- **Generate questions for children:** Question Generation Engine + Media Processing + API Server.
- **Support Child, Parent, and Admin roles:** Web Client pages + API routing + SQLite auth.
- **Companion-guided quiz experience:** Companion and Voice Module + Hume AI voices.
- **Parent progress reports:** Report Service + SQLite + quiz result files.
- **Reliability under failures:** Retry/backoff in question generation; player client fallbacks for downloads.
- **Secure access:** Personal access codes for parents; children log in via parent-provided codes; admin password via env variable.

---

## Interfaces and Protocols

### HTTP Routes

- Pages: `GET /`, `GET /children`, `GET /expert-preview`, `GET /admin/*`
- REST: `GET/POST /api/*`
- WebSocket: `/ws/questions/{video_id}` for streaming question generation progress

### Auth and Access Control

- Admin: password from environment variable (`ADMIN_PASSWORD`)
- Parents: personal login code stored as a hash in SQLite; plain text code also stored for admin visibility
- Children: log in using parent's access code; no separate password
- No PII stored; API keys loaded from `.env` and never committed to git
