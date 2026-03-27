from typing import Any, Dict, List, Optional
from pathlib import Path
import base64
import io
import json
import os
import random
import time

import pandas as pd
from PIL import Image

from app.settings import DOWNLOADS_DIR, GEMINI_API_KEY ,ANTHROPIC_API_KEY
from app.services.clients import OPENAI_CLIENT, genai

import anthropic

# -----------------------------
# Question generation helpers
# -----------------------------
def encode_image_to_base64(image_path, max_size=(512, 512)):
    """Convert image to base64 string with optional resizing for efficiency"""
    try:
        with Image.open(image_path) as img:
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.thumbnail(max_size, Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=85)
            image_bytes = buffer.getvalue()
            return base64.b64encode(image_bytes).decode("utf-8")
    except Exception as e:
        print(f"Error encoding image {image_path}: {e}")
        return None


def time_to_seconds(time_str):
    """Convert time string (HH:MM:SS or MM:SS) to seconds"""
    try:
        parts = time_str.split(":")
        if len(parts) == 3:  # HH:MM:SS
            hours, minutes, seconds = map(int, parts)
            return hours * 3600 + minutes * 60 + seconds
        elif len(parts) == 2:  # MM:SS
            minutes, seconds = map(int, parts)
            return minutes * 60 + seconds
        else:  # Just seconds
            return int(parts[0])
    except (TypeError, ValueError):
        return 0


def read_frame_data_from_csv(folder_name, start_time, end_time):
    """Read frame data from CSV file and get frames within specified time range"""
    folder_path = Path(folder_name)
    frames_dir = folder_path / "extracted_frames"
    csv_path = frames_dir / "frame_data.csv"

    if not csv_path.exists():
        return [], ""

    try:
        df = pd.read_csv(csv_path)

        # Convert time strings to seconds for filtering
        if "Time_Formatted" in df.columns:
            df["Time_Seconds"] = df["Time_Formatted"].apply(time_to_seconds)
        elif "Time_Seconds" in df.columns:
            pass
        else:
            df["Time_Seconds"] = df.index  # fallback

        filtered_frames = df[
            (df["Time_Seconds"] >= start_time) & (df["Time_Seconds"] <= end_time)
        ]
        if len(filtered_frames) == 0:
            return [], ""

        frame_data = []
        transcript_parts = []

        for _, row in filtered_frames.iterrows():
            image_path = frames_dir / row["Filename"]
            frame_info = {
                "image_path": image_path,
                "subtitle_text": row.get("Subtitle_Text", "No transcript available"),
                "time_seconds": row.get("Time_Seconds", 0),
                "time_formatted": row.get("Time_Formatted", ""),
            }
            frame_data.append(frame_info)

            subtitle = row.get("Subtitle_Text", "")
            if subtitle and subtitle not in [
                "No transcript available",
                "No subtitle at this time",
                "No subtitles available",
            ]:
                time_label = row.get("Time_Formatted", f"{row.get('Time_Seconds', 0)}s")
                transcript_parts.append(f"[{time_label}] {subtitle}")

        complete_transcript = (
            "\n".join(transcript_parts)
            if transcript_parts
            else "No transcript available for this video segment."
        )
        return frame_data, complete_transcript

    except Exception as e:
        print(f"Error reading CSV: {e}")
        return [], ""





def generate_questions_for_segment(
    video_id: str, start_time: int, end_time: int, polite_first: bool = False, provider: Optional[str] = None
) -> Optional[str]:
    """
    Analyze frames + transcript for a time window and return JSON text with the questions.
    Uses env-provided OPENAI_API_KEY only. Optimized for rate limits with retry logic.
    When polite_first is True, the polite prompt is attempted before the standard prompt.
    """
    folder_name = str(DOWNLOADS_DIR / video_id)
    try:
        client = OPENAI_CLIENT
    except Exception as e:
        print(f"Error creating OpenAI client: {e}")
        return None

    frame_data, complete_transcript = read_frame_data_from_csv(
        folder_name, start_time, end_time
    )
    if not frame_data:
        return json.dumps(
            {
                "error": {
                    "reason": "no_frames_in_segment",
                    "retryable": False,
                }
            }
        )

    duration = end_time - start_time + 1  # inclusive window
    #Provider is requested- scope so Admin switch model backend without changing flow.
    provider_name = (provider or "openai").strip().lower()
    if provider_name not in {"openai", "gemini","claude"}:
        provider_name = "openai"


    system_message = (
        "You are a safe, child-focused educational assistant. "
        "The content is a children's educational video. "
        "Follow all safety policies and avoid disallowed content. "
        "Provide age-appropriate, neutral, factual responses only."
    )

    # First attempt with standard prompt
    base_prompt = f"""You are an early childhood educator designing comprehension questions for children ages 6–8. 
    Analyze the video content using both the visual frames and the complete transcript provided below.

COMPLETE TRANSCRIPT:
==========================================
{complete_transcript}
==========================================

TASK:
I am providing you with {len(frame_data)} sequential frames from a {duration}-second segment ({start_time}s to {end_time}s) of a video, 
along with the complete transcript above.

Please do the following:

1. Provide ONE short, child-friendly comprehension question for EACH of the following categories:
   - Character
   - Setting
   - Feeling
   - Action
   - Causal Relationship
   - Outcome
   - Prediction

2. After creating the questions, rank the questions based on how relevant and good it is to test comprehension and active viewing, the best question will be ranked 1

3. Return JSON only (no extra text) in this structure:
{{
  "questions": {{
    "character": {{ "q": "...", "a": "...", "rank":"" }},
    "setting": {{ "q": "...", "a": "...", "rank":"" }},
    "feeling": {{ "q": "...", "a": "...", "rank":"" }},
    "action": {{ "q": "...", "a": "...", "rank":"" }},
    "causal": {{ "q": "...", "a": "...", "rank":"" }},
    "outcome": {{ "q": "...", "a": "...", "rank":"" }},
    "prediction": {{ "q": "...", "a": "...", "rank":"" }}
  }},
  "best_question": "..."
}}
"""

    # Second attempt with more persuasive prompt
    polite_prompt = f"""You are helping create educational questions for young children. This is a children's educational video with no violence or inappropriate content, designed to teach kids in a safe, age-appropriate way.

COMPLETE TRANSCRIPT:
==========================================
{complete_transcript}
==========================================

I am providing you with {len(frame_data)} sequential frames from a {duration}-second segment ({start_time}s to {end_time}s) of this educational children's video, along with the complete transcript above.

Please create ONE short, child-friendly comprehension question for EACH of the following categories:
- Character
- Setting  
- Feeling
- Action
- Causal Relationship
- Outcome
- Prediction

After creating the questions, please rank the questions based on how relevant and good it is to test comprehension and active viewing, the best question will be ranked 1

Return JSON only (no extra text) in this structure:
{{
  "questions": {{
    "character": {{ "q": "...", "a": "...", "rank":"" }},
    "setting": {{ "q": "...", "a": "...", "rank":"" }},
    "feeling": {{ "q": "...", "a": "...", "rank":"" }},
    "action": {{ "q": "...", "a": "...", "rank":"" }},
    "causal": {{ "q": "...", "a": "...", "rank":"" }},
    "outcome": {{ "q": "...", "a": "...", "rank":"" }},
    "prediction": {{ "q": "...", "a": "...", "rank":"" }}
  }},
  "best_question": "..."
}}
"""

    content = []

    # Sample frames to stay under token limits (max 5 frames)
    max_frames = 5
    if len(frame_data) > max_frames:
        step = len(frame_data) // max_frames
        sampled_frames = [frame_data[i] for i in range(0, len(frame_data), step)][
            :max_frames
        ]
    else:
        sampled_frames = frame_data

    # Add sampled frames as low-detail inline images
    successful_frames = 0
    for fr in sampled_frames:
        b64 = encode_image_to_base64(fr["image_path"])
        if b64:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{b64}",
                        "detail": "low",
                    },
                }
            )
            successful_frames += 1

    if successful_frames == 0:
        return json.dumps(
            {
                "error": {
                    "reason": "frame_encoding_failed",
                    "retryable": False,
                }
            }
        )

    # Try both prompts with retry logic. Reorder to emphasize polite tone after early failures.
    prompt_sequence = [
        ("standard", base_prompt),
        ("polite", polite_prompt),
    ]
    if polite_first:
        prompt_sequence = [
            ("polite", polite_prompt),
            ("standard", base_prompt),
        ]

    last_error_payload: Optional[Dict[str, Any]] = None

    def _call_llm(content_with_prompt: List[Dict[str, Any]]) -> Optional[str]:
        nonlocal last_error_payload
        max_retries = 3
        for attempt in range(max_retries):
            try:
                if provider_name =="openai": # OpenAI
                    resp = client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=[
                            {"role": "system", "content": system_message},
                            {"role": "user", "content": content_with_prompt},
                        ],  # type: ignore
                        max_tokens=1500,
                        temperature=0.3,
                        response_format={"type": "json_object"},
                    )
                    result_content = resp.choices[0].message.content
                    finish_reason = resp.choices[0].finish_reason
                elif provider_name == "gemini": # Gemini
                        if not GEMINI_API_KEY:
                            last_error_payload= {
                                "reason": "gemini_key_missing",
                                "retryable": False,
                            }
                            return None
                        gemini_model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
                        gemini_model = genai.GenerativeModel(gemini_model_name)
                    
                    #Keep provider output contrtact idential(JSON) , so downstream flow is

                        prompt_text = ""
                        for item in content_with_prompt:
                            if isinstance(item, dict) and item.get("type")== "text":
                                prompt_text += str(item.get("text", "")) + "\n\n"
                            
                        gemini_parts = [system_message + "\n\n" + prompt_text]
                        for fr in sampled_frames:
                            try:
                                with Image.open(fr["image_path"]) as img:
                                    gemini_parts.append(img.convert("RGB").copy())
                            except Exception:
                                continue        
                            
                        gemini_resp = gemini_model.generate_content(
                            gemini_parts,
                            generation_config={
                                "temperature": 0.3,
                                "response_mime_type": "application/json",
                                },
                            )
                        result_content = getattr(gemini_resp, "text", None)
                        finish_reason = None
                else: # Claude
                    
                    # Check for Claude API key
                    if not ANTHROPIC_API_KEY:
                        last_error_payload = {
                            "reason": "anthropic key missing",
                            "retryable": False
                        }
                        return None
                    
                    claude_client = anthropic.Anthropic()
                    model_name = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

                    # Load Claude prompt
                    prompt_text = ""
                    for item in content_with_prompt:
                        if isinstance(item, dict) and item.get("type")== "text":
                            prompt_text += str(item.get("text", "")) + "\n\n"  

                    parts = [system_message + "\n\n" + prompt_text]

                    # Load frames
                    for frame in sampled_frames:
                        try:
                            parts.append({
                                    "type":"image",
                                    "source": {
                                        "type":"base64",
                                        "media_type":"image/jpeg",
                                        "data": encode_image_to_base64(frame["image_path"])
                                    }
                                })
                        except Exception:
                            continue
                    
                    # Get Claude response
                    resp = claude_client.messages.create(
                        model=model_name,
                        max_tokens=1024,
                        messages=[{"role": "user", "content": parts}]
                    )
                    print(resp)
                    if resp.content:
                        result_content= resp.content[0].text
                    else:
                        result_content = None
                    finish_reason = None
                    
                if finish_reason == "content_filter":
                    last_error_payload = {
                        "reason": "model_refusal",
                        "retryable": False,
                    }
                    return None

                if result_content:
                    try:
                        json.loads(result_content)
                        return result_content
                    except Exception:
                        last_error_payload= {
                            "reason": "invalid_json",
                            "retryable": True,
                            #Keeps logs/debug payload small and readable for team/UI.
                            "raw_preview": str(result_content)[:300],
                        }
                else:
                    last_error_payload = {
                        "reason": "empty_response",
                        "retryable": True,
                    }
            except Exception as e:
                if "rate_limit_exceeded" in str(e) and attempt < max_retries - 1:
                    wait_time = (2**attempt) + random.uniform(0, 1)
                    print(f"[QGEN ERROR] video={video_id} segment={start_time}-{end_time} err={e}")
                    time.sleep(wait_time)
                    last_error_payload = {
                        "reason": "rate_limit_exceeded",
                        "retryable": True,
                        "message": str(e),
                    }
                    continue

                print(f"[QGEN ERROR] video={video_id} segment={start_time}-{end_time} err={e}")
                last_error_payload = {
                    "reason": "openai_error",
                    "retryable": True,
                    "message": str(e),
                }
                return None

        return None

    tried_transcript_only = False

    for attempt_round, (prompt_label, prompt) in enumerate(prompt_sequence):
        content_with_prompt = [{"type": "text", "text": prompt}] + content

        result_content = _call_llm(content_with_prompt)
        if result_content:
            return result_content

        # If refusal or empty, fall back to transcript-only once.
        if (
            not tried_transcript_only
            and last_error_payload
            and last_error_payload.get("reason") in {"model_refusal", "empty_response"}
        ):
            tried_transcript_only = True
            transcript_only_prompt = (
                prompt
                + "\n\nIf visuals are unavailable, answer using the transcript only."
            )
            transcript_only_content = [{"type": "text", "text": transcript_only_prompt}]
            result_content = _call_llm(transcript_only_content)
            if result_content:
                return result_content

        # If first prompt failed, try second prompt
        if attempt_round == 0 and len(prompt_sequence) > 1:
            next_label = prompt_sequence[1][0]
            print(
                f"{prompt_label.capitalize()} prompt attempt failed for segment {start_time}-{end_time}s, trying {next_label} prompt next"
            )

    print(f"Both prompt attempts failed for segment {start_time}-{end_time}s")
    if last_error_payload is None:
        last_error_payload = {"reason": "generation_failed", "retryable": True}
    return json.dumps({"error": last_error_payload})


def generate_questions_for_segment_with_retry(
    video_id: str, start_time: int, end_time: int, max_attempts: int = 10, provider: Optional[str]= None
) -> Optional[str]:
    """
    Attempt to generate questions for a segment, retrying up to max_attempts times.
    Starts prioritizing the polite prompt from the third attempt onward and waits
    a random 1-3 seconds between consecutive attempts.
    """
    last_result: Optional[str] = None

    for attempt in range(1, max_attempts + 1):
        polite_first = attempt > 2
        if attempt > 1:
            print(
                f"Retrying segment {start_time}-{end_time}s (attempt {attempt}/{max_attempts})"
            )

        result_text = generate_questions_for_segment(
            video_id, start_time, end_time, polite_first=polite_first, provider=provider
        )
        if result_text:
            try:
                parsed = json.loads(result_text)
            except Exception:
                parsed = None
            if isinstance(parsed, dict) and "error" in parsed:
                retryable = bool(parsed.get("error", {}).get("retryable"))
                if not retryable:
                    return result_text
            else:
                return result_text

        last_result = result_text
        if attempt < max_attempts:
            wait_time = random.uniform(1, 3)
            print(
                f"Attempt {attempt} failed for segment {start_time}-{end_time}s; waiting {wait_time:.1f}s before retrying"
            )
            time.sleep(wait_time)

    print(
        f"All {max_attempts} attempts exhausted for segment {start_time}-{end_time}s without a successful generation"
    )
    return last_result


def build_segments_from_duration(
    duration_seconds: int, interval_seconds: int, start_offset: int = 0
) -> List[tuple]:
    """
    Build inclusive segments like (0, 60), (61, 120), ... until duration_seconds.
    """
    segments = []
    start = max(0, int(start_offset))
    step = max(1, int(interval_seconds))
    while start <= duration_seconds:
        end = min(start + step - 1, duration_seconds)
        segments.append((start, end))
        if end >= duration_seconds:
            break
        start = end + 1
    return segments

# -----------------------------
# WebSocket endpoint for streaming interval results
# -----------------------------
def _maybe_parse_json(text: Optional[str]):
    if text is None:
        return None
    if isinstance(text, (dict, list)):
        return text
    if not isinstance(text, str):
        return text
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned[3:].lstrip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()
    try:
        return json.loads(cleaned)
    except Exception:
        return text  # return raw text if not valid JSON


def persist_segment_questions_json(
    video_id: str, start: int, end: int, payload: Any
) -> Optional[str]:
    """Persist a single segment's questions JSON to disk and return a downloads URL."""
    if payload is None:
        return None

    if isinstance(payload, (dict, list)):
        data = payload
    elif isinstance(payload, str):
        try:
            data = json.loads(payload)
        except Exception:
            return None
    else:
        return None

    try:
        start_int = int(start)
    except Exception:
        start_int = None
    try:
        end_int = int(end)
    except Exception:
        end_int = None

    if start_int is not None and end_int is not None:
        filename = f"questions_{start_int:05d}-{end_int:05d}.json"
    else:
        filename = f"questions_{start}-{end}.json"

    questions_dir = DOWNLOADS_DIR / video_id / "questions"
    questions_dir.mkdir(parents=True, exist_ok=True)
    out_path = questions_dir / filename

    try:
        out_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except Exception as exc:
        print(f"Failed to write questions JSON for {video_id} {start}-{end}: {exc}")
        return None

    return f"/downloads/{out_path.relative_to(DOWNLOADS_DIR).as_posix()}"


def resolve_question_file_param(value: Optional[str]) -> Optional[Path]:
    if not value:
        return None
    cleaned = value.strip()
    if cleaned.startswith("/"):
        cleaned = cleaned.lstrip("/")
    if cleaned.startswith("downloads/"):
        cleaned = cleaned[len("downloads/") :]
    rel_path = Path(cleaned)
    if rel_path.is_absolute() or ".." in rel_path.parts:
        return None
    candidate = DOWNLOADS_DIR / rel_path
    if candidate.is_file() and candidate.suffix.lower() == ".json":
        try:
            candidate.relative_to(DOWNLOADS_DIR)
        except ValueError:
            return None
        return candidate
    return None


def generate_persona_variants(
    questions: Dict[str, Any], best_question_text: Optional[str] = None
) -> Dict[str, Any]:
    """
    Take AI questions {type: {q, a, ...}} and rephrase them into 3 child-friendly
    personas: bunny (warm/gentle), alligator (blunt/direct), pig (excited).
    Returns {"success": bool, "variants": {bunny: {type: {q, a}}, ...}}.
    """
    if not questions or not isinstance(questions, dict):
        return {"success": False, "message": "No questions provided"}

    questions_text = "\n".join(
        f"- Type: {qtype.upper()}, Question: {data.get('q', '')}, Answer: {data.get('a', '')}"
        for qtype, data in questions.items()
        if isinstance(data, dict) and data.get("q")
    )
    if not questions_text.strip():
        return {"success": False, "message": "No valid questions to rephrase"}

    prompt = (
        "You are helping rephrase reading comprehension questions for young children "
        "into 3 different character personas. Keep the meaning and correct answers "
        "exactly the same — only change the wording/tone of the QUESTIONS.\n\n"
        "PERSONAS:\n"
        "- bunny: Warm, gentle, nurturing. Uses 'dear friend' or 'sweetie'. Asks with soft openers "
        "like 'Can you remember...?' or 'Do you know...?'. Max 12 words. Always feels cozy and caring.\n"
        "- alligator: Blunt, direct, zero fluff. Max 8 words. Imperative style. No greetings or filler. "
        "One idea per sentence. Example style: 'Who is the hero? Answer.'\n"
        "- pig: Wildly enthusiastic! Starts with 'Ooh!' or 'Wow!'. Uses CAPS on 1-2 key words. "
        "Repeats phrases for excitement like 'tell me tell me!'. Always ends with '?!'\n\n"
        f"Original questions:\n{questions_text}\n\n"
        "Return ONLY a valid JSON object with this exact structure:\n"
        "{\n"
        '  "bunny": {"TYPE": {"q": "rephrased question", "a": "same original answer"}, ...},\n'
        '  "alligator": {"TYPE": {"q": "rephrased question", "a": "same original answer"}, ...},\n'
        '  "pig": {"TYPE": {"q": "rephrased question", "a": "same original answer"}, ...}\n'
        "}\n"
        "Use lowercase keys for question types. Return only the JSON, no explanation."
    )

    try:
        response = OPENAI_CLIENT.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.choices[0].message.content.strip() if response.choices else ""
        parsed = _maybe_parse_json(text)
        if not isinstance(parsed, dict):
            return {"success": False, "message": "Invalid AI response format"}

        # Mark the best question in each persona variant
        if best_question_text:
            for persona_key, persona_qs in parsed.items():
                if not isinstance(persona_qs, dict):
                    continue
                for qtype, data in persona_qs.items():
                    if not isinstance(data, dict):
                        continue
                    orig = questions.get(qtype)
                    if isinstance(orig, dict) and orig.get("q") == best_question_text:
                        data["is_best"] = True

        return {"success": True, "variants": parsed}
    except Exception as exc:
        return {"success": False, "message": f"Persona generation failed: {exc}"}

