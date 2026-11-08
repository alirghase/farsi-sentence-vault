#!/usr/bin/env python3
"""Report content-word exposure: what the deck teaches once and never again.

Verbs have their own report (tools/coverage.py). This one covers nouns,
adjectives and adverbs, where a word met a single time is a word the scheduler
never gets to reinforce.

    python3 tools/vocabulary.py                 # the summary and what is thin
    python3 tools/vocabulary.py --once          # every lemma met exactly once
    python3 tools/vocabulary.py --top 40        # the best-covered lemmas
"""

from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import bank
from core.vocab import exposure, glosses

TARGET = 3  # exposures below which a word is unlikely to stick


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-difficulty", type=int, default=5,
                    help="only count sentences at or below this level")
    ap.add_argument("--once", action="store_true", help="list every lemma met exactly once")
    ap.add_argument("--top", type=int, default=0, help="list the N best-covered lemmas")
    args = ap.parse_args()

    deck = bank.load()
    pool = [s for s in deck["sentences"] if s["difficulty"] <= args.max_difficulty]
    counts = exposure(pool)
    gloss = glosses(pool)

    once = sorted(w for w, n in counts.items() if n == 1)
    twice = sorted(w for w, n in counts.items() if n == 2)
    solid = sum(1 for n in counts.values() if n >= TARGET)

    print(f"\n  Content vocabulary — {len(pool)} sentences, {len(counts)} lemmas\n")
    print(f"    met once        {len(once):4}   ({len(once) / len(counts):.0%})")
    print(f"    met twice       {len(twice):4}")
    print(f"    met {TARGET}+ times   {solid:4}   ({solid / len(counts):.0%})")

    if args.top:
        print(f"\n  BEST COVERED")
        for word, n in counts.most_common(args.top):
            print(f"    {word:<16} {n:>3}   {gloss.get(word, '')}")

    if args.once:
        print(f"\n  MET ONCE ({len(once)})")
        for word in once:
            print(f"    {word:<16}     {gloss.get(word, '')}")
    else:
        print(f"\n  A word met once is a word the scheduler never reinforces.")
        print(f"  Run with --once to list them.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
