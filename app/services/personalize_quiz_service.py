import anthropic
import json
import os
from typing import Dict, Any, Optional

from anthropic.types import MessageParam
from app.settings import ANTHROPIC_API_KEY

# Claude parameters
model = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
MAX_TOKENS = 1024
#creates the client object that connects to Claude API
client = anthropic.Anthropic()

def generate_persona_variants(questions: Dict[str, Any], best_question_text: Optional[str] = None
) -> Dict[str, Any]:
    """
    Take AI questions {type: {q, a, ...}} and rephrase them into 3 child-friendly
    personas: pig (friend), bunny (older sibling), alligator (parent/grandparent).
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

    # Check for Claude API key
    if not ANTHROPIC_API_KEY:
        return {"success": False, "message":f"Anthropic key missing."}
                    
    system_message = (
        "You are a safe, child-focused educational assistant. "
        "The content is a children's video. "
        "Follow all safety policies and avoid disallowed content. "
        "Provide age-appropriate, neutral, factual responses only."
    )

    # Load prompt
    prompt_text = ("""
        You are helping rephrase comprehension questions for young children
        into different personas. Keep the meaning and correct answers exactly
        the same. Only change the wording and tone of the QUESTIONS.\n\n
        PERSONAS:\n\n
        PIGGY: 
            A friendly, encouraging personality meant to emulate a childhood friend.
            Uses easy-to-understand language for children, but does not 'dumb down' the
            question. Instead, uses enthusiastic words and expressions such as 'Ooh!' 
            or 'Wow!' to show mutual investment in the content.\n
        BUNNY:
            A cool, inspiring personality meant to act as an older sibling.
            Uses comprehensible wording for children, but might add slightly advanced 
            vocabulary to keep the child sharp. Uses acknowledgement as a motivator by
            using phrases that indicate belief in the child.\n
        ALLIGATOR:
            A gentle, endearing personality designed for sensitive children and modeled after 
            a parent or grandparent. Avoids using pet names, however. Uses vocabulary that caters towards children with 
            weaker vocabularies. Uses pride in the child to invite them to answer questions.\n
        """ 
        +
        f"Original questions:\n{questions_text}\n\n"
        +
        """
        Return ONLY a valid JSON object with this exact structure:\n
        {\n
            "pig": {"TYPE": {"q": "rephrased question", "a": "same original answer"}, ...},\n
            "bunny": {"TYPE": {"q": "rephrased question", "a": "same original answer"}, ...},\n
            "alligator": {"TYPE": {"q": "rephrased question", "a": "same original answer"}, ...},\n
        }\n
        Use lowercase keys for question types. Return only the JSON, no explanation.
        """
    )

    # Build parts
    parts = [
        {
            "role":"user",
            "content":[
                {"type":"text", "text": prompt_text.strip()}
            ]
        }
    ]

    # Get response
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=3000,
            system=system_message,
            messages=parts
        )
        
        if resp.content:
            text = resp.content[0].text
        else:
            return {"success": False, "message": "Empty response"}

        # Strip markdown fences Claude may wrap around JSON
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned[3:].lstrip()
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].lstrip()
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3].rstrip()

        # Parse the JSON string into a dict
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            return {"success": False, "message": f"Invalid JSON from Claude: {cleaned[:300]}"}

        
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
        
        return {"success":True, "variants":parsed}
    except Exception as exc:
        return {"success": False, "message":f"Persona generation failed: {exc}"}
    #  

