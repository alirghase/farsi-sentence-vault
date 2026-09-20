"""Minimal Gemini REST client. Standard library only — no pip install.

Deliberately dependency-free so the request/response shapes stay visible and
port mechanically to Swift's URLSession in FarsiVault/AI/GeminiClient.swift.

Free-tier reality this client is built around:
  - gemini-2.5-flash: ~1500 requests/day, 15 requests/minute
  - 429 on burst; the seed generation run WILL hit the per-minute cap, so
    pacing and backoff are not optional extras here.
"""

from __future__ import annotations

import base64
import http.client
import json
import os
import pathlib
import sys
import threading
import time
import urllib.error
import urllib.request

API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"

# Model availability churns: gemini-2.5-flash was retired for new API keys in
# 2026 and now returns 404 even though it still appears in the model listing.
# Verified working 2026-09-19: 3.6-flash (~14s/call), 3.5-flash (~26s),
# flash-latest (~42s). gemini-3.8-flash exists but returned 503 "high demand".
# Override with GEMINI_MODEL when a model's daily quota is spent, to skip the
# dead ones rather than paying the fallback probe on every call.
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")

# Tried in order when the primary model 404s (retired) or is persistently
# unavailable. Without this, a model retirement is a hard outage.
FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-flash-latest"]

KEY_FILE = pathlib.Path.home() / ".config" / "farsi-vault" / "gemini_key"

# Free tier is 15 RPM. Stay under it with margin rather than relying on retries.
MIN_INTERVAL_SECONDS = 4.5


class GeminiError(RuntimeError):
    pass


def load_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    if KEY_FILE.exists():
        key = KEY_FILE.read_text(encoding="utf-8").strip()
        if key:
            return key
    raise GeminiError(
        "No Gemini API key found.\n"
        "  Get a free key at https://aistudio.google.com/apikey then either:\n"
        "    export GEMINI_API_KEY=...\n"
        f"  or write it to {KEY_FILE}"
    )


class _Pacer:
    """Serialises calls and enforces a minimum gap, to stay under 15 RPM."""

    def __init__(self, min_interval: float = MIN_INTERVAL_SECONDS) -> None:
        self._min_interval = min_interval
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self) -> None:
        with self._lock:
            gap = time.monotonic() - self._last
            if gap < self._min_interval:
                time.sleep(self._min_interval - gap)
            self._last = time.monotonic()


_pacer = _Pacer()


def text_part(text: str) -> dict:
    return {"text": text}


def audio_part(path: str | pathlib.Path, mime_type: str = "audio/mp4") -> dict:
    raw = pathlib.Path(path).read_bytes()
    return {
        "inline_data": {
            "mime_type": mime_type,
            "data": base64.b64encode(raw).decode("ascii"),
        }
    }


def generate(
    parts: list[dict],
    *,
    system: str | None = None,
    schema: dict | None = None,
    model: str = DEFAULT_MODEL,
    temperature: float = 1.0,
    api_key: str | None = None,
    max_retries: int = 5,
    verbose: bool = False,
) -> dict | str:
    """Call generateContent. Returns parsed JSON when `schema` is given, else text."""
    key = api_key or load_api_key()

    body: dict = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"temperature": temperature},
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    if schema:
        body["generationConfig"]["responseMimeType"] = "application/json"
        body["generationConfig"]["responseSchema"] = schema

    payload = json.dumps(body).encode("utf-8")

    # Try the requested model, then fall back if it has been retired.
    candidates = [model] + [m for m in FALLBACK_MODELS if m != model]
    last_error: Exception | None = None

    for candidate in candidates:
        try:
            return _attempt_model(
                candidate, payload, key, schema is not None, max_retries, verbose
            )
        except _ModelUnavailable as exc:
            last_error = exc.reason
            if verbose:
                print(
                    f"  model {candidate} unavailable; trying next", file=sys.stderr
                )
            continue

    raise GeminiError(f"no usable model. last error: {last_error}")


class _ModelUnavailable(Exception):
    """This model is retired or persistently down; try another."""

    def __init__(self, reason: Exception) -> None:
        super().__init__(str(reason))
        self.reason = reason


def _attempt_model(
    model: str,
    payload: bytes,
    key: str,
    expect_json: bool,
    max_retries: int,
    verbose: bool,
):
    url = f"{API_ROOT}/{model}:generateContent?key={key}"

    delay = 2.0
    last_error: Exception | None = None

    for attempt in range(1, max_retries + 1):
        _pacer.wait()
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                parsed = json.loads(resp.read().decode("utf-8"))
            return _extract(parsed, expect_json)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            last_error = GeminiError(f"HTTP {exc.code}: {detail}")
            # 404 means the model is gone — retrying it is pointless, but
            # another model may work.
            if exc.code == 404:
                raise _ModelUnavailable(last_error) from exc
            # A daily quota exhaustion is not transient: retrying this model
            # wastes a minute of backoff before failing anyway. Fall through to
            # the next model immediately, which lives in a different bucket.
            if exc.code == 429 and "exceeded your current quota" in detail:
                raise _ModelUnavailable(last_error) from exc
            # 429 rate limit, 5xx transient. Anything else is our bug — fail fast.
            if exc.code not in (429, 500, 502, 503, 504):
                raise last_error from exc
            if verbose:
                print(
                    f"  [retry {attempt}/{max_retries}] HTTP {exc.code}, "
                    f"sleeping {delay:.0f}s",
                    file=sys.stderr,
                )
        except (urllib.error.URLError, http.client.HTTPException, OSError) as exc:
            # urllib only wraps errors raised by request(); one raised by
            # getresponse() — a mid-response disconnect, most commonly — escapes
            # as RemoteDisconnected and would otherwise kill a long run.
            # OSError also covers TimeoutError and ConnectionResetError.
            last_error = GeminiError(f"network error: {type(exc).__name__}: {exc}")
            if verbose:
                print(
                    f"  [retry {attempt}/{max_retries}] {type(exc).__name__}, "
                    f"sleeping {delay:.0f}s",
                    file=sys.stderr,
                )

        if attempt < max_retries:
            time.sleep(delay)
            delay = min(delay * 2, 20.0)

    # Exhausted retries on a transient failure (typically 503 "high demand"):
    # treat as unavailable so the caller can fall back to another model.
    raise _ModelUnavailable(
        GeminiError(f"gave up after {max_retries} attempts: {last_error}")
    )


def _extract(response: dict, expect_json: bool):
    candidates = response.get("candidates") or []
    if not candidates:
        feedback = response.get("promptFeedback", {})
        raise GeminiError(f"no candidates returned; promptFeedback={feedback}")

    candidate = candidates[0]
    finish = candidate.get("finishReason")
    if finish not in (None, "STOP"):
        # MAX_TOKENS here means truncated JSON, which would fail to parse below
        # with a far less obvious error. Surface the real cause.
        raise GeminiError(f"generation stopped early: finishReason={finish}")

    chunks = [p.get("text", "") for p in candidate.get("content", {}).get("parts", [])]
    text = "".join(chunks).strip()
    if not text:
        raise GeminiError("empty response text")

    if not expect_json:
        return text
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise GeminiError(f"model returned invalid JSON: {exc}\n---\n{text[:600]}") from exc
