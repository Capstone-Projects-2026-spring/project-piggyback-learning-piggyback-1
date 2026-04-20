import os
import shutil
import sys
from pathlib import Path

#set a fake key before pytest import anything from the app
os.environ["OPENAI_API_KEY"] = "fake-key-for-testing"
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True

TEST_RUNTIME_DIR = Path("tests/.runtime")
TEST_DB_PATH = TEST_RUNTIME_DIR / "test_session.db"

def _cleanup_test_artifacts():
    for path in (TEST_RUNTIME_DIR, Path("tests/.pytest-tmp"), Path(".pytest_cache")):
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
    for root in (Path("__pycache__"), Path("app"), Path("tests")):
        if root.name == "__pycache__":
            if root.exists():
                shutil.rmtree(root, ignore_errors=True)
            continue
        if root.exists():
            for path in root.rglob("__pycache__"):
                shutil.rmtree(path, ignore_errors=True)


_cleanup_test_artifacts()
TEST_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

#must happen before any app imports read settings
os.environ["SQLITE_PATH"] = str(TEST_DB_PATH.resolve())

# startup event doesn't run in tests, so create tables manually
from app.services.sqlite_store import init_db
init_db()


def pytest_html_report_title(report):
    report.title = "Piggyback Learning Test Report"

def pytest_configure(config):
    config._metadata = {}

def pytest_sessionstart(session):
    _cleanup_test_artifacts()
    TEST_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    init_db()

def pytest_sessionfinish(session,exitstatus):
    _cleanup_test_artifacts()

def pytest_unconfigure(config):
    _cleanup_test_artifacts()
