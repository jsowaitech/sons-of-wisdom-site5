# server/app.py
# Simple Flask backend for Son of Wisdom (OpenAI only)

import os
from typing import Any, Dict, List

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables from server/.env
load_dotenv()

# ---- OpenAI client (public API) ----
try:
    from openai import OpenAI
except Exception as e:
    raise RuntimeError(
        "Please install the 'openai' package (see requirements.txt)."
    ) from e

def make_client_and_model():
    """
    Create OpenAI client + model name from env.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Add it to server/.env or your shell."
        )

    # default to gpt-4o-mini if OPENAI_MODEL not provided
    model = os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"
    client = OpenAI(api_key=api_key)
    return client, model

client, MODEL = make_client_and_model()

# ---- Flask app ----
app = Flask(__name__)
CORS(app)  # allow localhost browser requests during dev

@app.get("/api/health")
def health():
    return jsonify({"ok": True, "model": MODEL})

@app.post("/api/chat")
def chat():
    """
    Body: { "text": "<user message>", "context": {...optional metadata...} }
    Returns: { "reply": "<assistant text>" }
    """
    data: Dict[str, Any] = request.get_json(silent=True) or {}
    user_text = (data.get("text") or "").strip()

    if not user_text:
        return jsonify({"error": "Missing 'text' in body."}), 400

    # Optional metadata if you want to log/use it later
    _context = data.get("context") or {}

    # System message keeps the tone on-brand
    messages: List[Dict[str, Any]] = [
        {
            "role": "system",
            "content": (
                "You are Son of Wisdom, a calm, supportive AI coach. "
                "Be clear, actionable, and encouraging. Keep answers focused."
            ),
        },
        {"role": "user", "content": user_text},
    ]

    try:
        # Chat Completions API (OpenAI public)
        resp = client.chat.completions.create(
            model=MODEL,
            messages=messages  # type: ignore[arg-type]  # satisfy strict type checkers
        )
        reply = (resp.choices[0].message.content or "").strip()
        return jsonify({"reply": reply})
    except Exception as e:
        # Return a concise error to the UI and log the full one in server console
        print("[/api/chat] ERROR:", repr(e))
        return jsonify({"error": "Request failed. Please try again."}), 500

if __name__ == "__main__":
    # Run dev server: http://127.0.0.1:5001
    app.run(host="127.0.0.1", port=5001, debug=True)
