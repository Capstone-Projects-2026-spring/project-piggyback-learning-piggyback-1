# Piggyback Learning

FastAPI application for downloading YouTube videos, extracting frames, and generating
educational comprehension questions. The app includes admin processing tools, parent
review workflows, and a kids-friendly playback/quiz interface.

## Features

- YouTube downloads via `yt-dlp` (prefers 720p H.264 MP4 on first attempt)
- English subtitles (auto + manual when available) and metadata capture
- Frame extraction at 1 FPS with CSV/JSON manifests
- AI question generation with WebSocket progress updates
- Parent review and final question curation
- Kids library and quiz player UI

## Requirements

- **Python 3.12** (only — other versions are not supported)
- **FFmpeg** (required for video processing)
- **Node.js LTS** (optional, improves `yt-dlp` reliability)

Key Python packages (see `requirements.txt` for pinned versions):

| Package | Purpose |
|---|---|
| `fastapi` | Web framework |
| `uvicorn` | ASGI server |
| `openai` | AI question generation & grading |
| `anthropic` | Claude AI integration |
| `google-generativeai` | Gemini AI integration |
| `opencv-python` | Frame extraction |
| `yt-dlp` | YouTube downloading |
| `python-dotenv` | `.env` loading |
| `websockets` | WebSocket support |
| `pytest` / `pytest-html` | Testing |
| `Jinja2` | HTML templating |
| `pandas` / `numpy` | Data handling |

## Default Login Credentials

| Role | Password |
|---|---|
| Admin | `admin123` |
| Parent | `expert123` |

These are the defaults when `ADMIN_PASSWORD` / `EXPERT_PASSWORD` are not set in `.env`.
**Change these in production.**

## Quickstart

1. Ensure **Python 3.12** is installed:
   ```bash
   python --version   # must be 3.12.x
   ```
2. Install system dependencies (FFmpeg required, Node.js optional). See the OS-specific section below.
3. Create and activate a virtual environment:
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
4. Install Python dependencies:
   ```bash
   python -m pip install --upgrade pip
   python -m pip install -r requirements.txt
   ```
5. Copy `.env.example` to `.env` and fill in your API keys:
   ```bash
   cp .env.example .env
   ```
6. Run the app:
   ```bash
   python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
7. Open:
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

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

All available variables (see `.env.example` for full list):

```bash
OPENAI_API_KEY="your_openai_key"
ANTHROPIC_API_KEY="your_anthropic_key"
GEMINI_API_KEY="your_gemini_key"
YOUTUBE_API_KEY="your_youtube_key"
ADMIN_PASSWORD="admin123"
EXPERT_PASSWORD="expert123"
# Optional: Netscape-format cookies file for restricted videos
YTDLP_COOKIEFILE="C:\\path\\to\\cookies.txt"
YTDLP_COOKIES_FILE="C:\\path\\to\\cookies.txt"
```

Notes:
- `.env` and `.env.txt` are both loaded if present.
- Keep secrets out of git (`.env` is in `.gitignore`).

## How to Test

Make sure the virtual environment is activated and dependencies are installed, then run:

```bash
# Run all tests
pytest

# Run with verbose output
pytest -v

# Run a specific test file
pytest tests/test_unit.py
pytest tests/test_integration.py
pytest tests/test_acceptance.py

# Generate an HTML report
pytest --html=report.html --self-contained-html
```

Test files are located in the `tests/` directory:
- `tests/test_unit.py` — unit tests for services and utilities
- `tests/test_integration.py` — integration tests
- `tests/test_acceptance.py` — acceptance/end-to-end tests
- `tests/conftest.py` — shared fixtures

## App Flows

### Admin

1. From the home page, choose Admin and enter the admin password.
2. Use the Admin panel to download videos, extract frames, and generate questions.

### Parent Review

1. From the home page, choose Parent and enter the parent password.
2. Use the Parent Preview page to review or create questions.

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
config.py
app/
  __init__.py
  settings.py
  web.py
  services/
templates/
  admin.html
  children.html
  expert_preview.html
  home.html
  video_quiz.html
tests/
  conftest.py
  test_unit.py
  test_integration.py
  test_acceptance.py
downloads/
static/
requirements.txt
.env.example
readme.md
```

## Troubleshooting

- **Wrong Python version:**
  - This project requires Python 3.12 exactly. Run `python --version` to confirm.
  - If you have multiple Python versions, use `py -3.12` (Windows) or `python3.12` (macOS/Linux) explicitly.
- **`ModuleNotFoundError` on startup:**
  - Ensure your virtual environment is activated and `pip install -r requirements.txt` has been run.
- **`OPENAI_API_KEY` not set error:**
  - Copy `.env.example` to `.env` and add your API keys.
- **pytest not found:**
  - Run `pip install pytest pytest-html` or reinstall requirements: `pip install -r requirements.txt`.
- **Tests failing with import errors:**
  - Run pytest from the project root directory (where `main.py` lives), not from inside `tests/`.
- **403 Forbidden on download:**
  - Try again (the downloader cycles player clients automatically).
  - Add a cookies file via `YTDLP_COOKIEFILE`.
  - Install Node.js LTS to improve extraction reliability.
- **Low quality video:**
  - The first attempt prefers 720p H.264 MP4. If you need higher, adjust the
    format selector in `main.py` inside `download_youtube()`.
- **FFmpeg not found:**
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
