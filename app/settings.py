from pathlib import Path
import os

from dotenv import load_dotenv

# Load env vars from .env (if present) and .env.txt (explicit file requested by user)
load_dotenv()
load_dotenv(".env.txt")

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
PUBLIC_ASSETS_DIR = BASE_DIR / "public" / "assets"
PACKAGED_DOWNLOADS_DIR = BASE_DIR / "downloads"
STORAGE_ROOT = Path(
    os.getenv("APP_STORAGE_ROOT")
    or os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
    or str(BASE_DIR)
)
DOWNLOADS_DIR = Path(os.getenv("DOWNLOADS_DIR", str(STORAGE_ROOT / "downloads")))
PRELOAD_DOWNLOAD_IDS = tuple(
    item.strip()
    for item in (os.getenv("PRELOAD_DOWNLOAD_IDS") or "IxX_QHay02M,jzWPkKvO7v4,17o2rPGryuk").split(",")
    if item.strip()
)

#Where SQLite file goes
DATA_DIR = Path(os.getenv("DATA_DIR", str(STORAGE_ROOT / "data")))
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

SESSION_SECRET = os.getenv("SESSION_SECRET", "change-this-session-secret")
#For expert logins
SQLITE_PATH = Path(os.getenv("SQLITE_PATH", str(DATA_DIR / "piggyback.db")))

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
EXPERT_PASSWORD = os.getenv("EXPERT_PASSWORD", "expert123")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
QUESTION_PROVIDER_DEFAULT = os.getenv("QUESTION_PROVIDER_DEFAULT", "openai").strip().lower()

HUME_API_KEY = os.getenv("HUME_API_KEY", "").strip()
HUME_VOICE_IDS = {
    "blossom": os.getenv("HUME_VOICE_BLOSSOM", "").strip(),
    "pippa":   os.getenv("HUME_VOICE_PIPPA", "").strip(),
    "ash":     os.getenv("HUME_VOICE_ASH", "").strip(),
}

VIDEO_EXTENSIONS = (".mp4",".webm",".mkv",".mov")

EXPERT_QUESTION_TYPES = [
    ("character","Character"),
    ("settings","Setting"),
    ("feeling","Feeling"),
    ("action","Action"),
    ("causal","Causal"),
    ("outcome","Outcome"),
    ("prediction","Prediction"),    
]

EXPERT_QUESTION_TYPE_VALUES = {value for value, _ in EXPERT_QUESTION_TYPES}
EXPERT_QUESTION_TYPE_LABELS = {value: label for value, label in EXPERT_QUESTION_TYPES}
