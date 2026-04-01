from datetime import datetime
import io
import json
import os
import re
from fastapi import APIRouter, Body, UploadFile, File
from config import GRADING_CONFIG
from rapidfuzz import fuzz
from typing import cast, Any, Dict
from functools import lru_cache
from app.settings import BASE_DIR, DOWNLOADS_DIR
from app.services.clients import OPENAI_CLIENT, get_openai_client
from app.services.quiz_scoring_service import save_quiz_result, get_child_scores


router_video_quiz = APIRouter()

# Separate router for API endpoints shared with main app
router_api = APIRouter()


# Put these two helpers near the top of the file (once):
def _parse_duration_to_seconds(val) -> int | None:
    """Accept int/float seconds or 'HH:MM:SS'/'MM:SS' strings and return seconds."""
    if val is None:
        return None
    # numeric
    if isinstance(val, (int, float)):
        try:
            return max(0, int(float(val)))
        except Exception:
            return None
    # string
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        # try hh:mm:ss or mm:ss
        parts = val.split(":")
        try:
            parts = [int(p) for p in parts]
        except Exception:
            # maybe it's a numeric string
            try:
                return max(0, int(float(val)))
            except Exception:
                return None
        if len(parts) == 3:
            h, m, s = parts
            return max(0, h * 3600 + m * 60 + s)
        if len(parts) == 2:
            m, s = parts
            return max(0, m * 60 + s)
        if len(parts) == 1:
            return max(0, int(parts[0]))
    return None


def _format_mmss(sec: int | None) -> str:
    if not sec or sec < 0:
        return "00:00"
    m, s = divmod(int(sec), 60)
    return f"{m:02d}:{s:02d}"


# ============================================================
# Kids library discovery (reimplementation matches your behavior)
# ============================================================
def refresh_kids_videos_json():
    """
    Scan downloads/ and rebuild static/kids_videos.json.
    Reads title/thumbnail/duration from meta.json or fallback files.
    """
    results = []
    if not DOWNLOADS_DIR.exists():
        return results

    for item in sorted(DOWNLOADS_DIR.iterdir()):
        if not item.is_dir():
            continue
        vid = item.name

        # --- Find video file ---
        video_file = None
        for ext in (".mp4", ".webm", ".mkv", ".mov"):
            for cand in item.glob(f"*{ext}"):
                video_file = cand
                break
            if video_file:
                break
        if not video_file:
            continue

        # --- Metadata ---
        title = vid
        duration = None
        thumb_url = None
        meta_json = item / "meta.json"
        info_json = item / f"{vid}.info.json"

        meta_source = None
        if meta_json.exists():
            meta_source = meta_json
        elif info_json.exists():
            meta_source = info_json

        if meta_source:
            try:
                meta = json.loads(meta_source.read_text(encoding="utf-8"))
                title = meta.get("title") or title
                duration = meta.get("duration") or meta.get("duration_string")
                thumb_url = meta.get("thumbnail")
            except Exception:
                pass

        # --- Thumbnail fallback ---
        if not thumb_url:
            for ext in (".jpg", ".jpeg", ".png", ".webp"):
                thumb_file = next(item.glob(f"*{ext}"), None)
                if thumb_file:
                    thumb_url = f"/downloads/{vid}/{thumb_file.name}"
                    break

        # --- Fallback to first extracted frame ---
        if not thumb_url:
            frames_dir = item / "extracted_frames"
            first_frame = next(frames_dir.glob("frame_0001s.jpg"), None)
            if first_frame:
                thumb_url = f"/downloads/{vid}/extracted_frames/{first_frame.name}"

        thumb_url = thumb_url or "/static/default-unlock.png"

        # --- Duration (meta/info OR extracted_frames/frame_data.json) ---
        dur_sec = None

        # 1) meta.json or <id>.info.json
        if meta_source:
            try:
                meta = json.loads(meta_source.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
            title = meta.get("title") or title
            # these keys commonly exist in yt-dlp info
            for k in ("duration", "duration_string", "approx_duration_ms"):
                if k in meta:
                    cand = meta[k]
                    if k == "approx_duration_ms":
                        try:
                            cand = float(cand) / 1000.0
                        except Exception:
                            cand = None
                    dur_sec = _parse_duration_to_seconds(cand)
                    if dur_sec:
                        break

        # 2) fallback to extracted_frames/frame_data.json (correct path)
        if dur_sec is None:
            frame_json = item / "extracted_frames" / "frame_data.json"
            if frame_json.exists():
                try:
                    fd = json.loads(frame_json.read_text(encoding="utf-8"))
                    raw = fd.get("video_info", {}).get("duration_seconds", 0)
                    dur_sec = _parse_duration_to_seconds(raw) or 0
                except Exception:
                    dur_sec = 0

        duration = _format_mmss(dur_sec)

        results.append(
            {
                "video_id": vid,
                "title": title,
                "duration": duration,
                "local_path": f"/downloads/{vid}/{video_file.name}",
                "thumbnail": thumb_url,
            }
        )

    # Write the JSON file for caching
    out_path = BASE_DIR / "static" / "kids_videos.json"
    os.makedirs(out_path.parent, exist_ok=True)
    out_path.write_text(json.dumps({"videos": results}, indent=2), encoding="utf-8")

    return results


# ============================================================
# Kids: library & page routes
# ============================================================
@router_video_quiz.get("/kids_videos")
def list_kids_videos():
    """Return JSON of all locally available kids videos"""
    videos = refresh_kids_videos_json()
    return {"success": True, "count": len(videos), "videos": videos}


@router_api.get("/final-questions/{video_id}")
def get_final_questions(video_id: str, companion: str = None):
    """
    Loads final_questions.json for the given video_id.
    Returns the best LLM-ranked question per segment (lowest llm_ranking)
    that is not trashed. If trashed=True, skip to the next question.
    If companion is provided (pig/rabbit/alligator), returns persona-rephrased questions
    from persona_variants.json when available.
    """
    path = DOWNLOADS_DIR / video_id / "final_questions" / "final_questions.json"
    if not path.exists():
        return {"success": False, "error": "final_questions.json not found"}

    data = json.loads(path.read_text(encoding="utf-8"))
    segments = data.get("segments", [])
    selected_segments = []

    # Load persona variants if a companion was selected
    COMPANION_TO_PERSONA = {"rabbit": "bunny", "pig": "pig", "alligator": "alligator"}
    companion_persona = COMPANION_TO_PERSONA.get(companion or "")
    persona_segments = {}
    if companion_persona:
        pv_path = DOWNLOADS_DIR / video_id / "persona_variants" / "persona_variants.json"
        if pv_path.exists():
            pv_data = json.loads(pv_path.read_text(encoding="utf-8"))
            persona_segments = pv_data.get("segments", {})

    def _llm_sort_key(question: Dict[str, Any]) -> int:
        rank = question.get("llm_ranking")
        try:
            return int(rank)
        except (TypeError, ValueError):
            return 999

    for seg in segments:
        ai_qs = seg.get("aiQuestions", [])
        seg_start = float(seg.get("start") or 0)
        seg_end = float(seg.get("end") or 0)

        question_text = None
        answer_text = None
        question_type = None
        llm_ranking = None
        expert_ranking = None

        if ai_qs:
            # Sort by expert_ranking first, fall back to llm_ranking
            sorted_qs = sorted(ai_qs, key=lambda q: (
                _llm_sort_key({"llm_ranking": q.get("expert_ranking")}),
                _llm_sort_key(q)
            ))
            chosen_q = next((q for q in sorted_qs if not q.get("trashed", False)), None)
            if chosen_q:
                question_text = chosen_q.get("question") or chosen_q.get("originalQuestion")
                answer_text = chosen_q.get("answer") or chosen_q.get("originalAnswer")
                question_type = chosen_q.get("type")
                llm_ranking = chosen_q.get("llm_ranking")
                expert_ranking = chosen_q.get("expert_ranking")

        # If no aiQuestions, fall back to persona_variants stored in the segment itself
        if not question_text:
            seg_variants = seg.get("persona_variants", {})
            persona_to_try = companion_persona or "bunny"
            persona_qs = seg_variants.get(persona_to_try) or seg_variants.get("bunny") or seg_variants.get("pig") or seg_variants.get("alligator")
            if persona_qs:
                # Pick first available question type
                PREFERRED_TYPES = ["character", "action", "feeling", "causal", "setting", "outcome", "prediction"]
                for qt in PREFERRED_TYPES:
                    q_data = persona_qs.get(qt, {})
                    if q_data.get("q"):
                        question_text = q_data["q"]
                        answer_text = q_data.get("a", "")
                        question_type = qt
                        break

        if not question_text:
            continue

        # Try to substitute companion-specific persona variant question
        if companion_persona and persona_segments:
            for seg_key, seg_data in persona_segments.items():
                parts = seg_key.split("-")
                if len(parts) == 2:
                    try:
                        if abs(float(parts[0]) - seg_start) < 0.5 and abs(float(parts[1]) - seg_end) < 0.5:
                            variants = seg_data.get("persona_variants", {})
                            winners = seg_data.get("persona_winners", {})
                            winner_type = winners.get(companion_persona)
                            if winner_type and companion_persona in variants:
                                q_data = variants[companion_persona].get(winner_type, {})
                                if q_data.get("q"):
                                    question_text = q_data["q"]
                                    answer_text = q_data.get("a", answer_text)
                            break
                    except (ValueError, TypeError):
                        continue

        selected_segments.append({
            "segment_range_start": seg.get("start"),
            "segment_range_end": seg.get("end"),
            "question": question_text,
            "answer": answer_text,
            "question_type": question_type,
            "llm_ranking": llm_ranking,
            "expert_ranking": expert_ranking,
        })

    return {"success": True, "segments": selected_segments}

# ============================================================
# Answer-checker helpers (moved verbatim from your main.py)
# ============================================================
NUM_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
}
SCALE_WORDS = {"hundred": 100, "thousand": 1000, "million": 1_000_000}

STOPWORDS = {
    "the",
    "a",
    "an",
    "is",
    "are",
    "and",
    "of",
    "to",
    "it",
    "in",
    "on",
    "at",
    "for",
    "was",
    "were",
    "be",
    "being",
    "been",
    "am",
    "do",
    "did",
    "does",
    "done",
    "they",
    "them",
    "their",
    "there",
    "here",
    "that",
    "this",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "we",
    "me",
    "my",
    "your",
    "his",
    "her",
    "our",
    "ours",
    "with",
    "by",
    "from",
}
FILLER_WORDS = {"um", "uh", "like", "you know", "hmm", "well", "okay", "so"}

SYNONYMS = {
    # Feelings
    "scared": "afraid",
    "frightened": "afraid",
    "fearful": "afraid",
    "nervous": "afraid",
    "worried": "afraid",
    "sad": "unhappy",
    "crying": "unhappy",
    "mad": "angry",
    "upset": "angry",
    "annoyed": "angry",
    "happy": "happy",
    "glad": "happy",
    "joyful": "happy",
    "excited": "happy",
    "fun": "happy",
    "laughing": "happy",
    "smiling": "happy",
    # Family
    "mom": "mother",
    "mommy": "mother",
    "dad": "father",
    "daddy": "father",
    "grandma": "grandmother",
    "grandpa": "grandfather",
    "bro": "brother",
    "sis": "sister",
    "sissy": "sister",
    # Animals
    "puppy": "dog",
    "puppies": "dog",
    "kitten": "cat",
    "kitties": "cat",
    "bunny": "rabbit",
    "hare": "rabbit",
    "pony": "horse",
    # Food
    "soda": "drink",
    "juice": "drink",
    "milk": "drink",
    "water": "drink",
    "snack": "food",
    "meal": "food",
    "candy": "sweet",
    "sweets": "sweet",
    "chocolate": "sweet",
    "cookie": "sweet",
    "icecream": "sweet",
    "ice cream": "sweet",
    "cake": "sweet",
    "pie": "sweet",
    # Everyday objects
    "automobile": "car",
    "truck": "car",
    "bus": "car",
    "bike": "bicycle",
    "tv": "television",
    "show": "movie",
    "cartoon": "movie",
    "film": "movie",
    # Size
    "large": "big",
    "huge": "big",
    "giant": "big",
    "enormous": "big",
    "little": "small",
    "tiny": "small",
    "short": "small",
    # Speed
    "quick": "fast",
    "speedy": "fast",
    # Yes/No
    "yeah": "yes",
    "yep": "yes",
    "yup": "yes",
    "nope": "no",
    "nah": "no",
}


# ============================================================
# Helpers
# ============================================================
def words_to_numbers(text: str) -> list[int]:
    """Extract numbers (digits or words) from text."""
    text = text.lower().strip()
    numbers = [int(d) for d in re.findall(r"\d+", text)]

    tokens = re.split(r"[-\s]+", text)
    total, current, found_number = 0, 0, False

    for token in tokens + ["end"]:
        if token in NUM_WORDS:
            found_number = True
            current += NUM_WORDS[token]
        elif token in SCALE_WORDS:
            found_number = True
            scale = SCALE_WORDS[token]
            if current == 0:
                current = 1
            current *= scale
            if scale > 100:
                total += current
                current = 0
        else:
            if found_number:
                total += current
                numbers.append(total)
                total, current, found_number = 0, 0, False

    return numbers


def normalize_text(text: str) -> str:
    """Clean text: lowercase, strip fillers/stopwords, map synonyms."""
    tokens = re.findall(r"[a-z]+", text.lower())
    normalized = []
    for t in tokens:
        if t in STOPWORDS or t in FILLER_WORDS or t in NUM_WORDS or t in SCALE_WORDS:
            continue
        normalized.append(SYNONYMS.get(t, t))
    return " ".join(normalized)


@lru_cache(maxsize=2048)
def prepare_text_for_scoring(text: str) -> str:
    """
    Cached normalizer that also appends numeric hints so answers like "three dogs"
    match "3 dogs" without re-tokenizing every time.
    """
    if not text:
        return ""
    normalized = normalize_text(text)
    number_tokens = words_to_numbers(text)
    if number_tokens:
        unique_numbers = " ".join(str(n) for n in sorted(set(number_tokens)))
        combined = f"{normalized} {unique_numbers}".strip()
        return combined
    return normalized


def keyword_overlap(expected: str, user: str) -> float:
    exp_words = set(expected.split())
    usr_words = set(user.split())
    return len(exp_words & usr_words) / max(1, len(exp_words))


def simplify_item(item: str) -> str:
    item = item.strip()
    m = re.search(r"\bcalled\s+(.+)", item)
    if m:
        item = m.group(1)
    norm = normalize_text(item)
    toks = norm.split()
    if len(toks) > 3:
        norm = " ".join(toks[-3:])
    return norm


def extract_items(expected_raw: str) -> list[str]:
    # Only treat as a list if there's a comma, or "and" appears after a comma
    # (e.g. "red, blue, and green"). Bare "and" without a comma is part of a phrase.
    if "," not in expected_raw:
        return []
    parts = [
        p
        for p in re.split(r",|\sand\s", expected_raw, flags=re.IGNORECASE)
        if p.strip()
    ]
    return [simplify_item(p) for p in parts if simplify_item(p)]


def list_match(expected_raw: str, user_raw: str) -> tuple[int, int, list[str]]:
    items = extract_items(expected_raw)
    user_norm = normalize_text(user_raw)

    matched = set()
    for item in items:
        score = max(
            fuzz.partial_ratio(item, user_norm), fuzz.token_set_ratio(item, user_norm)
        )
        if score >= 60:
            matched.add(item)
    return len(matched), len(items), list(matched)


def required_items_from_question(question: str, expected: str) -> int:
    total_expected = len([p for p in re.split(r",|and", expected) if p.strip()])
    if not question:
        return total_expected
    num_map = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
    for word, val in num_map.items():
        if word in question.lower():
            return min(val, total_expected)
    return total_expected


# ============================================================
# POST /api/check_answer (moved verbatim; decorator adjusted)
# ============================================================
@router_api.post(
    "/api/check_answer".replace("/api", "")
)  # keep original route path under /api prefix
async def check_answer(payload: dict = Body(...)):
    expected = cast(str, payload.get("expected") or "").strip().lower()
    user = cast(str, payload.get("user") or "").strip().lower()
    question = cast(str, payload.get("question") or "").strip().lower()

    expected_numbers = words_to_numbers(expected)
    user_numbers = words_to_numbers(user)
    is_numeric = bool(expected_numbers)
    numeric_question = bool(
        re.search(r"\bhow many\b|\bnumber of\b|\bhow much\b|\bcount\b", question)
    )
    expected_text = normalize_text(expected)

    print(
        f"🔎 Checking answers | Q='{question}' | Expected='{expected}' | User='{user}'"
    )

    if not expected or not user:
        return {
            "similarity": 0.0,
            "expected": expected,
            "user": user,
            "is_numeric": is_numeric,
            "status": "wrong",
            "reason": "Empty input",
        }

    if expected_numbers:
        expected_set = set(expected_numbers)
        user_set = set(user_numbers)
        if user_numbers and not (expected_set & user_set):
            return {
                "similarity": 0.0,
                "expected": expected,
                "user": user,
                "is_numeric": True,
                "status": "wrong",
                "reason": "Numeric mismatch",
            }
        if user_numbers and not expected_text and expected_set == user_set:
            return {
                "similarity": 1.0,
                "expected": expected,
                "user": user,
                "is_numeric": True,
                "status": "correct",
                "reason": "Numeric answer matched",
            }
        if not user_numbers and (not expected_text or numeric_question):
            return {
                "similarity": 0.0,
                "expected": expected,
                "user": user,
                "is_numeric": True,
                "status": "wrong",
                "reason": "Missing numeric answer",
            }

    # --- Quick RapidFuzz similarity ---
    exp_clean = prepare_text_for_scoring(expected)
    usr_clean = prepare_text_for_scoring(user)

    pr = fuzz.partial_ratio(exp_clean, usr_clean) / 100.0
    tsr = fuzz.token_set_ratio(exp_clean, usr_clean) / 100.0
    score = max(pr, tsr)

    items = extract_items(expected)
    if len(items) > 1:
        matched_count, total_count, _matched_items = list_match(expected, user)
        required = required_items_from_question(question, expected)
        if total_count > 0:
            if matched_count >= required:
                return {
                    "similarity": round(score, 3),
                    "expected": expected,
                    "user": user,
                    "is_numeric": is_numeric,
                    "status": "correct",
                    "reason": f"Matched {matched_count} of {total_count} items (need {required})",
                }
            if matched_count > 0:
                return {
                    "similarity": round(score, 3),
                    "expected": expected,
                    "user": user,
                    "is_numeric": is_numeric,
                    "status": "almost",
                    "reason": f"Matched {matched_count} of {total_count} items",
                }

    print(f"  RapidFuzz → pr={pr:.3f}, tsr={tsr:.3f}, final={score:.3f}")

    if score >= GRADING_CONFIG["rapidfuzz_correct"]:
        return {
            "similarity": round(score, 3),
            "expected": expected,
            "user": user,
            "is_numeric": is_numeric,
            "status": "correct",
            "reason": f"High RapidFuzz score {score:.2f}",
        }

    if score <= GRADING_CONFIG["rapidfuzz_wrong"]:
        return {
            "similarity": round(score, 3),
            "expected": expected,
            "user": user,
            "is_numeric": is_numeric,
            "status": "wrong",
            "reason": f"Low RapidFuzz score {score:.2f}",
        }

    # --- Borderline → escalate to AI ---
    if GRADING_CONFIG["use_ai"]:
        try:
            client = OPENAI_CLIENT
            resp = client.chat.completions.create(
                model=GRADING_CONFIG["ai_model"],
                temperature=GRADING_CONFIG["ai_temperature"],
                max_tokens=GRADING_CONFIG["ai_max_tokens"],
                messages=[
                    {
                        "role": "system",
                        "content": "You are a friendly teacher grading a child's comprehension. Be lenient if the child expresses the same idea using different words or more specific examples. Respond with only one word: correct, almost, or wrong.",
                    },
                    {
                        "role": "user",
                        "content": f"Question: {question}\nExpected answer: {expected}\nChild's answer: {user}",
                    },
                ],
                timeout=GRADING_CONFIG["ai_timeout"],
            )
            ai_label = resp.choices[0].message.content.strip().lower()  # type: ignore
            if ai_label not in ["correct", "almost", "wrong"]:
                ai_label = "almost"  # default fallback
            return {
                "similarity": round(score, 3),
                "expected": expected,
                "user": user,
                "is_numeric": is_numeric,
                "status": ai_label,
                "reason": f"AI judged borderline case (RapidFuzz={score:.2f})",
            }
        except Exception as e:
            print("⚠️ AI call failed:", e)

    # --- Fallback if AI off or failed ---
    return {
        "similarity": round(score, 3),
        "expected": expected,
        "user": user,
        "is_numeric": is_numeric,
        "status": "almost",
        "reason": f"Borderline case defaulted (RapidFuzz={score:.2f})",
    }

def log_speech(text:str):
    log_path = "speech_log.txt"
    entry = {"timestamp": datetime.now().isoformat(), "text": text}
    if os.path.exists(log_path):
        with open(log_path, "r") as f:
            data = json.load(f)
    else:
        data = []

    data.append(entry)
    with open(log_path, "w") as f:
        json.dump(data, f, indent=2)

# ============================================================
# Whisper transcription (moved verbatim; decorator adjusted)
# ============================================================
@router_api.post("/api/transcribe".replace("/api", ""))
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Accepts audio (webm, wav, mp3, etc), sends to Whisper,
    no temp file saved (in-memory BytesIO).
    """
    try:
        contents = await file.read()
        audio_bytes = io.BytesIO(contents)
        client = get_openai_client()
        transcription = client.audio.transcriptions.create(
            model="whisper-1",
            file=("speech.webm", audio_bytes, file.content_type),
        )
        print("Whisper raw response:", transcription)
        log_speech(transcription.text)
        return {"success": True, "text": transcription.text}
    except Exception as e:
        print("❌ Whisper transcription error:", e)
        return {"success": False, "error": str(e)}
    log_speech()


# ============================================================
# Frontend config (skip prevention + thresholds)
# ============================================================
@router_api.get("/config")
async def get_config():
    # Single source of truth for frontend
    return {"skip_prevention": False, "thresholds": GRADING_CONFIG}

# Save quiz score and store results in downloads/quiz_results/

@router_api.post("/save-quiz-score")
async def api_save_quiz_score(payload: dict = Body(...)):
    """
    Save quiz score when child finishes video
    Implements PIGGY1-26: Scoring and tracking
    """
    child_id = payload.get("child_id")
    video_id = payload.get("video_id")
    score_data = payload.get("score_data", {})
    
    if not child_id or not video_id:
        return {"success": False, "message": "Missing child_id or video_id"}
    
    result = save_quiz_result(child_id, video_id, score_data)
    return result


@router_api.get("/get-quiz-scores/{child_id}")

def api_get_quiz_scores(child_id: str):
    """
    Get all quiz scores for a child
    Used for viewing score history
    """
    result = get_child_scores(child_id)
    return result
