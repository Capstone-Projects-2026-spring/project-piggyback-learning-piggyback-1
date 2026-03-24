# Piggyback Learning

FastAPI application for downloading YouTube videos, extracting frames, and generating
educational comprehension questions. The app includes admin processing tools, expert
review workflows, and a kids-friendly playback/quiz interface.

## Features

- YouTube downloads via `yt-dlp` (prefers 720p H.264 MP4 on first attempt)
- English subtitles (auto + manual when available) and metadata capture
- Frame extraction at 1 FPS with CSV/JSON manifests
- AI question generation with WebSocket progress updates
- Expert review and final question curation
- Kids library and quiz player UI

## Quickstart

1. Install system dependencies (FFmpeg required, Node.js optional). See the OS-specific section below.
2. Create and activate a virtual environment:
  ```bash
  python -m venv venv
  # Windows (PowerShell)
  .\venv\Scripts\Activate.ps1
  # Windows (cmd.exe)
  venv\Scripts\activate
  # macOS/Linux
  source venv/bin/activate
  ```
  If PowerShell blocks activation, run:
  ```bash
  Set-ExecutionPolicy -Scope Process Bypass
  ```
3. Install Python dependencies:
  ```bash
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt
  ```
4. Create `.env` in the project root (defaults shown below).
5. Run the app:
  ```bash
  python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
  ```
6. Open:
  ```
  http://localhost:8000
  ```

## System Dependencies (Windows / macOS / Linux)

FFmpeg is required for muxing/format handling. Node.js LTS is optional but improves
`yt-dlp` reliability.

Verify after install:
```bash
ffmpeg -version
node -v
```

Windows:
- Install FFmpeg and ensure `ffmpeg.exe` is on your PATH (via winget/chocolatey or a static build).
- Install Node.js LTS (optional) and ensure `node` is on PATH.

macOS (Homebrew):
```bash
brew install ffmpeg
brew install node
```

Linux:
- Ubuntu/Debian:
  ```bash
  sudo apt-get update
  sudo apt-get install ffmpeg nodejs npm
  ```
- Fedora:
  ```bash
  sudo dnf install ffmpeg nodejs
  ```
- Arch:
  ```bash
  sudo pacman -S ffmpeg nodejs npm
  ```

## Configuration

Create a `.env` file in the project root:

```bash
OPENAI_API_KEY="your_openai_key"
# Defaults are admin123 / expert123 if not set
ADMIN_PASSWORD="admin123"
# Optional: use a Netscape-format cookies file for restricted videos
YTDLP_COOKIEFILE="C:\\path\\to\\cookies.txt"
# Alternate env var name also supported
YTDLP_COOKIES_FILE="C:\\path\\to\\cookies.txt"
```

Notes:
- `.env` and `.env.txt` are both loaded if present.
- Keep secrets out of git (add `.env` to `.gitignore`).

## App Flows

### Admin

1. From the home page, choose Admin and enter the admin password.
2. Use the Admin panel to download videos, extract frames, and generate questions.

### Expert Review

1. From the home page, choose Expert and enter the expert password.
2. Use the Expert Preview page to review or create questions.

### Kids

1. Go to the Kids page.
2. Browse videos and play quizzes.

## API Endpoints (Core)

- `POST /api/verify-password`
- `POST /api/download`
- `POST /api/frames/{video_id}`
- `GET /api/admin/videos`
- `POST /api/submit-questions`
- `WS  /ws/questions/{video_id}`
- `GET /api/kids_videos`
- `GET /api/final-questions/{video_id}`
- `GET /api/videos-list`
- `GET /api/expert-questions/{video_id}`

## Project Structure

```
main.py
admin_routes.py
video_quiz_routes.py
templates/
  admin.html
  children.html
  expert_preview.html
  home.html
  video_quiz.html
downloads/
static/
requirements.txt
readme.md
```

## Troubleshooting

- 403 Forbidden on download:
  - Try again (the downloader cycles player clients automatically).
  - Add a cookies file via `YTDLP_COOKIEFILE`.
  - Install Node.js LTS to improve extraction reliability.
- Low quality:
  - The first attempt prefers 720p H.264 MP4. If you need higher, adjust the
    format selector in `main.py` inside `download_youtube()`.
- FFmpeg not found:
  - Install FFmpeg and ensure it is on your PATH.

## License

Educational use only. Respect YouTube's Terms of Service and copyright laws.

## Support

For issues related to:
- **yt-dlp**: Check [yt-dlp documentation](https://github.com/yt-dlp/yt-dlp)
- **OpenAI API**: Check [OpenAI documentation](https://platform.openai.com/docs)
- **FastAPI**: Check [FastAPI documentation](https://fastapi.tiangolo.com)


## Collaborators

<p align="center">
Jerry Lin • Anujin Ikhbayar • Jayden Lupold • Irene Simtoco • Adriel Alquiros
</p>

