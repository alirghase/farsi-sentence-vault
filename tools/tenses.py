#!/usr/bin/env python3
"""Report which tenses and structures the deck actually teaches.

Verbs have tools/coverage.py and vocabulary has tools/vocabulary.py; this is
the third axis. Every figure can be checked — `--show <name>` prints the
sentences behind it, which is how you tell a thin structure from a broken
pattern.

    python3 tools/tenses.py
    python3 tools/tenses.py --show past-progressive
    python3 tools/tenses.py --max-difficulty 2
"""

from __future__ import annotations

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import bank
from core.tenses import NOTES, PATTERNS, distribution, examples

LABELS = {
    "present": "Present  می‌...",
    "present-have-be": "Present  دارم / هست",
    "past-simple": "Past simple",
    "past-progressive": "Past progressive  داشتم می‌رفتم",
    "past-perfect": "Past perfect  رفته بودم",
    "imperative": "Imperative",
    "subjunctive-modal": "Subjunctive after a modal",
    "conditional": "Conditional  اگه",
    "negative": "Negative  نـ / نمی",
    "question": "Question",
    "passive": "Passive  نوشته شد",
    "resultative": "Resultative  گم شده",
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-difficulty", type=int, default=5)
    ap.add_argument("--show", metavar="NAME", help=f"print matches for one of: {', '.join(PATTERNS)}")
    args = ap.parse_args()

    deck = bank.load()
    pool = [s for s in deck["sentences"] if s["difficulty"] <= args.max_difficulty]

    if args.show:
        if args.show not in PATTERNS:
            print(f"error: unknown structure {args.show!r}", file=sys.stderr)
            return 1
        found = examples(pool, args.show, limit=200)
        print(f"\n  {LABELS.get(args.show, args.show)} — {len(found)} sentences\n")
        for s in found[:40]:
            print(f"    {s['farsiText']}")
            print(f"      {s['englishText']}")
        return 0

    counts = distribution(pool)
    total = len(pool)
    print(f"\n  Tenses and structures — {total} sentences\n")
    for name in LABELS:
        n = counts[name]
        bar = "▪" * round(n / total * 30)
        print(f"    {LABELS[name]:<34} {n:>4}  {n / total:>5.1%}  {bar}")

    print()
    for name, note in NOTES.items():
        print(f"    {LABELS.get(name, name)}: {note}")
    print("\n    Surface regexes, not a parse. Check any figure with --show <name>.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
