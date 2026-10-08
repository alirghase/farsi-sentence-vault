#!/usr/bin/env python3
"""Build the reply drills from tools/handwritten/drills/replies.json.

A reply card says something to you in Persian — a question, a thank-you, an
offer of tea — and you answer in Persian. Nothing on the front is English. It
drills the moment before translation: somebody has just spoken and you have to
find a sentence at all.

There are many right replies, so each card carries a model answer and a few
others, and the verdict stays with you. Hand-written, like the swaps, and
checked with the same validator. Writes web/data/replies.json.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import validate

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tools" / "handwritten" / "drills" / "replies.json"
OUT = ROOT / "web" / "data" / "replies.json"
ZWNJ = "‌"


def row_for(item: list) -> dict:
    said, said_en, reply, tr, reply_en, others, difficulty, situation = item
    fix = lambda text: text.replace("~", ZWNJ)  # noqa: E731
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"reply:{fix(said)}")),
        "kind": "reply",
        "stem": fix(said),
        "stemEn": said_en,
        "farsiText": fix(reply),
        "finglish": tr,
        "englishText": reply_en,
        "alternatives": [fix(o) for o in others],
        "difficulty": difficulty,
        "situation": situation,
        "grammarTags": ["colloquial"],
    }


def problems(row: dict) -> list[str]:
    out = []
    for text in [row["stem"], row["farsiText"], *row["alternatives"]]:
        check = {
            "englishText": row["stemEn"], "farsiText": text, "finglish": row["finglish"],
            "literalGloss": "", "difficulty": row["difficulty"], "situation": row["situation"],
            "grammarTags": row["grammarTags"], "alternatives": [],
        }
        out += [f"{text}: {p}" for p in validate.check_sentence(check)]
    if not row["englishText"].strip() or not row["stemEn"].strip():
        out.append("missing English")
    if "~" in row["finglish"] + row["englishText"]:
        out.append("stray ~")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="save to web/data/")
    args = ap.parse_args()

    rows = [row_for(item) for item in json.loads(SOURCE.read_text())["replies"]]
    failed = False
    seen: set[str] = set()
    for row in rows:
        if row["id"] in seen:
            print(f"  {row['stem']}: said twice")
            failed = True
        seen.add(row["id"])
        for message in problems(row):
            print(f"  {row['stem']}: {message}")
            failed = True
    if failed:
        print("\nnot built — fix the replies above")
        return 1

    print(f"{len(rows)} replies")
    if args.write:
        OUT.write_text(json.dumps({"count": len(rows), "replies": rows},
                                  ensure_ascii=False, indent=2) + "\n")
        print(f"written to {OUT.relative_to(pathlib.Path.cwd())}")
    else:
        print("(dry run — pass --write to save)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
