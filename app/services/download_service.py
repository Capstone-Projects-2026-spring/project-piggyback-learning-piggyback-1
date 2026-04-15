
# Youtube download helper

import os
import re
import json
import shutil
from pathlib import Path
from typing import Any, Dict
import yt_dlp
from app.services.video_files import find_primary_video_file
from app.settings import DOWNLOADS_DIR

def download_youtube(url: str) -> Dict[str, Any]:
    """
    Download a YouTube video and save metadata (title, thumbnail, duration).
    Returns: dict with success, message, video_id, title, thumbnail, and local paths.
    """
    result = {
        "success": False,
        "message": "Download error",
        "video_id": None,
        "title": None,
        "thumbnail": None,
        "files": [],
    }

    if not url:
        result["message"] = "No URL provided."
        return result

    if not (url.startswith("http") and ("youtube.com" in url or "youtu.be" in url)):
        result["message"] = "Please provide a valid YouTube URL."
        return result

    try:
        # Step 1: Get metadata only
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
            info = ydl.extract_info(url, download=False)
            video_id = info.get("id", "unknown")
            title = info.get("title", "Untitled Video")
            thumbnail = info.get("thumbnail", "")
            duration = info.get("duration", 0)

        result["video_id"] = video_id
        result["title"] = title
        result["thumbnail"] = thumbnail

        video_dir = DOWNLOADS_DIR / video_id
        video_dir.mkdir(parents=True, exist_ok=True)

        has_ffmpeg = shutil.which("ffmpeg") is not None
        has_node = shutil.which("node") is not None

        def _clean_ytdlp_error(message: str) -> str:
            return re.sub(r"\x1b\[[0-9;]*m", "", message).strip()

        # Step 2: Download actual video (prefer 720p on the first attempt)
        ydl_opts = {
            # Prefer highest-quality H.264 MP4 + M4A (avoid re-encode quality loss).
            "format": (
                "bv*[vcodec^=avc1][ext=mp4][height<=?720]+ba[acodec^=mp4a]/"
                "b[ext=mp4][height<=?720]/b[height<=?720]/b"
            ),
            "merge_output_format": "mp4",
            # Try to proceed even if some formats look unplayable
            "allow_unplayable_formats": True,
            # Output path
            "outtmpl": str(video_dir / f"{video_id}.%(ext)s"),
            # Quiet mode + warnings suppressed
            "quiet": False,
            "no_warnings": True,
            # Avoid progress rendering issues on some Windows terminals
            "noprogress": True,
            # Prevent playlists
            "noplaylist": True,
            # Save thumbnail + metadata (for kids panel)
            "writethumbnail": True,
            "writeinfojson": True,
            # Force ffmpeg to do proper muxing/remuxing (no re-encode).
            "prefer_ffmpeg": True,
            "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
        }

        if has_node:
            # Enable JS runtime to improve YouTube extraction reliability
            ydl_opts["js_runtimes"] = {"node": {}}
            # Fetch remote EJS components for tougher JS challenges
            ydl_opts["external_deps"] = {"ejs": "github"}

        cookies_file = (os.getenv("YTDLP_COOKIEFILE") or os.getenv("YTDLP_COOKIES_FILE") or "").strip()
        if cookies_file:
            ydl_opts["cookiefile"] = cookies_file
        else:
            # Auto-extract cookies from the browser the admin is logged into YouTube with.
            # Try Chrome first, then Edge, then Firefox.
            for browser in ("chrome", "edge", "firefox"):
                try:
                    with yt_dlp.YoutubeDL({"quiet": True, "cookiesfrombrowser": (browser,)}) as test_ydl:
                        test_ydl.extract_info("https://www.youtube.com", download=False)
                    ydl_opts["cookiesfrombrowser"] = (browser,)
                    break
                except Exception:
                    continue

        if not has_ffmpeg:
            ydl_opts["compat_opts"] = ["no-sabr"]
            ydl_opts["format"] = "best[ext=mp4]/best"

        def _download_with_format_fallback(opts: Dict[str, Any]) -> None:
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:  # type: ignore
                    ydl.download([url])
            except yt_dlp.utils.DownloadError as e:  # type: ignore
                message = str(e)
                if "Requested format is not available" in message:
                    fallback_opts = dict(opts)
                    if has_ffmpeg:
                        # Fall back to highest quality in native container if MP4/H.264 isn't available.
                        fallback_opts["format"] = "bestvideo+bestaudio/best"
                        fallback_opts.pop("merge_output_format", None)
                    else:
                        # No ffmpeg: keep it single-file to avoid merge failures.
                        fallback_opts["format"] = "best"
                        fallback_opts.pop("merge_output_format", None)
                    fallback_opts.pop("postprocessors", None)
                    # Let yt-dlp choose the most compatible client for fallback.
                    fallback_opts.pop("extractor_args", None)
                    with yt_dlp.YoutubeDL(fallback_opts) as ydl:  # type: ignore
                        ydl.download([url])
                else:
                    raise

        player_client_candidates = [
            ["android", "web"],
            ["tv", "web"],
            ["ios", "web"],
            ["web"],
        ]

        last_error = None
        used_player_client = None
        for player_client in player_client_candidates:
            attempt_opts = dict(ydl_opts)
            attempt_opts["extractor_args"] = {
                "youtube": {"player_client": player_client}
            }
            try:
                _download_with_format_fallback(attempt_opts)
                last_error = None
                used_player_client = player_client
                break
            except yt_dlp.utils.DownloadError as e:  # type: ignore
                message = str(e)
                if "HTTP Error 403" in message or "403" in message:
                    last_error = e
                    continue
                raise

        if last_error is not None:
            raise last_error

        subtitle_warning = None
        subtitle_opts = {
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

        if has_node:
            subtitle_opts["js_runtimes"] = {"node": {}}
            subtitle_opts["external_deps"] = {"ejs": "github"}

        if cookies_file:
            subtitle_opts["cookiefile"] = cookies_file
        elif "cookiesfrombrowser" in ydl_opts:
            subtitle_opts["cookiesfrombrowser"] = ydl_opts["cookiesfrombrowser"]

        if used_player_client:
            subtitle_opts["extractor_args"] = {
                "youtube": {"player_client": used_player_client}
            }

        try:
            with yt_dlp.YoutubeDL(subtitle_opts) as ydl:  # type: ignore
                ydl.download([url])
        except yt_dlp.utils.DownloadError as e:  # type: ignore
            subtitle_warning = _clean_ytdlp_error(str(e))

        # Step 3: Collect downloaded files
        created = []
        for p in sorted(video_dir.iterdir()):
            if p.is_file():
                rel = p.relative_to(DOWNLOADS_DIR).as_posix()
                created.append(rel)

        video_path = find_primary_video_file(video_dir)

        if not video_path:
            result["message"] = "Download completed but no video file was found."
            result["files"] = created
            return result

        if video_path.suffix.lower() == ".mp4" and not _looks_like_mp4(video_path):
            result["message"] = (
                "Downloaded file is not a valid MP4 container (likely HLS/TS). "
                "Install ffmpeg or re-download with a non-SABR format."
            )
            result["files"] = created
            return result

        # Step 4: Save metadata file
        meta = {
            "video_id": video_id,
            "title": title,
            "thumbnail": thumbnail,
            "duration": duration,
            "local_path": f"/downloads/{video_path.relative_to(DOWNLOADS_DIR).as_posix()}",
        }

        meta_path = video_dir / "meta.json"
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        # Step 5: Return result
        result.update(
            {
                "success": True,
                "message": "Video downloaded successfully.",
                "files": created,
                "duration": duration,
                "local_path": meta["local_path"],
            }
        )
        if subtitle_warning:
            result["subtitle_warning"] = subtitle_warning
        return result

    except yt_dlp.utils.DownloadError as e:  # type: ignore
        result["message"] = f"Download error: {e}"
        return result
    except Exception as e:
        result["message"] = f"Unexpected error: {e}"
        return result
    
def _looks_like_mp4(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            header = handle.read(64)
        return b"ftyp" in header
    except Exception:
        return False
