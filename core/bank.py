"""The sentence bank: one file, the one the app ships.

Every tool reads and writes web/data/seed_sentences.json directly, and the diff
on that file is the review of what changed.
"""

from __future__ import annotations

import json
import pathlib
import uuid

from core.syllabus import core_share

BANK = pathlib.Path(__file__).resolve().parent.parent / "web" / "data" / "seed_sentences.json"


def load() -> dict:
    if not BANK.exists():
        return {"version": 1, "count": 0, "sentences": []}
    return json.loads(BANK.read_text(encoding="utf-8"))


def ensure_ids(data: dict) -> bool:
    """Give every sentence a stable id.

    The app matches bundled sentences to rows already on a device by this id,
    so a corrected translation or gloss lands on the row that holds its review
    history instead of arriving as a duplicate. Ids are never regenerated.
    """
    changed = False
    for s in data["sentences"]:
        if not s.get("id"):
            s["id"] = str(uuid.uuid4())
            changed = True
    return changed


def save(data: dict) -> None:
    ensure_ids(data)
    # Read by the app to introduce the commonest sentences first.
    for s in data["sentences"]:
        s["core"] = core_share(s["farsiText"])
    data["version"] = data.get("version", 1)
    data["count"] = len(data["sentences"])
    BANK.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
