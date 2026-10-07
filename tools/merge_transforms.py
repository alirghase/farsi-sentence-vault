#!/usr/bin/env python3
"""Merge reviewed transformation drills into the bundled deck.

Separate from transforms.py on purpose. That tool spends quota and writes a
proposal; this one is the gate. Nothing the model produced reaches the app
without passing through here, and the rejection list below is a record of what
a human read and threw out, with the reason attached.

Run transforms.py first, read tools/transforms_out.json, add anything wrong to
REJECTED, then run this.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import bank, validate
from core.taxonomy import TRANSFORM_KEYS


def key(farsi: str) -> str:
    """Compare sentences ignoring the final mark.

    normalise_persian keeps punctuation, so "دستت درد نکنه." and
    "دستت درد نکنه!" are two deck entries and produced two identical
    transformation cards.
    """
    return validate.normalise_persian(farsi).rstrip(".!؟،؛ ")

SOURCE = pathlib.Path(__file__).resolve().parent / "transforms_out.json"
OUT = pathlib.Path(__file__).resolve().parent.parent / "web" / "data" / "transforms.json"

# Read and rejected. The Persian in each is well formed — the validator passed
# them — which is the point: these are the failures only a reader catches.
REJECTED = {
    "دنبال بهونه نگشتی.":
        "the stem is a negative imperative, so the exercise is not a tense change",
    "ببخشید، معذرت می‌خواستم.":
        "معذرت می‌خوام is a fixed apology, not a verb phrase to put in the past",
    "گلوهامون خیلی درد می‌کنه.":
        "گلوهامون — Persian keeps the body part singular here: گلومون درد می‌کنه",

    # Second run. The pool was widened to longer, less basic sentences, which
    # brought in set phrases and compound verbs; most of these are the cost of
    # that and are filtered at source now.
    "بشقباب لازم نداری؟":
        "بشقباب — a typo for بشقاب",
    "داروت رو نبرداشتی؟":
        "نبرداشتی — برداشتن negates inside the preverb: برنداشتی, which the "
        "model itself got right twice elsewhere",
    "خدا حفظت نکنه.":
        "negating a blessing gives a curse",
    "خیلی لطف نداری.":
        "لطف داری is a set thanks; negated it is an insult, not an exercise",
    "ببخشید مزاحم نشدم.":
        "ببخشید مزاحم شدم is a fixed apology — negated it means nothing",
    "ببخشید، معذرت نمی‌خوام.":
        "the same fixed apology as the first run, from a different stem",
    "کتاب نمی‌خوندم.":
        "dropped داشتم from داشتم کتاب می‌خوندم — a different sentence",
    "بارون نمیاد.":
        "dropped داره from داره بارون میاد",
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="save to web/data/")
    args = ap.parse_args()

    proposed = json.loads(SOURCE.read_text())["transforms"]
    deck_text = {key(s["farsiText"]) for s in bank.load()["sentences"]}

    # Additive. A generation run is capped by quota and by the model being
    # busy, so the file is built up over several of them — and merging used to
    # write only the current proposal, which would have silently dropped every
    # drill merged before it.
    existing = json.loads(OUT.read_text())["transforms"] if OUT.exists() else []
    kept: list[dict] = list(existing)
    dropped: collections.Counter = collections.Counter()
    seen_target: set[str] = {key(r["farsiText"]) for r in existing}
    seen_pair: set[tuple[str, str]] = {(key(r["stem"]), r["transform"]) for r in existing}

    for row in proposed:
        target = key(row["farsiText"])
        pair = (key(row["stem"]), row["transform"])

        if row["farsiText"] in REJECTED:
            dropped["rejected on review"] += 1
            continue
        if row["transform"] not in TRANSFORM_KEYS:
            dropped["unknown transformation"] += 1
            continue
        if pair in seen_pair:
            # Two stems differing only by punctuation produce the same card.
            dropped["duplicate stem and transformation"] += 1
            continue
        if target in seen_target:
            dropped["duplicate answer"] += 1
            continue
        # A transformation whose answer is already a sentence in the deck is a
        # translation card wearing a different hat.
        if target in deck_text:
            dropped["answer already in the deck"] += 1
            continue

        seen_pair.add(pair)
        seen_target.add(target)
        kept.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL,
                                 f"transform:{row['stemId']}:{row['transform']}")),
            "kind": "transform",
            "stemId": row["stemId"],
            "stem": row["stem"],
            "stemEn": row["stemEn"],
            "transform": row["transform"],
            "farsiText": row["farsiText"],
            "finglish": row["finglish"],
            "englishText": row["englishText"],
            "difficulty": row["difficulty"],
            "situation": row["situation"],
            "grammarTags": row.get("grammarTags") or ["colloquial"],
            "alternatives": [],
        })

    by = collections.Counter(k["transform"] for k in kept)
    print(f"{len(existing)} already merged + {len(proposed)} proposed "
          f"-> {len(kept)} total")
    for reason, n in dropped.most_common():
        print(f"  {n:4}  dropped: {reason}")
    print("\n  " + " · ".join(f"{k} {v}" for k, v in sorted(by.items())))

    if args.write:
        OUT.write_text(json.dumps({"count": len(kept), "transforms": kept},
                                  ensure_ascii=False, indent=2) + "\n")
        print(f"\nwritten to {OUT.relative_to(pathlib.Path.cwd())}")
    else:
        print("\n(dry run — pass --write to save)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
