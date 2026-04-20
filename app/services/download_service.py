# Youtube download helper

import copy
import json
import os
import platform
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Sequence, Tuple

import yt_dlp

from app.services.video_files import find_primary_video_file
from app.settings import DOWNLOADS_DIR

WINDOWS_BROWSERS = ("chrome", "firefox", "edge")
MACOS_BROWSERS = ("chrome", "firefox")
PROTECTED_PLAYER_CLIENTS = (
    ("tv_downgraded", "web_safari"),
    ("web_creator", "tv_downgraded"),
    ("web_embedded", "android", "web"),
    ("android", "web"),
)


def download_youtube(url: str) -> Dict[str, Any]:
    result = {
        "success": False,
        "message": "Download error",
        "video_id": None,
        "title": None,
        "thumbnail": None,
        "files": [],
    }

    normalized_url = _normalize_youtube_url(url)
    if not normalized_url:
        result["message"] = "Please provide a valid YouTube URL."
        result["error_code"] = "invalid_url"
        result["auth_source"] = "none"
        return result

    system_name = platform.system()
    auth_profile = _select_auth_profile(system_name=system_name)
    ffmpeg_path = _resolve_ffmpeg_path()
    has_ffmpeg = ffmpeg_path is not None
    has_node = shutil.which("node") is not None
    user_agent = (os.getenv("YTDLP_USER_AGENT") or "").strip() or None
    result["auth_source"] = auth_profile["source"]

    try:
        info = _extract_metadata(
            normalized_url,
            auth_profile=auth_profile,
            has_node=has_node,
            user_agent=user_agent,
            system_name=system_name,
        )
        video_id = info.get("id", "unknown")
        title = info.get("title", "Untitled Video")
        thumbnail = info.get("thumbnail", "")
        duration = info.get("duration", 0)

        result["video_id"] = video_id
        result["title"] = title
        result["thumbnail"] = thumbnail

        video_dir = DOWNLOADS_DIR / video_id
        video_dir.mkdir(parents=True, exist_ok=True)
        _remove_stale_invalid_mp4(video_dir, video_id)

        used_player_client = _download_video(
            normalized_url,
            video_dir=video_dir,
            video_id=video_id,
            auth_profile=auth_profile,
            has_ffmpeg=has_ffmpeg,
            ffmpeg_path=ffmpeg_path,
            has_node=has_node,
            user_agent=user_agent,
            system_name=system_name,
        )

        subtitle_warning = _download_subtitles(
            normalized_url,
            video_dir=video_dir,
            video_id=video_id,
            auth_profile=auth_profile,
            has_node=has_node,
            used_player_client=used_player_client,
            user_agent=user_agent,
        )

        created = _collect_created_files(video_dir)
        video_path = find_primary_video_file(video_dir)

        if not video_path:
            result["message"] = "Download completed but no video file was found."
            result["error_code"] = "video_file_missing"
            result["files"] = created
            if used_player_client:
                result["used_player_client"] = used_player_client
            return result

        if video_path.suffix.lower() == ".mp4" and not _looks_like_mp4(video_path):
            repaired = _repair_invalid_mp4(video_path, ffmpeg_path)
            if repaired:
                created = _collect_created_files(video_dir)
                video_path = repaired
        if video_path.suffix.lower() == ".mp4" and not _looks_like_mp4(video_path):
            result["message"] = (
                "Downloaded file is not a valid MP4 container. "
                "Restart the app after installing ffmpeg or retry with a non-SABR format."
            )
            result["error_code"] = "invalid_container"
            result["files"] = created
            if used_player_client:
                result["used_player_client"] = used_player_client
            return result

        meta = {
            "video_id": video_id,
            "title": title,
            "thumbnail": thumbnail,
            "duration": duration,
            "local_path": f"/downloads/{video_path.relative_to(DOWNLOADS_DIR).as_posix()}",
        }

        meta_path = video_dir / "meta.json"
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        result.update(
            {
                "success": True,
                "message": "Video downloaded successfully.",
                "files": created,
                "duration": duration,
                "local_path": meta["local_path"],
                "auth_source": auth_profile["source"],
            }
        )
        if used_player_client:
            result["used_player_client"] = used_player_client
        if subtitle_warning:
            result["subtitle_warning"] = subtitle_warning
        return result

    except yt_dlp.utils.DownloadError as exc:  # type: ignore[attr-defined]
        _apply_download_error(
            result,
            message=str(exc),
            auth_profile=auth_profile,
            system_name=system_name,
            user_agent_set=bool(user_agent),
        )
        return result
    except Exception as exc:
        result["message"] = f"Unexpected error: {exc}"
        result["error_code"] = "unexpected_error"
        result["auth_source"] = auth_profile["source"]
        return result


def _normalize_youtube_url(url: str) -> Optional[str]:
    candidate = (url or "").strip()
    if not candidate:
        return None
    lowered = candidate.lower()
    if not candidate.startswith("http"):
        return None
    if "youtube.com" not in lowered and "youtu.be" not in lowered:
        return None
    return candidate


def _extract_metadata(
    url: str,
    auth_profile: Dict[str, Any],
    has_node: bool,
    user_agent: Optional[str],
    system_name: str,
) -> Dict[str, Any]:
    opts = _build_metadata_opts(auth_profile=auth_profile, has_node=has_node)
    info, _ = _run_ytdlp_with_auth_fallback(
        url,
        base_opts=opts,
        auth_profile=auth_profile,
        user_agent=user_agent,
        system_name=system_name,
        operation=lambda attempt_opts: _run_extract_info(url, attempt_opts),
    )
    return info


def _download_video(
    url: str,
    video_dir: Path,
    video_id: str,
    auth_profile: Dict[str, Any],
    has_ffmpeg: bool,
    ffmpeg_path: Optional[str],
    has_node: bool,
    user_agent: Optional[str],
    system_name: str,
) -> Optional[Sequence[str]]:
    opts = _build_download_opts(
        video_dir=video_dir,
        video_id=video_id,
        auth_profile=auth_profile,
        has_ffmpeg=has_ffmpeg,
        ffmpeg_path=ffmpeg_path,
        has_node=has_node,
    )
    _, used_player_client = _run_ytdlp_with_auth_fallback(
        url,
        base_opts=opts,
        auth_profile=auth_profile,
        user_agent=user_agent,
        system_name=system_name,
        operation=lambda attempt_opts: _download_with_format_fallback(
            url,
            opts=attempt_opts,
            has_ffmpeg=has_ffmpeg,
        ),
    )
    return used_player_client


def _download_subtitles(
    url: str,
    video_dir: Path,
    video_id: str,
    auth_profile: Dict[str, Any],
    has_node: bool,
    used_player_client: Optional[Sequence[str]],
    user_agent: Optional[str],
) -> Optional[str]:
    subtitle_opts = _build_subtitle_opts(
        video_dir=video_dir,
        video_id=video_id,
        auth_profile=auth_profile,
        has_node=has_node,
        used_player_client=used_player_client,
        user_agent=user_agent,
    )
    try:
        with yt_dlp.YoutubeDL(subtitle_opts) as ydl:  # type: ignore[arg-type]
            ydl.download([url])
    except yt_dlp.utils.DownloadError as exc:  # type: ignore[attr-defined]
        return _clean_ytdlp_error(str(exc))
    return None


def _run_ytdlp_with_auth_fallback(
    url: str,
    base_opts: Dict[str, Any],
    auth_profile: Dict[str, Any],
    user_agent: Optional[str],
    system_name: str,
    operation: Callable[[Dict[str, Any]], Any],
) -> Tuple[Any, Optional[Sequence[str]]]:
    last_error: Optional[Exception] = None
    last_classification: Optional[Dict[str, Any]] = None
    try:
        return operation(copy.deepcopy(base_opts)), None
    except yt_dlp.utils.DownloadError as exc:  # type: ignore[attr-defined]
        classification = _classify_ytdlp_error(
            str(exc),
            auth_profile=auth_profile,
            system_name=system_name,
            user_agent_set=bool(user_agent),
        )
        if not classification["retry_other_clients"]:
            raise
        last_error = exc
        last_classification = classification

    for player_client in PROTECTED_PLAYER_CLIENTS:
        attempt_opts = copy.deepcopy(base_opts)
        attempt_opts["extractor_args"] = {
            "youtube": {"player_client": list(player_client)}
        }
        if user_agent:
            _apply_user_agent(attempt_opts, user_agent)
        try:
            return operation(attempt_opts), list(player_client)
        except yt_dlp.utils.DownloadError as exc:  # type: ignore[attr-defined]
            classification = _classify_ytdlp_error(
                str(exc),
                auth_profile=auth_profile,
                system_name=system_name,
                user_agent_set=bool(user_agent),
            )
            if classification["retry_other_clients"]:
                last_error = exc
                last_classification = classification
                continue
            raise

    if last_classification and last_classification["error_code"] == "format_unavailable":
        missing_pot_opts = _with_missing_pot_formats(base_opts)
        if user_agent:
            _apply_user_agent(missing_pot_opts, user_agent)
        try:
            return operation(missing_pot_opts), None
        except yt_dlp.utils.DownloadError as exc:  # type: ignore[attr-defined]
            last_error = exc

    if last_error is not None:
        raise last_error
    raise yt_dlp.utils.DownloadError(f"Download failed for {url}")  # type: ignore[attr-defined]


def _run_extract_info(url: str, opts: Dict[str, Any]) -> Dict[str, Any]:
    with yt_dlp.YoutubeDL(opts) as ydl:  # type: ignore[arg-type]
        return ydl.extract_info(url, download=False)


def _download_with_format_fallback(url: str, opts: Dict[str, Any], has_ffmpeg: bool) -> None:
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:  # type: ignore[arg-type]
            ydl.download([url])
    except yt_dlp.utils.DownloadError as exc:  # type: ignore[attr-defined]
        message = str(exc)
        if "Requested format is not available" not in message:
            raise
        fallback_opts = copy.deepcopy(opts)
        if has_ffmpeg:
            fallback_opts["format"] = "bestvideo+bestaudio/best"
        else:
            fallback_opts["format"] = "best"
        fallback_opts.pop("merge_output_format", None)
        fallback_opts.pop("postprocessors", None)
        try:
            with yt_dlp.YoutubeDL(fallback_opts) as ydl:  # type: ignore[arg-type]
                ydl.download([url])
        except yt_dlp.utils.DownloadError as fallback_exc:  # type: ignore[attr-defined]
            fallback_message = str(fallback_exc)
            if "Requested format is not available" not in fallback_message:
                raise
            second_fallback_opts = copy.deepcopy(fallback_opts)
            second_fallback_opts.pop("extractor_args", None)
            with yt_dlp.YoutubeDL(second_fallback_opts) as ydl:  # type: ignore[arg-type]
                ydl.download([url])


def _build_metadata_opts(auth_profile: Dict[str, Any], has_node: bool) -> Dict[str, Any]:
    opts: Dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
    }
    _apply_runtime_options(opts, has_node)
    _apply_auth_options(opts, auth_profile)
    return opts


def _build_download_opts(
    video_dir: Path,
    video_id: str,
    auth_profile: Dict[str, Any],
    has_ffmpeg: bool,
    ffmpeg_path: Optional[str],
    has_node: bool,
) -> Dict[str, Any]:
    opts: Dict[str, Any] = {
        "format": _preferred_download_format(has_ffmpeg),
        "merge_output_format": "mp4",
        "allow_unplayable_formats": True,
        "outtmpl": str(video_dir / f"{video_id}.%(ext)s"),
        "quiet": False,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "writethumbnail": True,
        "writeinfojson": True,
        "prefer_ffmpeg": True,
        "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
    }
    _apply_runtime_options(opts, has_node)
    _apply_auth_options(opts, auth_profile)
    if ffmpeg_path:
        opts["ffmpeg_location"] = ffmpeg_path
    if not has_ffmpeg:
        opts["compat_opts"] = ["no-sabr"]
    return opts


def _preferred_download_format(has_ffmpeg: bool) -> str:
    if has_ffmpeg:
        return (
            "bv*[vcodec^=avc1][ext=mp4][height<=?720]+ba[acodec^=mp4a]/"
            "b[ext=mp4][height<=?720]/"
            "bv*[height<=?720]+ba/"
            "b[height<=?720]/"
            "bestvideo+bestaudio/best"
        )
    return "b[ext=mp4][height<=?720]/b[height<=?720]/best[ext=mp4]/best"


def _build_subtitle_opts(
    video_dir: Path,
    video_id: str,
    auth_profile: Dict[str, Any],
    has_node: bool,
    used_player_client: Optional[Sequence[str]],
    user_agent: Optional[str],
) -> Dict[str, Any]:
    opts: Dict[str, Any] = {
        "outtmpl": str(video_dir / f"{video_id}.%(ext)s"),
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en"],
        "subtitlesformat": "vtt",
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
    }
    _apply_runtime_options(opts, has_node)
    _apply_auth_options(opts, auth_profile)
    if used_player_client:
        opts["extractor_args"] = {
            "youtube": {"player_client": list(used_player_client)}
        }
    if used_player_client and user_agent:
        _apply_user_agent(opts, user_agent)
    return opts


def _with_missing_pot_formats(opts: Dict[str, Any]) -> Dict[str, Any]:
    updated = copy.deepcopy(opts)
    extractor_args = copy.deepcopy(updated.get("extractor_args") or {})
    youtube_args = copy.deepcopy(extractor_args.get("youtube") or {})
    formats = list(youtube_args.get("formats") or [])
    if "missing_pot" not in formats:
        formats.append("missing_pot")
    youtube_args["formats"] = formats
    extractor_args["youtube"] = youtube_args
    updated["extractor_args"] = extractor_args
    return updated


def _apply_runtime_options(opts: Dict[str, Any], has_node: bool) -> None:
    opts["remote_components"] = ["ejs:github"]
    if not has_node:
        return
    opts["js_runtimes"] = {"node": {}}


def _apply_auth_options(opts: Dict[str, Any], auth_profile: Dict[str, Any]) -> None:
    source = auth_profile.get("source")
    if source == "browser" and auth_profile.get("browser"):
        opts["cookiesfrombrowser"] = (auth_profile["browser"],)
    elif source == "cookiefile" and auth_profile.get("cookiefile"):
        opts["cookiefile"] = auth_profile["cookiefile"]


def _apply_user_agent(opts: Dict[str, Any], user_agent: str) -> None:
    headers = dict(opts.get("http_headers") or {})
    headers["User-Agent"] = user_agent
    opts["http_headers"] = headers


def _select_auth_profile(
    system_name: Optional[str] = None,
    auth_mode: Optional[str] = None,
    cookiefile: Optional[str] = None,
    browser_probe: Optional[Callable[[str], bool]] = None,
) -> Dict[str, Any]:
    resolved_mode = _resolve_auth_mode(auth_mode)
    resolved_cookiefile = _resolve_cookiefile(cookiefile)
    probe = browser_probe or _browser_session_available
    browser_order = list(_preferred_browser_order(system_name))

    if resolved_mode in {"auto", "browser"}:
        for browser in browser_order:
            if probe(browser):
                return {
                    "source": "browser",
                    "browser": browser,
                    "cookiefile": None,
                    "auth_mode": resolved_mode,
                    "browser_order": browser_order,
                }
        if resolved_mode == "auto" and resolved_cookiefile:
            return {
                "source": "cookiefile",
                "browser": None,
                "cookiefile": resolved_cookiefile,
                "auth_mode": resolved_mode,
                "browser_order": browser_order,
            }

    if resolved_mode == "file" and resolved_cookiefile:
        return {
            "source": "cookiefile",
            "browser": None,
            "cookiefile": resolved_cookiefile,
            "auth_mode": resolved_mode,
            "browser_order": browser_order,
        }

    return {
        "source": "none",
        "browser": None,
        "cookiefile": resolved_cookiefile,
        "auth_mode": resolved_mode,
        "browser_order": browser_order,
    }


def _resolve_auth_mode(auth_mode: Optional[str] = None) -> str:
    candidate = (auth_mode or os.getenv("YTDLP_AUTH_MODE") or "auto").strip().lower()
    if candidate not in {"auto", "browser", "file"}:
        return "auto"
    return candidate


def _resolve_cookiefile(cookiefile: Optional[str] = None) -> Optional[str]:
    raw_value = (
        cookiefile
        or os.getenv("YTDLP_COOKIEFILE")
        or os.getenv("YTDLP_COOKIES_FILE")
        or ""
    ).strip()
    if not raw_value:
        return None
    try:
        resolved = Path(raw_value).expanduser()
        if resolved.exists():
            return str(resolved)
    except OSError:
        return None
    return None


def _preferred_browser_order(system_name: Optional[str] = None) -> Tuple[str, ...]:
    current_system = system_name or platform.system()
    if current_system == "Windows":
        return WINDOWS_BROWSERS
    if current_system == "Darwin":
        return MACOS_BROWSERS
    return WINDOWS_BROWSERS


def _browser_session_available(browser: str) -> bool:
    try:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "cookiesfrombrowser": (browser,),
        }
        with yt_dlp.YoutubeDL(opts) as ydl:  # type: ignore[arg-type]
            ydl.extract_info("https://www.youtube.com", download=False)
        return True
    except Exception:
        return False


def _classify_ytdlp_error(
    message: str,
    auth_profile: Dict[str, Any],
    system_name: str,
    user_agent_set: bool,
) -> Dict[str, Any]:
    clean = _clean_ytdlp_error(message)
    lowered = clean.lower()

    if "requested format is not available" in lowered:
        return {
            "error_code": "format_unavailable",
            "message": "Requested video format is not available for this video.",
            "recovery_hint": "Retry the download or install ffmpeg to allow broader format fallbacks.",
            "is_auth_error": False,
            "retry_other_clients": True,
        }

    if any(
        token in lowered
        for token in (
            "age-restricted",
            "confirm your age",
            "age verification",
            "age-verification",
            "inappropriate for some users",
        )
    ):
        return {
            "error_code": "age_verification_required",
            "message": "YouTube requires an age-verified account for this video.",
            "recovery_hint": _build_auth_recovery_hint(
                auth_profile=auth_profile,
                system_name=system_name,
                user_agent_set=user_agent_set,
                age_verified=True,
            ),
            "is_auth_error": True,
            "retry_other_clients": True,
        }

    if any(
        token in lowered
        for token in (
            "not a bot",
            "sign in to confirm",
            "use --cookies-from-browser",
            "cookies for the authentication",
            "requires account credentials",
            "login required",
        )
    ):
        return {
            "error_code": "auth_required",
            "message": "YouTube requires a signed-in browser session for this video.",
            "recovery_hint": _build_auth_recovery_hint(
                auth_profile=auth_profile,
                system_name=system_name,
                user_agent_set=user_agent_set,
            ),
            "is_auth_error": True,
            "retry_other_clients": True,
        }

    if any(
        token in lowered
        for token in (
            "too many requests",
            "rate limit",
            "try again later",
            "temporarily unavailable",
            "429",
        )
    ):
        return {
            "error_code": "rate_limited",
            "message": "YouTube temporarily rate-limited this session.",
            "recovery_hint": _build_rate_limit_hint(system_name),
            "is_auth_error": False,
            "retry_other_clients": False,
        }

    if "403" in lowered:
        return {
            "error_code": "forbidden",
            "message": "YouTube rejected the download request.",
            "recovery_hint": _build_auth_recovery_hint(
                auth_profile=auth_profile,
                system_name=system_name,
                user_agent_set=user_agent_set,
            ),
            "is_auth_error": True,
            "retry_other_clients": True,
        }

    return {
        "error_code": "download_failed",
        "message": f"Download error: {clean}",
        "recovery_hint": None,
        "is_auth_error": False,
        "retry_other_clients": False,
    }


def _build_auth_recovery_hint(
    auth_profile: Dict[str, Any],
    system_name: str,
    user_agent_set: bool,
    age_verified: bool = False,
) -> str:
    browser_text = _browser_help_text(system_name)
    source = auth_profile.get("source")
    browser = _browser_label(auth_profile.get("browser"))

    if source == "browser" and browser:
        hint = f"Open the video in the same signed-in {browser} session on this machine, refresh YouTube, and retry."
    elif source == "cookiefile":
        hint = (
            "The configured cookies file may be stale. Export a fresh Netscape cookies file "
            f"or retry with a signed-in {browser_text} session on this machine."
        )
    else:
        hint = f"Sign in to YouTube in {browser_text} on this machine, open the video once, and retry."

    if age_verified:
        hint = f"{hint} Use an adult account that can view age-restricted content."

    if system_name == "Darwin":
        hint = f"{hint} Safari is not guaranteed for protected downloads."

    if not user_agent_set:
        hint = f"{hint} If it still fails, set YTDLP_USER_AGENT to that browser user agent."

    return hint.strip()


def _build_rate_limit_hint(system_name: str) -> str:
    browser_text = _browser_help_text(system_name)
    hint = f"Wait a few minutes, open YouTube in {browser_text} on this machine, then retry."
    if system_name == "Darwin":
        hint = f"{hint} Safari is not guaranteed for protected downloads."
    return hint


def _browser_help_text(system_name: str) -> str:
    if system_name == "Windows":
        return "Chrome, Firefox, or Edge"
    if system_name == "Darwin":
        return "Chrome or Firefox"
    return "a supported browser"


def _browser_label(browser: Optional[str]) -> Optional[str]:
    if not browser:
        return None
    return {
        "chrome": "Chrome",
        "firefox": "Firefox",
        "edge": "Edge",
    }.get(browser, browser.title())


def _apply_download_error(
    result: Dict[str, Any],
    message: str,
    auth_profile: Dict[str, Any],
    system_name: str,
    user_agent_set: bool,
) -> None:
    classification = _classify_ytdlp_error(
        message,
        auth_profile=auth_profile,
        system_name=system_name,
        user_agent_set=user_agent_set,
    )
    result["message"] = classification["message"]
    result["error_code"] = classification["error_code"]
    result["auth_source"] = auth_profile["source"]
    if classification["recovery_hint"]:
        result["recovery_hint"] = classification["recovery_hint"]


def _collect_created_files(video_dir: Path) -> Sequence[str]:
    created = []
    for path in sorted(video_dir.iterdir()):
        if path.is_file():
            created.append(path.relative_to(DOWNLOADS_DIR).as_posix())
    return created


def _resolve_ffmpeg_path() -> Optional[str]:
    resolved = shutil.which("ffmpeg")
    if resolved:
        return resolved
    if platform.system() != "Windows":
        return None

    local_appdata = os.getenv("LOCALAPPDATA") or ""
    if not local_appdata:
        return None

    winget_link = Path(local_appdata) / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe"
    if winget_link.exists():
        return str(winget_link)

    packages_dir = Path(local_appdata) / "Microsoft" / "WinGet" / "Packages"
    if not packages_dir.is_dir():
        return None

    for pattern in ("Gyan.FFmpeg.Essentials_*", "Gyan.FFmpeg_*", "*FFmpeg*"):
        for package_dir in sorted(packages_dir.glob(pattern), reverse=True):
            binary = next(package_dir.rglob("ffmpeg.exe"), None)
            if binary:
                return str(binary)
    return None


def _remove_stale_invalid_mp4(video_dir: Path, video_id: str) -> None:
    stale_mp4 = video_dir / f"{video_id}.mp4"
    if not stale_mp4.exists() or _looks_like_mp4(stale_mp4):
        return
    for suffix in ("", ".part", ".ytdl"):
        candidate = video_dir / f"{video_id}.mp4{suffix}"
        try:
            if candidate.exists():
                candidate.unlink()
        except OSError:
            continue


def _clean_ytdlp_error(message: str) -> str:
    clean = re.sub(r"\x1b\[[0-9;]*m", "", message).strip()
    return re.sub(r"^ERROR:\s*", "", clean)


def _repair_invalid_mp4(video_path: Path, ffmpeg_path: Optional[str]) -> Optional[Path]:
    if not ffmpeg_path or not video_path.exists():
        return None

    repaired_path = video_path.with_name(f"{video_path.stem}.remux.mp4")
    command = [
        ffmpeg_path,
        "-y",
        "-i",
        str(video_path),
        "-map",
        "0",
        "-c",
        "copy",
        str(repaired_path),
    ]

    try:
        if repaired_path.exists():
            repaired_path.unlink()
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
        if completed.returncode != 0 or not _looks_like_mp4(repaired_path):
            if repaired_path.exists():
                repaired_path.unlink()
            return None
        video_path.unlink()
        repaired_path.replace(video_path)
        return video_path
    except (OSError, subprocess.SubprocessError):
        if repaired_path.exists():
            try:
                repaired_path.unlink()
            except OSError:
                pass
        return None


def _looks_like_mp4(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            header = handle.read(64)
        return b"ftyp" in header
    except Exception:
        return False
