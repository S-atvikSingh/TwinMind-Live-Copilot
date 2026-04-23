import json
import logging

import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq, AuthenticationError, RateLimitError

logger = logging.getLogger(__name__)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
ALLOWED_SUGGESTION_TYPES = {"ask_question", "talking_point", "answer", "fact_check", "clarify"}


def _parse_json_suggestions(content: str):
    """Parse model JSON into at most three normalized suggestion objects."""
    payload = json.loads(content)
    suggestions = payload.get("suggestions", [])
    if not isinstance(suggestions, list):
        raise ValueError("Model output does not contain a valid suggestions list.")

    normalized = []
    for item in suggestions:
        if not isinstance(item, dict):
            continue
        suggestion_type = str(item.get("type", "talking_point")).strip().lower()[:40] or "talking_point"
        if suggestion_type not in ALLOWED_SUGGESTION_TYPES:
            suggestion_type = "talking_point"
        title = str(item.get("title", "")).strip()[:140]
        preview = str(item.get("preview", "")).strip()[:400]
        reason = str(item.get("reason", "")).strip()[:240]
        if not title or not preview:
            continue
        normalized.append(
            {
                "type": suggestion_type,
                "title": title,
                "preview": preview,
                "reason": reason,
            }
        )

    # Enforce exactly 3 suggestions for UI consistency and assignment compliance.
    return normalized[:3]


def _validate_suggestion_quality(suggestions):
    if len(suggestions) != 3:
        raise HTTPException(status_code=422, detail="Model did not return exactly 3 suggestions.")

    type_count = len({s["type"] for s in suggestions})
    if type_count < 2:
        raise HTTPException(status_code=422, detail="Suggestion types are not diverse enough.")

    title_count = len({s["title"].lower() for s in suggestions})
    if title_count != 3:
        raise HTTPException(status_code=422, detail="Suggestion titles are duplicated.")

@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...), key: str = Form(...)):
    try:
        client = Groq(api_key=key)
        audio_bytes = await audio.read()
        transcription = client.audio.transcriptions.create(
            file=("audio.webm", audio_bytes),
            model="whisper-large-v3",
            response_format="json"
        )
        return {"ok": True, "data": {"text": transcription.text}}
    except AuthenticationError:
        if not key or key == "undefined":
            raise HTTPException(status_code=400, detail="API Key missing.")
        raise HTTPException(status_code=401, detail="Invalid Groq API Key.")
    except RateLimitError:
        raise HTTPException(status_code=429, detail="Groq rate limit reached.")
    except Exception:
        logger.exception("transcribe failed")
        raise HTTPException(status_code=500, detail="Transcription service unavailable.")

@app.post("/suggest")
async def suggest(transcript: str = Form(...), prompt: str = Form(...), key: str = Form(...), sugg_context: str = Form(...)):
    try:
        client = Groq(api_key=key)
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Recent transcript: {transcript} Context: {sugg_context}"}
            ],
            response_format={"type": "json_object"}
        )
        content = response.choices[0].message.content
        suggestions = _parse_json_suggestions(content)
        _validate_suggestion_quality(suggestions)
        return {"ok": True, "data": {"suggestions": suggestions}}
    except AuthenticationError:
        if not key or key == "undefined":
            raise HTTPException(status_code=400, detail="API Key missing.")
        raise HTTPException(status_code=401, detail="Invalid Groq API Key.")
    except RateLimitError:
        raise HTTPException(status_code=429, detail="Groq rate limit reached.")
    except Exception:
        logger.exception("suggest failed")
        raise HTTPException(status_code=500, detail="Suggestion service unavailable.")

@app.post("/chat")
async def chat(question: str = Form(...), chat_context: str = Form(...), transcript: str = Form(...), prompt: str = Form(...), key: str = Form(...)):
    try:
        client = Groq(api_key=key)
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Recent transcript: {transcript}\n Context: {chat_context}\nQuestion: {question}"}
            ]
        )
        answer = response.choices[0].message.content
        return {"ok": True, "data": {"answer": answer}}
    except AuthenticationError:
        if not key or key == "undefined":
            raise HTTPException(status_code=400, detail="API Key missing.")
        raise HTTPException(status_code=401, detail="Invalid Groq API Key.")
    except RateLimitError:
        raise HTTPException(status_code=429, detail="Groq rate limit reached.")
    except Exception:
        logger.exception("chat failed")
        raise HTTPException(status_code=500, detail="Chat service unavailable.")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)