#!/usr/bin/env python3
"""Check hand-written batches before merging.

The merge tool validates structure and register. This checks the thing the
merge tool cannot: that the word map actually maps the words. A breakdown that
silently omits a word produces a card whose reveal is missing a chip, which is
invisible until you hit that card in a session.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import validate
from core.prompts import PARTS_OF_SPEECH
from core.taxonomy import ERROR_TAG_KEYS

HANDWRITTEN = pathlib.Path(__file__).parent / "handwritten"

# Persian punctuation sits inside the 0600–06FF block, so a naive letter class
# swallows it and turns "میاید؟" into a word that no breakdown can ever match.
PUNCT = "؟،؛«»٫:!.?…-–—‏"
WORD_RE = re.compile(r"[^\s" + re.escape(PUNCT) + r"]+")


def words(text: str) -> list[str]:
    return [w for w in WORD_RE.findall(text) if w]


def main() -> int:
    files = sys.argv[1:] or [p.name for p in sorted(HANDWRITTEN.glob("*.json"))]
    problems = 0
    total = 0

    for name in files:
        path = HANDWRITTEN / name
        data = json.loads(path.read_text(encoding="utf-8"))
        for item in data["sentences"]:
            total += 1
            fa = item["fa"]
            where = f"{name}: {item['en']!r}"

            for tok, _tr, _en, pos in item["bd"]:
                if pos not in PARTS_OF_SPEECH:
                    print(f"  {where}: unknown pos {pos!r}")
                    problems += 1

            for tag in item["tags"]:
                if tag not in ERROR_TAG_KEYS:
                    print(f"  {where}: unknown tag {tag!r}")
                    problems += 1

            _spoken, written = validate.register_report(validate.normalise_persian(fa))
            if written:
                print(f"  {where}: written-only form {written}")
                problems += 1

            covered: set[str] = set()
            for tok, *_ in item["bd"]:
                covered.update(words(tok))
            missing = [w for w in words(fa) if w not in covered]
            if missing:
                print(f"  {where}: unmapped {missing}")
                problems += 1

    print(f"\n  {total} sentences checked, {problems} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
