import os
from functools import lru_cache

import google.generativeai as genai
from openai import OpenAI
import anthropic

from app.settings import GEMINI_API_KEY
from app.settings import ANTHROPIC_API_KEY


@lru_cache(maxsize=1)
def get_openai_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or not api_key.strip():
        raise RuntimeError("Missing OPENAI_API_KEY in environment (.env / .env.txt).")
    return OpenAI(api_key=api_key)

OPENAI_CLIENT = get_openai_client()

@lru_cache(maxsize=1)
def get_anthropic_client() -> anthropic.Anthropic:
    if not ANTHROPIC_API_KEY or not ANTHROPIC_API_KEY.strip():
        raise RuntimeError("Missing ANTHROPIC_API_KEY in environment.")
    return anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

ANTHROPIC_CLIENT = get_anthropic_client()

@lru_cache(maxsize=1)
def get_gemini_configured() -> bool:
    if not GEMINI_API_KEY or not GEMINI_API_KEY.strip():
        raise RuntimeError("Missing GEMINI_API_KEY in environment.")
    genai.configure(api_key=GEMINI_API_KEY)
    return True

get_gemini_configured()

