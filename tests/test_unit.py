from app.services.question_generation_service import time_to_seconds
import pytest
from video_quiz_routes import normalize_text
from app.services.question_generation_service import build_segments_from_duration
#pytest runs any function starting with test_ 
# Testing assignment service functions
from app.services.sqlite_store import init_db
#Testing for children services
from uuid import uuid4
from app.services.children_service import (
    create_child,
    deactivate_child,
    generate_child_id,
    list_children,
    update_child,
    get_child,
)


from app.services.expert_auth_service import (
    add_video_assignment,
    remove_video_assignment,
    list_experts_for_video,
    can_expert_access_video,
    claim_video_for_expert,
    create_expert,
    delete_expert,
)
#make a value to test
def setup_module():
    init_db()
    try:
        create_expert("testexpert1", "Test Expert 1", "password123")
        create_expert("testexpert2", "Test Expert 2", "password123")
    except:
        pass 
#Testing time_to_seconds
def test_time_to_seconds_mmss():
    assert time_to_seconds("1:30") == 90

def test_time_to_seconds_hhmmss():
    assert time_to_seconds("1:00:00") == 3600

def test_time_to_seconds_bad_input():
    assert time_to_seconds("bad") == 0

def test_time_to_seconds_none():
    with pytest.raises(AttributeError):
            time_to_seconds(None) == 0

def test_time_to_seconds_seconds_only():
    assert time_to_seconds("45") == 45

def test_time_to_seconds_hhmmss_full():
    assert time_to_seconds("2:30:15") == 9015


#Testing for normalize_text
def test_normalize_text_removes_stopwords():
     assert normalize_text("the big dog") == "big dog"
    
def test_normalize_text_maps_synonyms():
    assert normalize_text("scared") == "afraid"

def test_normalize_text_empty():
    assert normalize_text("") == ""

#Testing for build_segment_from_duration
def test_build_segments_standard():
    assert build_segments_from_duration(180, 60) == [(0, 59), (60, 119), (120, 179), (180, 180)]

def test_build_segments_shorter_last():
    assert build_segments_from_duration(90, 60) == [(0, 59), (60, 90)]

def test_build_segments_single():
    assert build_segments_from_duration(60, 60) == [(0, 59), (60, 60)]

#Testing services
def test_add_assignment():
    add_video_assignment("vid_test", "testexpert1")
    assert can_expert_access_video("testexpert1", "vid_test") == True

def test_two_experts_same_video():
    add_video_assignment("vid_test", "testexpert2")
    experts = list_experts_for_video("vid_test")
    assert len(experts) == 2


def test_remove_assignment():
    remove_video_assignment("vid_test", "testexpert1")
    assert can_expert_access_video("testexpert1", "vid_test") == False

def test_claim_is_idempotent():
    claim_video_for_expert("testexpert2", "vid_test")
    claim_video_for_expert("testexpert2", "vid_test")  # twice, no error
    assert can_expert_access_video("testexpert2", "vid_test") == True
    
    
#Testing for childrens service

def _new_expert():
    expert_id = f"exp_{uuid4().hex[:10]}"
    return create_expert(expert_id, f"Expert {expert_id[-4:]}", "password123")

def test_generate_child_id_is_6_digit():
    child_id = generate_child_id()
    assert len(child_id) ==6
    assert child_id.isdigit()
    
def test_create_and_list_child():
    expert = _new_expert()
    child = create_child(expert["expert_id"], "Mia", "Lin", "fox")
    children = list_children(expert_id=expert["expert_id"])
    assert any(c["child_id"] == child["child_id"] for c in children)

def test_same_name_different_experts_allowed():
    expert_a = _new_expert()
    expert_b = _new_expert()
    child_a = create_child(expert_a["expert_id"], "Noah", "Kim", "bear")
    child_b = create_child(expert_b["expert_id"], "Noah", "Kim", "bear")
    assert child_a["child_id"] != child_b["child_id"]


def test_duplicate_name_same_expert_now_allowed():
    # unique name index was dropped -- same first+last under same expert is now allowed
    expert = _new_expert()
    child_a = create_child(expert["expert_id"], "Ava", "Stone", "cat")
    child_b = create_child(expert["expert_id"], "Ava", "Stone", "fox")
    assert child_a["child_id"] != child_b["child_id"]
    children = list_children(expert_id=expert["expert_id"])
    assert len([c for c in children if c["first_name"] == "Ava"]) == 2

def test_invalid_icon_rejected():
    expert = _new_expert()
    with pytest.raises(ValueError, match="icon_key is invalid"):
        create_child(expert["expert_id"], "Leo", "Park", "dragon")
        
def test_update_and_deactivate_child():
    expert = _new_expert()
    child = create_child(expert["expert_id"], "Ivy", "Cho", "owl")

    updated = update_child(child["child_id"], first_name="Zoey", icon_key="penguin")
    assert updated["first_name"] == "Zoey"
    assert updated["icon_key"] == "penguin"

    deactivate_child(child["child_id"])
    active_children = list_children(expert_id=expert["expert_id"])
    all_children = list_children(expert_id=expert["expert_id"], include_inactive=True)

    assert not any(c["child_id"] == child["child_id"] for c in active_children)
    assert any(c["child_id"] == child["child_id"] and c["is_active"] is False for c in all_children)
    
    
#more test on childrens condition


#new test for Icon behaviors

# Testing new icon keys added in companion update
from app.services.children_service import ALLOWED_CHILD_ICON_KEYS, normalize_child_id, normalize_name, normalize_icon_key

def test_new_icon_keys_are_valid():
    new_icons = ["simba", "nemo", "walle", "moana", "elsa", "spiderman", "mickey",
                 "pooh", "chase", "spongebob", "turtle", "bluey", "hellokitty",
                 "mlp", "peppa", "mario", "dino"]
    for icon in new_icons:
        assert icon in ALLOWED_CHILD_ICON_KEYS, f"{icon} should be allowed"

def test_bad_icon_still_rejected():
    assert "dragon" not in ALLOWED_CHILD_ICON_KEYS
    assert "unicorn" not in ALLOWED_CHILD_ICON_KEYS


# Testing normalize helpers
def test_normalize_child_id_strips_whitespace():
    assert normalize_child_id("  123456  ") == "123456"

def test_normalize_child_id_empty():
    assert normalize_child_id("") == ""
    assert normalize_child_id(None) == ""

def test_normalize_name_collapses_spaces():
    assert normalize_name("  John   Doe  ") == "John Doe"

def test_normalize_name_empty():
    assert normalize_name("") == ""

def test_normalize_icon_key_lowercases():
    assert normalize_icon_key("PIG") == "pig"
    assert normalize_icon_key(" Fox ") == "fox"


# Testing delete_child
from app.services.children_service import delete_child

def test_delete_child_removes_record():
    expert = _new_expert()
    suffix = uuid4().hex[:6]
    child = create_child(expert["expert_id"], f"Del{suffix}", "Test", "cat")
    child_id = child["child_id"]

    result = delete_child(child_id)
    assert result is True
    assert get_child(child_id, include_inactive=True) is None

def test_delete_child_nonexistent_returns_false():
    assert delete_child("999999") is False


# Testing video claim / unclaim without hitting the database
def test_claim_video_calls_add_assignment():
    from unittest.mock import patch
    with patch("app.services.expert_auth_service.add_video_assignment") as mock_add, \
         patch("app.services.expert_auth_service.can_expert_access_video", return_value=True):
        mock_add("vid_unit_claim", "testexpert1", source="expert_claim")
        from app.services.expert_auth_service import can_expert_access_video
        assert can_expert_access_video("testexpert1", "vid_unit_claim") is True
        mock_add.assert_called_once_with("vid_unit_claim", "testexpert1", source="expert_claim")

def test_unclaim_video_calls_remove_assignment():
    from unittest.mock import patch
    with patch("app.services.expert_auth_service.remove_video_assignment") as mock_remove, \
         patch("app.services.expert_auth_service.can_expert_access_video", return_value=False):
        mock_remove("vid_unit_claim", "testexpert1")
        from app.services.expert_auth_service import can_expert_access_video
        assert can_expert_access_video("testexpert1", "vid_unit_claim") is False
        mock_remove.assert_called_once_with("vid_unit_claim", "testexpert1")

# Testing hash_password and verify_password
from app.services.expert_auth_service import hash_password, verify_password

def test_hash_password_is_not_plaintext():
    hashed = hash_password("mysecret")
    assert hashed != "mysecret"

def test_verify_password_correct():
    hashed = hash_password("mysecret")
    assert verify_password("mysecret", hashed) is True

def test_verify_password_wrong():
    hashed = hash_password("mysecret")
    assert verify_password("wrongpassword", hashed) is False

#Testing parents table and parent_id mirgration 

from app.services.sqlite_store import get_conn


def test_parents_table_exists():
    with get_conn() as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        assert "parents" in tables

def test_parents_table_has_correct_columns():
    with get_conn() as conn:
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(parents)").fetchall()}
        assert cols == {"parent_id", "display_name", "login_code_hash", "login_code", "is_active", "created_at", "updated_at"}

def test_children_has_parent_id_column():
    with get_conn() as conn:
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(children)").fetchall()}
        assert "parent_id" in cols


# login_code plain text column exists
def test_parents_table_has_login_code_column():
    with get_conn() as conn:
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(parents)").fetchall()}
        assert "login_code" in cols


#  upsert stores plain text code and valid hash 
def test_upsert_login_code_stores_plain_and_hash():
    from datetime import datetime, timezone
    from app.services.expert_auth_service import hash_password, verify_password
    parent_id = "_test_upsert_parent"
    code = "abc99"
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute("DELETE FROM parents WHERE parent_id = ?", (parent_id,))
        conn.execute(
            """
            INSERT INTO parents (parent_id, display_name, login_code_hash, login_code, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(parent_id) DO UPDATE SET
                login_code_hash = excluded.login_code_hash,
                login_code = excluded.login_code,
                updated_at = excluded.updated_at
            """,
            (parent_id, "Test Parent", hash_password(code), code, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT login_code, login_code_hash FROM parents WHERE parent_id = ?", (parent_id,)).fetchone()
        assert row["login_code"] == code
        assert verify_password(code, row["login_code_hash"])
        conn.execute("DELETE FROM parents WHERE parent_id = ?", (parent_id,))
        conn.commit()


#New: report service unit tests 
from app.services.report_service import _compute_top_categories, get_child_report_scoped
from unittest.mock import patch

def test_compute_top_categories_correct_scores():
    # correct answers should produce 100% score for their category
    attempts = [{"details": [{"question_type": "action", "status": "correct"}]}]
    cats = _compute_top_categories(attempts)
    assert any(c["type"] == "action" and c["score"] == 100 for c in cats)

def test_compute_top_categories_almost_is_half_point():
    # almost answer should yield 50% score
    attempts = [{"details": [{"question_type": "feeling", "status": "almost"}]}]
    cats = _compute_top_categories(attempts)
    assert any(c["type"] == "feeling" and c["score"] == 50 for c in cats)

def test_compute_top_categories_wrong_yields_zero():
    # wrong answer should yield 0%
    attempts = [{"details": [{"question_type": "setting", "status": "wrong"}]}]
    cats = _compute_top_categories(attempts)
    assert any(c["type"] == "setting" and c["score"] == 0 for c in cats)

def test_report_empty_when_no_attempts():
    # child with no quiz history should return zeroed-out report
    with patch("app.services.report_service._load_attempts", return_value=[]):
        report = get_child_report_scoped("no_attempts_child", mode="all")
    assert report["total_attempts"] == 0
    assert report["overall_score"] == 0


def test_select_auth_profile_prefers_windows_browser_order():
    from app.services import download_service as ds

    seen = []

    def probe(browser):
        seen.append(browser)
        return browser == "edge"

    profile = ds._select_auth_profile(
        system_name="Windows",
        auth_mode="auto",
        browser_probe=probe,
    )

    assert seen == ["chrome", "firefox", "edge"]
    assert profile["source"] == "browser"
    assert profile["browser"] == "edge"


def test_select_auth_profile_mac_order_skips_safari():
    from app.services import download_service as ds

    profile = ds._select_auth_profile(
        system_name="Darwin",
        auth_mode="auto",
        browser_probe=lambda browser: False,
    )

    assert profile["browser_order"] == ["chrome", "firefox"]
    assert "safari" not in profile["browser_order"]


def test_metadata_and_download_opts_share_browser_auth():
    from app.services import download_service as ds
    from pathlib import Path

    auth_profile = {
        "source": "browser",
        "browser": "firefox",
        "cookiefile": None,
    }

    metadata_opts = ds._build_metadata_opts(auth_profile=auth_profile, has_node=False)
    download_opts = ds._build_download_opts(
        video_dir=Path("downloads"),
        video_id="vid123",
        auth_profile=auth_profile,
        has_ffmpeg=True,
        ffmpeg_path="ffmpeg",
        has_node=False,
    )

    assert metadata_opts["cookiesfrombrowser"] == ("firefox",)
    assert download_opts["cookiesfrombrowser"] == ("firefox",)


def test_select_auth_profile_falls_back_to_cookiefile():
    from app.services import download_service as ds
    seen = []

    def probe(browser):
        seen.append(browser)
        return False

    with patch.object(ds, "_resolve_cookiefile", return_value="tests/fixtures/test_cookies.txt"):
        profile = ds._select_auth_profile(
            system_name="Windows",
            auth_mode="auto",
            cookiefile="tests/fixtures/test_cookies.txt",
            browser_probe=probe,
        )

    assert seen == ["chrome", "firefox", "edge"]
    assert profile["source"] == "cookiefile"
    assert profile["cookiefile"] == "tests/fixtures/test_cookies.txt"


def test_classify_auth_error_returns_stable_code_and_hint():
    from app.services import download_service as ds

    profile = {"source": "none", "browser": None}
    classification = ds._classify_ytdlp_error(
        "Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.",
        auth_profile=profile,
        system_name="Darwin",
        user_agent_set=False,
    )

    assert classification["error_code"] == "auth_required"
    assert "Chrome or Firefox" in classification["recovery_hint"]
    assert "Safari is not guaranteed" in classification["recovery_hint"]
    assert "YTDLP_USER_AGENT" in classification["recovery_hint"]


def test_subtitle_opts_reuse_used_player_client():
    from app.services import download_service as ds
    from pathlib import Path

    auth_profile = {
        "source": "browser",
        "browser": "chrome",
        "cookiefile": None,
    }

    subtitle_opts = ds._build_subtitle_opts(
        video_dir=Path("downloads"),
        video_id="vid123",
        auth_profile=auth_profile,
        has_node=False,
        used_player_client=["tv_downgraded", "web_safari"],
        user_agent="Mozilla/5.0",
    )

    assert subtitle_opts["cookiesfrombrowser"] == ("chrome",)
    assert subtitle_opts["extractor_args"]["youtube"]["player_client"] == [
        "tv_downgraded",
        "web_safari",
    ]
    assert subtitle_opts["http_headers"]["User-Agent"] == "Mozilla/5.0"


def test_preferred_download_format_has_broad_ffmpeg_fallback():
    from app.services import download_service as ds

    format_selector = ds._preferred_download_format(has_ffmpeg=True)

    assert "bestvideo+bestaudio/best" in format_selector
    assert "bv*[height<=?720]+ba" in format_selector


def test_download_with_format_fallback_keeps_player_client_first(monkeypatch):
    from app.services import download_service as ds

    calls = []

    class FakeYoutubeDL:
        def __init__(self, opts):
            self.opts = opts
            calls.append(opts.copy())

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def download(self, _urls):
            if len(calls) == 1:
                raise ds.yt_dlp.utils.DownloadError("Requested format is not available")
            return 0

    monkeypatch.setattr(ds.yt_dlp, "YoutubeDL", FakeYoutubeDL)

    opts = {
        "format": "narrow",
        "merge_output_format": "mp4",
        "postprocessors": [{"key": "FFmpegVideoRemuxer"}],
        "extractor_args": {"youtube": {"player_client": ["tv_downgraded", "web_safari"]}},
    }

    ds._download_with_format_fallback(
        "https://www.youtube.com/watch?v=test123",
        opts=opts,
        has_ffmpeg=True,
    )

    assert len(calls) == 2
    assert calls[1]["format"] == "bestvideo+bestaudio/best"
    assert calls[1]["extractor_args"]["youtube"]["player_client"] == [
        "tv_downgraded",
        "web_safari",
    ]


def test_apply_runtime_options_enables_remote_ejs_components():
    from app.services import download_service as ds

    opts = {}
    ds._apply_runtime_options(opts, has_node=False)

    assert opts["remote_components"] == ["ejs:github"]
    assert "js_runtimes" not in opts


def test_resolve_ffmpeg_path_uses_winget_link(monkeypatch):
    from app.services import download_service as ds
    from pathlib import Path
    import shutil

    tmp_path = Path("tests/.ffmpeg_link_test")
    if tmp_path.exists():
        shutil.rmtree(tmp_path)

    try:
        winget_link = tmp_path / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe"
        winget_link.parent.mkdir(parents=True)
        winget_link.write_text("stub", encoding="utf-8")

        monkeypatch.setattr(ds.shutil, "which", lambda _name: None)
        monkeypatch.setattr(ds.platform, "system", lambda: "Windows")
        monkeypatch.setenv("LOCALAPPDATA", str(tmp_path.resolve()))

        assert ds._resolve_ffmpeg_path() == str(winget_link.resolve())
    finally:
        if tmp_path.exists():
            shutil.rmtree(tmp_path)


def test_repair_invalid_mp4_replaces_file(monkeypatch):
    from app.services import download_service as ds
    from pathlib import Path
    import shutil

    tmp_path = Path("tests/.ffmpeg_repair_test")
    if tmp_path.exists():
        shutil.rmtree(tmp_path)

    try:
        tmp_path.mkdir(parents=True)
        video_path = tmp_path / "sample.mp4"
        video_path.write_bytes(b"\x47\x40\x00\x30bad-ts")

        def fake_run(command, capture_output, text, timeout, check):
            repaired_path = Path(command[-1])
            repaired_path.write_bytes(b"\x00\x00\x00\x18ftypisom")

            class Result:
                returncode = 0

            return Result()

        monkeypatch.setattr(ds.subprocess, "run", fake_run)

        repaired = ds._repair_invalid_mp4(video_path, "ffmpeg")

        assert repaired == video_path
        assert video_path.read_bytes().startswith(b"\x00\x00\x00\x18ftyp")
    finally:
        if tmp_path.exists():
            shutil.rmtree(tmp_path)


# ── Quiz Scoring Service ──────────────────────────────────────────────────────

from app.services.quiz_scoring_service import save_quiz_result, get_child_scores

def test_save_quiz_result_creates_file(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.quiz_scoring_service.get_downloads_dir", lambda: tmp_path)
    result = save_quiz_result("123456", "vid1", {
        "total": 3, "correct": 2, "wrong": 1, "percentage": 67,
        "total_retries": 0, "avg_retries_per_question": 0.0,
        "watch_minutes": 2.5, "manual_pauses": 1, "details": []
    })
    assert result["success"] is True
    assert (tmp_path / "quiz_results" / "123456_results.json").exists()

def test_save_quiz_result_appends_attempts(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.quiz_scoring_service.get_downloads_dir", lambda: tmp_path)
    score = {"total": 2, "correct": 1, "wrong": 1, "percentage": 50,
             "total_retries": 0, "avg_retries_per_question": 0.0,
             "watch_minutes": 1.0, "manual_pauses": 0, "details": []}
    save_quiz_result("123456", "vid1", score)
    save_quiz_result("123456", "vid2", score)
    result = get_child_scores("123456")
    assert result["total_attempts"] == 2

def test_save_quiz_result_stores_manual_pauses(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.quiz_scoring_service.get_downloads_dir", lambda: tmp_path)
    save_quiz_result("111111", "vid1", {
        "total": 1, "correct": 1, "wrong": 0, "percentage": 100,
        "total_retries": 0, "avg_retries_per_question": 0.0,
        "watch_minutes": 1.0, "manual_pauses": 3, "details": []
    })
    scores = get_child_scores("111111")
    assert scores["attempts"][0]["manual_pauses"] == 3

def test_get_child_scores_no_file(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.quiz_scoring_service.get_downloads_dir", lambda: tmp_path)
    result = get_child_scores("999999")
    assert result["success"] is False

def test_save_quiz_result_checkpoint_only_updates_watch_time(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.quiz_scoring_service.get_downloads_dir", lambda: tmp_path)
    session_id = "sess_abc"
    save_quiz_result("222222", "vid1", {
        "total": 2, "correct": 1, "wrong": 1, "percentage": 50,
        "total_retries": 0, "avg_retries_per_question": 0.0,
        "watch_minutes": 1.0, "manual_pauses": 2, "details": []
    }, session_id=session_id)
    save_quiz_result("222222", "vid1", {
        "watch_minutes": 0.5, "manual_pauses": 1, "checkpoint_only": True
    }, session_id=session_id)
    scores = get_child_scores("222222")
    attempt = scores["attempts"][0]
    assert attempt["watch_minutes"] == 1.5
    assert attempt["manual_pauses"] == 1


# ── Video Files Service ───────────────────────────────────────────────────────

from app.services.video_files import find_primary_video_file

def test_find_primary_video_file_finds_mp4(tmp_path):
    mp4 = tmp_path / "video.mp4"
    mp4.write_bytes(b"fake")
    result = find_primary_video_file(tmp_path)
    assert result == mp4

def test_find_primary_video_file_skips_audio_only(tmp_path):
    (tmp_path / "video.f140.m4a").write_bytes(b"audio only")
    result = find_primary_video_file(tmp_path)
    assert result is None

def test_find_primary_video_file_prefers_merged_over_fragment(tmp_path):
    (tmp_path / "video.f136.mp4").write_bytes(b"fragment")
    (tmp_path / "video.mp4").write_bytes(b"merged")
    result = find_primary_video_file(tmp_path)
    assert result.name == "video.mp4"

def test_find_primary_video_file_empty_dir(tmp_path):
    result = find_primary_video_file(tmp_path)
    assert result is None

def test_find_primary_video_file_webm(tmp_path):
    webm = tmp_path / "video.webm"
    webm.write_bytes(b"fake")
    result = find_primary_video_file(tmp_path)
    assert result == webm

def test_find_primary_video_file_nonexistent_dir():
    from pathlib import Path
    result = find_primary_video_file(Path("/nonexistent/path/xyz"))
    assert result is None

from app.services.video_files import list_question_json_files

def test_list_question_json_files_returns_files(monkeypatch, tmp_path):
    vid_dir = tmp_path / "vid1"
    q_dir = vid_dir / "questions"
    q_dir.mkdir(parents=True)
    (q_dir / "seg_0.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr("app.services.video_files.DOWNLOADS_DIR", tmp_path)
    files = list_question_json_files()
    assert len(files) == 1
    assert files[0]["video_id"] == "vid1"
    assert files[0]["name"] == "seg_0.json"

def test_list_question_json_files_empty(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.video_files.DOWNLOADS_DIR", tmp_path)
    files = list_question_json_files()
    assert files == []

def test_list_question_json_files_no_dir(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.video_files.DOWNLOADS_DIR", tmp_path / "nonexistent")
    files = list_question_json_files()
    assert files == []
