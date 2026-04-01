# config.py

GRADING_CONFIG = {
    # RapidFuzz thresholds
    "rapidfuzz_correct": 0.75,  # >= this → auto correct
    "rapidfuzz_wrong": 0.45,     # <= this → auto wrong

    # OpenAI settings
    "use_ai": True,              # turn hybrid AI on/off
    "ai_model": "gpt-4o-mini",   # default: fast + cheap
    "ai_temperature": 0.0,       # deterministic grading
    "ai_max_tokens": 50,         # we only need one word
    "ai_timeout": 3.0            # seconds before fallback
}