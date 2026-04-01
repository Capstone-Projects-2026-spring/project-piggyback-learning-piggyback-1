from typing import Any, Dict, List
import json

import cv2

from app.settings import DOWNLOADS_DIR
from app.services.video_files import find_primary_video_file


def extract_frames_per_second_for_video(video_id: str) -> Dict[str, Any]:
    """
    Extract 1 frame per second from downloads/<video_id> into extracted_frames/.
    Service-only logic: no route/web dependencies.
    """
    folder_path = DOWNLOADS_DIR / video_id
    if not folder_path.exists():
        return {
            "success": False,
            "message": f"Folder '{video_id}' not found.",
            "files": [],
        }

    video_file = find_primary_video_file(folder_path)
    if not video_file:
        return {
            "success": False,
            "message": f"No video files found in '{video_id}'.",
            "files": [],
        }

    output_dir = folder_path / "extracted_frames"
    output_dir.mkdir(exist_ok=True)

    cap = cv2.VideoCapture(str(video_file))
    if not cap.isOpened():
        return {
            "success": False,
            "message": f"Error opening video file: {video_file.name}",
            "files": [],
        }

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if fps is None or fps <= 0:
        cap.release()
        return {"success": False, "message": "Invalid FPS detected.", "files": []}

    duration = total_video_frames / fps
    total_seconds = int(duration)

    frame_data = []
    for second in range(total_seconds):
        frame_number = int(second * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        if not ret:
            continue

        frame_filename = f"frame_{second:04d}s.jpg"
        frame_path = output_dir / frame_filename
        ok, encoded = cv2.imencode(".jpg", frame)
        if not ok:
            continue
        encoded.tofile(str(frame_path))

        frame_info = {
            "frame_number": second + 1,
            "timestamp_seconds": second,
            "timestamp_formatted": f"{second // 60:02d}:{second % 60:02d}",
            "filename": frame_filename,
            "file_path": str(frame_path),
        }
        frame_data.append(frame_info)

    cap.release()

    # Persist machine-readable frame metadata.
    json_path = output_dir / "frame_data.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "video_info": {
                    "filename": video_file.name,
                    "duration_seconds": duration,
                    "total_frames": total_video_frames,
                    "fps": fps,
                    "extracted_frames": len(frame_data),
                },
                "frames": frame_data,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )


    # Persist CSV for debugging/manual review.
    csv_path = output_dir / "frame_data.csv"
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write("Frame,Timestamp,Time_Formatted,Filename\n")
        for fr in frame_data:
            f.write(
                f"{fr['frame_number']},{fr['timestamp_seconds']},"
                f"{fr['timestamp_formatted']},{fr['filename']}\n"
            )

    links: List[str] = []
    if output_dir.exists():
        for p in sorted(output_dir.iterdir()):
            if p.is_file():
                rel = p.relative_to(DOWNLOADS_DIR).as_posix()
                links.append(f"/downloads/{rel}")

    return {
        "success": True,
        "message": f"Extracted {len(frame_data)} frames to '{output_dir.name}'.",
        "files": links,
        "video_id": video_id,
        "output_dir": f"/downloads/{video_id}/extracted_frames",
        "count": len(frame_data),
    }
