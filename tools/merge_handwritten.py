#!/usr/bin/env python3
"""Merge hand-written sentences into the deck.

Hand-written material still goes through the same validation as generated
material — the closed tag vocabulary and the register check exist to keep the
deck consistent, and exempting my own writing from them would defeat that.
"""

from __future__ import annotations

import json
import pathlib
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import validate
from core.prompts import PARTS_OF_SPEECH
from core.taxonomy import ERROR_TAG_KEYS

BANK = pathlib.Path(__file__).parent / "seed_sentences.json"
SOURCE = pathlib.Path(__file__).parent / "handwritten" / "a2_core_verbs.json"


def main() -> int:
    deck = json.loads(BANK.read_text(encoding="utf-8"))
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    existing = {s["farsiText"] for s in deck["sentences"]}

    added, skipped, problems = [], 0, []

    for item in source["sentences"]:
        farsi = validate.normalise_persian(item["fa"])
        if farsi in existing:
            skipped += 1
            continue

        # Tags outside the closed set would fragment the per-tag statistics,
        # exactly the failure the closed vocabulary exists to prevent.
        tags = [t for t in item["tags"] if t in ERROR_TAG_KEYS]
        dropped = [t for t in item["tags"] if t not in ERROR_TAG_KEYS]
        if dropped:
            problems.append(f"dropped unknown tags {dropped} from {item['en']!r}")
        if not tags:
            tags = ["naturalness"]

        breakdown = [
            {"fa": fa, "translit": tr, "en": en, "pos": pos}
            for fa, tr, en, pos in item["bd"]
        ]
        bad_pos = [u["pos"] for u in breakdown if u["pos"] not in PARTS_OF_SPEECH]
        if bad_pos:
            problems.append(f"REJECTED {item['en']!r}: bad pos {bad_pos}")
            continue

        sentence = {
            "id": str(uuid.uuid4()),
            "englishText": item["en"],
            "farsiText": farsi,
            "finglish": item["tr"],
            "literalGloss": " ".join(u["en"] for u in breakdown),
            "difficulty": 2,
            "situation": item["sit"],
            "grammarTags": tags,
            "breakdown": breakdown,
            "alternatives": [validate.normalise_persian(a) for a in item.get("alt", [])],
            "source": "handwritten",
        }

        issues = validate.check_sentence(sentence)
        if issues:
            problems.append(f"REJECTED {item['en']!r}: {issues[0]}")
            continue

        spoken, written = validate.register_report(farsi)
        if written:
            problems.append(f"REJECTED {item['en']!r}: written form {written}")
            continue

        added.append(sentence)
        existing.add(farsi)

    for line in problems:
        print(f"  {line}")

    deck["sentences"].extend(added)
    deck["count"] = len(deck["sentences"])
    BANK.write_text(json.dumps(deck, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n  added {len(added)}, skipped {skipped} duplicates")
    print(f"  deck now {deck['count']} sentences")
    return 0


if __name__ == "__main__":
    sys.exit(main())
