---
sidebar_position: 6
---

# System Block Diagram

```mermaid
flowchart TD

  subgraph USERS["Users"]
    Child["Child"]
    Parent["Parent"]
    Admin["Admin"]
  end

  subgraph FE["Frontend"]
    UI["Web Interface"]
  end

  subgraph BE["Backend"]
    Server["FastAPI Server"]
  end

  subgraph DATA["Database and Storage"]
    DB["SQLite Database"]
    Files["Local File Storage"]
  end

  subgraph EXT["External Services"]
    YouTube["YouTube"]
    AI["AI Providers"]
    Hume["Hume AI"]
  end

  Child --> UI
  Parent --> UI
  Admin --> UI
  UI <--> Server
  Server <--> DB
  Server <--> Files
  Server --> YouTube
  Server --> AI
  Server --> Hume
```

## Component Descriptions

**Frontend** - A Next.js web application that serves separate interfaces for children, parents, and admins. It handles video playback, voice-based quiz interactions, companion character display, and real-time progress updates over WebSockets.

**Backend** - A FastAPI server that manages authentication, quiz logic, answer evaluation, AI question generation, video processing, and progress tracking. It exposes REST and WebSocket endpoints consumed by the frontend.

**Database and Storage** - SQLite stores user accounts, quiz results, and video metadata. The local file system holds downloaded videos, extracted frames, and generated question files.

**External Services**
- **YouTube** - Source of video content, accessed via the YouTube API and yt-dlp for downloading.
- **AI Providers (OpenAI, Anthropic, Gemini)** - Used to generate quiz questions from video frames and transcripts, and to evaluate child responses.
- **Hume AI** - Provides expressive voices for the companion characters.
