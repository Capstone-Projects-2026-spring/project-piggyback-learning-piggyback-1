---
sidebar_position: 4
---

# Development Environment

## Hardware Requirements

- A modern laptop or desktop capable of running Python and FFmpeg
- Minimum 8 GB RAM recommended
- Enough disk space to store downloaded videos and extracted frames (videos can be large)
- Internet access for installing dependencies and downloading YouTube content
- A microphone (required for testing the kids voice quiz experience)

---

## Software Requirements

### Languages and Frameworks

- **Python 3.12** - required exactly, other versions are not supported
- **FastAPI** - web server framework for building APIs
- **Uvicorn** - ASGI server for running the FastAPI app

### System Dependencies

- **FFmpeg** - required for video processing and remuxing
- **Node.js LTS** - optional, improves yt-dlp download reliability

### Python Libraries

| Category | Libraries |
|---|---|
| Web and ASGI | `fastapi`, `uvicorn`, `starlette` |
| Multimedia | `yt-dlp`, `opencv-python`, `pandas`, `numpy` |
| AI Providers | `openai`, `anthropic`, `google-generativeai` |
| Voice | `python-dotenv`, `websockets`, `httpx` |
| Utilities | `tqdm`, `python-multipart`, `anyio` |

### API Keys Needed

| Key | Purpose | Required? |
|---|---|---|
| `OPENAI_API_KEY` | Question generation and answer grading | For new videos |
| `ANTHROPIC_API_KEY` | Claude AI question generation | For new videos |
| `GEMINI_API_KEY` | Gemini AI question generation | For new videos |
| `YOUTUBE_API_KEY` | YouTube video search | For new videos |
| `HUME_API_KEY` | Companion character voices | Optional |

---

## Tools and IDEs

- **IDE:** VS Code, PyCharm, or any editor that supports Python
- **Shell:** Git Bash (Windows), Terminal (macOS/Linux)
- **Version Control:** Git

---

## Local Setup Workflow

### 1. Verify Python version

```bash
python --version  # must be 3.12.x
```

### 2. Install FFmpeg

Windows: install via winget or chocolatey and add to PATH

macOS:
```bash
brew install ffmpeg
```

Linux:
```bash
sudo apt-get install ffmpeg
```

### 3. Clone the repo and create a virtual environment

```bash
git clone <repo-url>
cd project-piggyback-learning-piggyback-1

python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate
```

### 4. Install dependencies

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### 5. Set up environment variables

```bash
# macOS/Linux
cp .env.example .env

# Windows
copy .env.example .env
```

Fill in your API keys in the `.env` file.

### 6. Run the app

```bash
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 7. Verify system tools

```bash
ffmpeg -version
node -v  # optional
```

Open `http://localhost:8000` in your browser.

---

## Running with Docker

A `Dockerfile` is included as an alternative to the manual setup above. Docker handles Python, FFmpeg, and all dependencies automatically.

### Build the image

```bash
docker build -t piggyback .
```

### Run the container

```bash
docker run -p 8000:8000 --env-file .env piggyback
```

Open `http://localhost:8000` in your browser.

> Make sure your `.env` file is set up before running the container - the app needs API keys to work.
