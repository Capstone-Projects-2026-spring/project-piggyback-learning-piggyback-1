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

---

## Components

### Web Client (Frontend)
A Next.js web application with separate interfaces for children, parents, and admins. Handles video playback, voice recording, quiz interactions, and companion animations. Communicates with the backend over REST and WebSocket.

### API Server (Backend)
A FastAPI server that acts as the central orchestrator - routing requests, managing user sessions, coordinating video processing, question generation, and quiz evaluation. Full endpoint details are in the API Specification section.

### Video Acquisition and Processing
Downloads YouTube videos via yt-dlp and extracts frames and subtitles for use in question generation.

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
| Voice-based quiz answers | Web Client (microphone) + API Server + AI evaluation |
| Three interaction modes (Flexible, Strict, Passive) | API Server quiz logic + Web Client playback controls |
| Companion-guided experience | Companion and Voice Module + Hume AI |
| AI question generation | Video Acquisition + AI Question Generation + Storage |
| Parent progress reports | Report Service + Storage |
| Role-based access | API Server auth + SQLite |
