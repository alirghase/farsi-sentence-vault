"""Firestore access layer.

Document shape is namespaced under users/{uid} from day one even though there
is exactly one user today. Making it multi-user later becomes a config change
rather than a data migration.

Free-tier context: Firestore allows 50k reads and 20k writes per day at no
charge. A single learner doing 100 sentences generates on the order of 200
writes and 300 reads per day — roughly 1% of the allowance.
"""

from __future__ import annotations

import datetime as dt
from typing import Any, Iterable

from google.cloud import firestore

SENTENCES = "sentences"
REVIEWS = "reviews"
ATTEMPTS = "attempts"
TAG_STATS = "tag_stats"
BATCHES = "batches"
USAGE = "usage"


class Store:
    def __init__(self, client: firestore.Client | None = None) -> None:
        self._db = client or firestore.Client()

    def _user(self, uid: str):
        return self._db.collection("users").document(uid)

    # --- sentences ---------------------------------------------------------

    def add_sentences(self, uid: str, sentences: list[dict]) -> int:
        """Write a generated batch. Batched writes keep this to a few round trips."""
        written = 0
        batch = self._db.batch()
        col = self._user(uid).collection(SENTENCES)
        for i, s in enumerate(sentences, 1):
            doc = col.document(s["id"])
            batch.set(doc, s)
            written += 1
            # Firestore caps a batch at 500 operations.
            if i % 400 == 0:
                batch.commit()
                batch = self._db.batch()
        batch.commit()
        return written

    def sentences_since(self, uid: str, since: dt.datetime | None, limit: int) -> list[dict]:
        col = self._user(uid).collection(SENTENCES)
        query = col.order_by("createdAt", direction=firestore.Query.DESCENDING)
        if since:
            query = col.where(
                filter=firestore.FieldFilter("createdAt", ">", since)
            ).order_by("createdAt", direction=firestore.Query.DESCENDING)
        return [d.to_dict() for d in query.limit(limit).stream()]

    def recent_english(self, uid: str, limit: int = 60) -> list[str]:
        """Recent prompts, so generation does not loop over the same sentences."""
        col = self._user(uid).collection(SENTENCES)
        query = col.order_by("createdAt", direction=firestore.Query.DESCENDING).limit(limit)
        return [d.to_dict().get("englishText", "") for d in query.stream()]

    # --- review schedules ---------------------------------------------------

    def save_reviews(self, uid: str, reviews: list[dict]) -> int:
        """Upsert SM-2 rows. Keyed by the client's composite key so repeated
        syncs overwrite rather than duplicate."""
        written = 0
        batch = self._db.batch()
        col = self._user(uid).collection(REVIEWS)
        for i, r in enumerate(reviews, 1):
            batch.set(col.document(r["key"]), r)
            written += 1
            if i % 400 == 0:
                batch.commit()
                batch = self._db.batch()
        batch.commit()
        return written

    def all_reviews(self, uid: str) -> list[dict]:
        """Every schedule row, for restoring onto a wiped device."""
        return [d.to_dict() for d in self._user(uid).collection(REVIEWS).stream()]

    # --- attempts ----------------------------------------------------------

    def record_attempts(self, uid: str, attempts: Iterable[dict]) -> int:
        batch = self._db.batch()
        col = self._user(uid).collection(ATTEMPTS)
        count = 0
        for a in attempts:
            batch.set(col.document(a["id"]), a, merge=True)
            count += 1
        if count:
            batch.commit()
        return count

    # --- tag stats ---------------------------------------------------------

    def merge_tag_stats(self, uid: str, deltas: dict[str, dict[str, int]]) -> None:
        """Accumulate per-tag fail/total counts using atomic increments.

        Increments rather than overwrites, so a retried sync cannot clobber
        counts recorded by a partially-applied earlier attempt.
        """
        batch = self._db.batch()
        col = self._user(uid).collection(TAG_STATS)
        for tag, d in deltas.items():
            batch.set(
                col.document(tag),
                {
                    "tag": tag,
                    "failCount": firestore.Increment(int(d.get("fail", 0))),
                    "totalCount": firestore.Increment(int(d.get("total", 0))),
                    "lastSeen": dt.datetime.now(dt.timezone.utc),
                },
                merge=True,
            )
        batch.commit()

    def top_error_tags(self, uid: str, limit: int = 4, min_total: int = 3) -> list[str]:
        """Worst tags by failure rate, ignoring ones with too little evidence.

        The min_total floor matters: a tag seen twice and failed twice is a 100%
        failure rate on no evidence, and would otherwise dominate generation.
        """
        rows = [d.to_dict() for d in self._user(uid).collection(TAG_STATS).stream()]
        eligible = [r for r in rows if r.get("totalCount", 0) >= min_total]
        eligible.sort(
            key=lambda r: (r.get("failCount", 0) / max(r.get("totalCount", 1), 1)),
            reverse=True,
        )
        return [r["tag"] for r in eligible[:limit] if r.get("failCount", 0) > 0]

    # --- usage guardrail ---------------------------------------------------

    def bump_usage(self, uid: str, kind: str) -> int:
        """Count today's model calls and return the new total.

        This is the cost circuit breaker. GCP's free tier needs a billing
        account attached, so an unbounded retry loop bills real money. The
        service refuses to call Gemini once this exceeds the daily cap.
        """
        today = dt.date.today().isoformat()
        doc = self._user(uid).collection(USAGE).document(today)
        doc.set({"date": today, kind: firestore.Increment(1)}, merge=True)
        snapshot = doc.get().to_dict() or {}
        return int(snapshot.get(kind, 0))

    def usage_today(self, uid: str) -> dict[str, Any]:
        today = dt.date.today().isoformat()
        return self._user(uid).collection(USAGE).document(today).get().to_dict() or {}

    # --- batches -----------------------------------------------------------

    def mark_batch(self, uid: str, date_key: str, count: int) -> None:
        self._user(uid).collection(BATCHES).document(date_key).set(
            {
                "date": date_key,
                "count": count,
                "generatedAt": dt.datetime.now(dt.timezone.utc),
            }
        )

    def batch_exists(self, uid: str, date_key: str) -> bool:
        return self._user(uid).collection(BATCHES).document(date_key).get().exists
