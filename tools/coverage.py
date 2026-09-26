#!/usr/bin/env python3
"""Report how well the deck covers the core syllabus.

"Zero to hero" is only meaningful if it is checkable. This prints which of the
core verbs the lower tiers actually exercise, so gaps are visible before they
become gaps in your speech.

    python3 tools/coverage.py
    python3 tools/coverage.py --max-difficulty 2     # A1 + A2 only
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core.bank import BANK
from core.syllabus import CORE_VERBS, TENSES, coverage

CEFR = {1: "A1", 2: "A2", 3: "B1", 4: "B2", 5: "C1"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-difficulty", type=int, default=2,
                    help="only count sentences at or below this level (default 2 = A1+A2)")
    ap.add_argument("--show-all", action="store_true", help="list every verb, not just gaps")
    args = ap.parse_args()

    if not BANK.exists():
        print(f"error: {BANK} not found", file=sys.stderr)
        return 1

    data = json.loads(BANK.read_text(encoding="utf-8"))
    pool = [s for s in data["sentences"] if s["difficulty"] <= args.max_difficulty]
    counts = coverage(pool)

    ceiling = CEFR.get(args.max_difficulty, "?")
    print(f"\n  Core verb coverage up to {ceiling} — {len(pool)} sentences\n")

    absent = sorted(v for v, n in counts.items() if n == 0)
    thin = sorted(((v, n) for v, n in counts.items() if 0 < n < 3), key=lambda x: x[1])
    good = sorted(((v, n) for v, n in counts.items() if n >= 3), key=lambda x: -x[1])

    bar_width = 24
    if args.show_all:
        for verb, n in good:
            filled = min(bar_width, n)
            print(f"    {verb:<14} {n:>3}  {'▪' * filled}")
        print()

    if thin:
        print("  THIN (1-2 sentences):")
        for verb, n in thin:
            gloss = next(g for v, g in CORE_VERBS if v == verb)
            print(f"    {verb:<14} {n}   {gloss}")
        print()

    if absent:
        print("  ABSENT:")
        for verb in absent:
            gloss = next(g for v, g in CORE_VERBS if v == verb)
            print(f"    {verb:<14} -   {gloss}")
        print()

    total = len(CORE_VERBS)
    print(f"  {len(good)}/{total} well covered   {len(thin)} thin   {len(absent)} absent")
    if absent or thin:
        print("\n  Fill the gaps with:")
        print("    python3 tools/generate_seed.py --syllabus --difficulty 1 --count 60")
    else:
        print("\n  Every core verb is covered at this level.")

    by_level: dict[str, int] = {}
    for s in data["sentences"]:
        by_level[CEFR[s["difficulty"]]] = by_level.get(CEFR[s["difficulty"]], 0) + 1
    print("\n  Deck by level: " + "   ".join(
        f"{lvl} {by_level.get(lvl, 0)}" for lvl in ["A1", "A2", "B1", "B2", "C1"]
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
