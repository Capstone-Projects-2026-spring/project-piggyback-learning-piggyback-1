import os
from pytest_html import extras
import tempfile
#set a fake key before pytest import anything from the app
os.environ["OPENAI_API_KEY"] = "fake-key-for-testing"

#must happen before any app imports read settings
temp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
temp.close()
os.environ["SQLITE_PATH"] = temp.name

# startup event doesn't run in tests, so create tables manually
from app.services.sqlite_store import init_db
init_db()


def pytest_html_report_title(report):
    report.title = "Piggyback Learning Test Report"

def pytest_configure(config):
    config._metadata = {}

def pytest_sessionfinish(session,exitstatus):
    path = os.environ.get("SQLITE_PATH")
    if path and "tmp" in path:
        try:
            os.unlink(path)
        except OSError:
            pass