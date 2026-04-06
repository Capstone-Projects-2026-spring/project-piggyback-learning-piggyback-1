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
        raise RuntimeError("OPENAI_API_KEY is not set. Add it to your .env file to use question generation.")
    return OpenAI(api_key=api_key)


@lru_cache(maxsize=1)
def get_anthropic_client() -> anthropic.Anthropic:
    if not ANTHROPIC_API_KEY or not ANTHROPIC_API_KEY.strip():
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")
    return anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


@lru_cache(maxsize=1)
def get_gemini_configured() -> bool:
    if not GEMINI_API_KEY or not GEMINI_API_KEY.strip():
        raise RuntimeError("GEMINI_API_KEY is not set.")
    genai.configure(api_key=GEMINI_API_KEY)
    return True
