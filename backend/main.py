"""Farsi Vault brain — FastAPI service on Cloud Run.

Holds the Gemini API key server-side, grades attempts, and pre-generates the
next day's batch on a schedule. The iPhone stays offline-first: this service is
a sync peer, never the source of truth during a practice session.

Endpoints
    GET  /healthz              liveness, no auth
    POST /v1/sync              the app's one round trip: submit attempts, get
                               grades plus any new sentences
    POST /internal/generate    Cloud Scheduler only (OIDC); pre-generates a batch
    GET  /v1/usage             today's model-call counts, for the cost guardrail
"""

from __future__ import annotations

import base64
import binascii
import datetime as dt
import hmac
import logging
import os
import random
import sys
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.store import Store
from core import gemini, prompts, validate
from core.taxonomy import ERROR_TAG_KEYS, SITUATIONS

log = logging.getLogger("farsi-vault")
logging.basicConfig(level=logging.INFO)

# --- configuration ---------------------------------------------------------

UID = os.environ.get("FARSI_UID", "me")
API_TOKEN = os.environ.get("FARSI_API_TOKEN", "")

# Cost circuit breaker. GCP's free tier requires a billing account, so a runaway
# loop bills real money. These caps are deliberately far above normal daily use
# (~2 generate + ~5 grade calls) and far below anything expensive.
MAX_GENERATE_CALLS_PER_DAY = int(os.environ.get("MAX_GENERATE_CALLS_PER_DAY", "12"))
MAX_GRADE_CALLS_PER_DAY = int(os.environ.get("MAX_GRADE_CALLS_PER_DAY", "40"))

# Cloud Run accepts 32MB requests; cap well below that so a malformed client
# cannot push large payloads through the grader.
# Origins allowed to call this service from a browser. The PWA is served from a
# different origin than the API, so without this every request fails preflight.
# Set ALLOWED_ORIGINS to a comma-separated list in production.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000"
    ).split(",")
    if o.strip()
]

MAX_AUDIO_BYTES = 6 * 1024 * 1024
MAX_ATTEMPTS_PER_SYNC = 60
GRADE_CHUNK = 10        # attempts per Gemini call
GENERATE_CHUNK = 25     # sentences per Gemini call

DIFFICULTY_WEIGHTS = {1: 0.15, 2: 0.30, 3: 0.30, 4: 0.18, 5: 0.07}

_store: Store | None = None


def store() -> Store:
    global _store
    if _store is None:
        _store = Store()
    return _store


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not API_TOKEN:
        log.warning("FARSI_API_TOKEN is unset — /v1 endpoints will reject everything")
    yield


app = FastAPI(title="Farsi Vault brain", version="1.0", lifespan=lifespan)

# Credentials are not used — auth is a bearer token in a header, not a cookie —
# so allow_credentials stays False and origins can stay explicit.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=3600,
)


# --- auth ------------------------------------------------------------------


def require_token(authorization: str = Header(default="")) -> str:
    """Shared-secret bearer auth.

    Adequate for a single-user, sideloaded app. If this ever goes public,
    replace with Firebase Auth ID token verification — the users/{uid} document
    layout already assumes multiple users.
    """
    if not API_TOKEN:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "server token not configured")
    scheme, _, presented = authorization.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(presented, API_TOKEN):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad or missing bearer token")
    return UID


# --- wire types ------------------------------------------------------------


class AttemptIn(BaseModel):
    id: str
    sentenceId: str
    direction: str
    mode: str
    englishText: str
    referenceFarsi: str
    grammarTags: list[str] = Field(default_factory=list)
    typedAnswer: str | None = None
    audioBase64: str | None = None
    selfRating: str | None = None


class SyncRequest(BaseModel):
    attempts: list[AttemptIn] = Field(default_factory=list)
    wantSentences: int = 0
    since: dt.datetime | None = None


class GradeOut(BaseModel):
    attemptId: str
    transcript: str
    score: int
    verdict: str
    feedback: str
    correctedFarsi: str
    errorTags: list[str]


class SyncResponse(BaseModel):
    grades: list[GradeOut] = Field(default_factory=list)
    sentences: list[dict] = Field(default_factory=list)
    focusTags: list[str] = Field(default_factory=list)
    usage: dict = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


# --- helpers ---------------------------------------------------------------


def plan_mix(size: int, rng: random.Random) -> dict[int, int]:
    mix: dict[int, int] = {}
    for _ in range(size):
        level = rng.choices(list(DIFFICULTY_WEIGHTS), weights=list(DIFFICULTY_WEIGHTS.values()))[0]
        mix[level] = mix.get(level, 0) + 1
    return mix


def generate_batch(uid: str, count: int, rng: random.Random) -> tuple[list[dict], list[str]]:
    """Generate `count` validated sentences, chunked to keep responses parseable."""
    focus = store().top_error_tags(uid)
    avoid = store().recent_english(uid)
    produced: list[dict] = []
    warnings: list[str] = []

    while len(produced) < count:
        used = store().bump_usage(uid, "generate")
        if used > MAX_GENERATE_CALLS_PER_DAY:
            warnings.append(
                f"daily generation cap reached ({MAX_GENERATE_CALLS_PER_DAY} calls); "
                f"returning {len(produced)} sentences"
            )
            break

        need = min(GENERATE_CHUNK, count - len(produced))
        user = prompts.generation_user(
            count=need,
            situations=rng.sample(SITUATIONS, k=4),
            difficulty_mix=plan_mix(need, rng),
            focus_tags=focus or None,
            avoid=avoid + [s["englishText"] for s in produced],
        )
        try:
            result = gemini.generate(
                [gemini.text_part(user)],
                system=prompts.generation_system(),
                schema=prompts.SENTENCE_SCHEMA,
                temperature=1.15,
            )
        except gemini.GeminiError as exc:
            log.error("generation failed: %s", exc)
            warnings.append(f"generation stopped early: {exc}")
            break

        clean, bad = validate.partition(result.get("sentences", []))
        if bad:
            log.info("rejected %d invalid sentences", len(bad))
        produced.extend(clean)
        produced, _ = validate.dedupe(produced)

    now = dt.datetime.now(dt.timezone.utc)
    for s in produced:
        s["id"] = str(uuid.uuid4())
        s["source"] = "generated"
        s["createdAt"] = now
    return produced[:count], warnings


def decode_audio(b64: str) -> Path:
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"bad audio encoding: {exc}")
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "audio clip too large")
    handle = tempfile.NamedTemporaryFile(suffix=".m4a", delete=False)
    handle.write(raw)
    handle.close()
    return Path(handle.name)


# --- endpoints -------------------------------------------------------------


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "tags": len(ERROR_TAG_KEYS)}


@app.get("/v1/usage")
def usage(uid: str = Depends(require_token)) -> dict:
    return {
        "today": store().usage_today(uid),
        "caps": {
            "generate": MAX_GENERATE_CALLS_PER_DAY,
            "grade": MAX_GRADE_CALLS_PER_DAY,
        },
    }


@app.post("/v1/sync", response_model=SyncResponse)
def sync(req: SyncRequest, uid: str = Depends(require_token)) -> SyncResponse:
    if len(req.attempts) > MAX_ATTEMPTS_PER_SYNC:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"at most {MAX_ATTEMPTS_PER_SYNC} attempts per sync",
        )

    warnings: list[str] = []
    grades: list[GradeOut] = []
    temp_files: list[Path] = []

    gradable = [a for a in req.attempts if a.typedAnswer or a.audioBase64]

    try:
        for i in range(0, len(gradable), GRADE_CHUNK):
            chunk = gradable[i : i + GRADE_CHUNK]

            used = store().bump_usage(uid, "grade")
            if used > MAX_GRADE_CALLS_PER_DAY:
                warnings.append(
                    f"daily grading cap reached ({MAX_GRADE_CALLS_PER_DAY} calls); "
                    f"{len(gradable) - i} attempts left ungraded"
                )
                break

            parts = [gemini.text_part(prompts.grading_user([
                {
                    "id": a.id,
                    "englishText": a.englishText,
                    "referenceFarsi": a.referenceFarsi,
                    "learnerText": a.typedAnswer,
                }
                for a in chunk
            ]))]
            for a in chunk:
                if a.audioBase64:
                    path = decode_audio(a.audioBase64)
                    temp_files.append(path)
                    parts.append(gemini.audio_part(path))

            try:
                result = gemini.generate(
                    parts,
                    system=prompts.grading_system(),
                    schema=prompts.GRADING_SCHEMA,
                    temperature=0.2,
                )
            except gemini.GeminiError as exc:
                log.error("grading failed: %s", exc)
                warnings.append(f"grading failed for one chunk: {exc}")
                continue

            for g in result.get("grades", []):
                g["errorTags"] = [t for t in g.get("errorTags", []) if t in ERROR_TAG_KEYS]
                grades.append(GradeOut(**g))
    finally:
        for path in temp_files:
            path.unlink(missing_ok=True)

    # Persist history and fold grades into the tag stats that steer generation.
    if req.attempts:
        by_id = {g.attemptId: g for g in grades}
        store().record_attempts(
            uid,
            [
                {
                    **a.model_dump(exclude={"audioBase64"}),
                    "gradedAt": dt.datetime.now(dt.timezone.utc) if a.id in by_id else None,
                    "aiScore": by_id[a.id].score if a.id in by_id else None,
                    "aiErrorTags": by_id[a.id].errorTags if a.id in by_id else [],
                }
                for a in req.attempts
            ],
        )

    deltas = tag_deltas(req.attempts, grades)
    if deltas:
        store().merge_tag_stats(uid, deltas)

    sentences: list[dict] = []
    if req.wantSentences > 0:
        sentences = store().sentences_since(uid, req.since, req.wantSentences)
        if len(sentences) < req.wantSentences:
            fresh, gen_warnings = generate_batch(
                uid, req.wantSentences - len(sentences), random.Random()
            )
            warnings.extend(gen_warnings)
            if fresh:
                store().add_sentences(uid, fresh)
                sentences.extend(fresh)

    return SyncResponse(
        grades=grades,
        sentences=[serialisable(s) for s in sentences],
        focusTags=store().top_error_tags(uid),
        usage=store().usage_today(uid),
        warnings=warnings,
    )


def tag_deltas(attempts: list[AttemptIn], grades: list[GradeOut]) -> dict[str, dict[str, int]]:
    """Turn this sync's outcomes into per-tag fail/total increments.

    `total` counts every tag the sentence exercised, whether or not it was
    failed. `fail` counts only the ones actually got wrong. The resulting rate
    reads as "how often I get this wrong when it comes up" — which is the
    question the Weak Spots screen and focus_tags both need answered.

    Both grading paths feed this:
      - AI-graded attempts use the grader's errorTags.
      - Self-rated attempts have no per-tag signal, so an "again" counts as a
        failure against every tag the sentence exercised. Coarse, but speak-
        aloud is the default mode; excluding it would make adaptation blind to
        most practice.
    """
    deltas: dict[str, dict[str, int]] = {}
    graded = {g.attemptId: g for g in grades}

    def bump(tag: str, failed: bool) -> None:
        d = deltas.setdefault(tag, {"fail": 0, "total": 0})
        d["total"] += 1
        if failed:
            d["fail"] += 1

    for a in attempts:
        tags = [t for t in a.grammarTags if t in ERROR_TAG_KEYS]
        if not tags:
            continue

        grade = graded.get(a.id)
        if grade is not None:
            failed = set(grade.errorTags)
            for tag in tags:
                bump(tag, tag in failed)
            # The grader may flag a tag the sentence was not tagged with. That
            # is still real evidence, so count it.
            for tag in failed - set(tags):
                bump(tag, True)
        elif a.selfRating is not None:
            missed = a.selfRating == "again"
            for tag in tags:
                bump(tag, missed)

    return deltas


def serialisable(doc: dict) -> dict:
    out = dict(doc)
    for key, value in out.items():
        if isinstance(value, dt.datetime):
            out[key] = value.isoformat()
    return out


@app.post("/internal/generate")
async def scheduled_generate(request: Request, uid: str = Depends(require_token)) -> dict:
    """Pre-generate tomorrow's batch, called nightly by Cloud Scheduler.

    Gated on the same bearer token as the /v1 endpoints. The service is
    invokable by allUsers (the iPhone cannot obtain a Google identity token on a
    free Apple account), so IAM alone protects nothing here — without this check
    anyone who found the URL could burn the Gemini quota. Scheduler presents the
    token via an Authorization header set in infra/main.tf.
    """
    count = max(1, min(int(request.query_params.get("count", "100")), 200))
    date_key = dt.date.today().isoformat()

    if store().batch_exists(UID, date_key):
        return {"skipped": True, "reason": "batch already generated today"}

    sentences, warnings = generate_batch(UID, count, random.Random())
    if sentences:
        store().add_sentences(UID, sentences)
        store().mark_batch(UID, date_key, len(sentences))

    log.info("scheduled generation produced %d sentences", len(sentences))
    return {"generated": len(sentences), "warnings": warnings}
