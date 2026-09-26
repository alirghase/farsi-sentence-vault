#!/usr/bin/env python3
"""Apply core.gloss.tidy to the word maps already in the deck.

Derived breakdowns were written before these rules existed, and re-deriving
them is not an option — the derivation is lossy and the hand-written batches
merged since would be overwritten. So the repair runs over the deck in place.

derive_breakdown.py applies the same rules to anything it produces from now on,
so this tool is only needed for glosses that predate them.

Dry run by default. Pass --write to save.
"""

from __future__ import annotations

import argparse
import collections
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import bank
from core.gloss import tidy


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true", help="save the changes")
    ap.add_argument("--sample", type=int, default=30, help="diffs to print")
    args = ap.parse_args()

    changes: list[tuple[str, str, str]] = []

    deck = bank.load()
    for sentence in deck["sentences"]:
        # literalGloss is the fallback for an unannotated sentence — a whole
        # sentence, not a unit — so the word-level rules do not touch it.
        for unit in sentence.get("breakdown") or []:
            before = unit.get("en") or ""
            after = tidy(unit.get("fa") or "", before)
            if after != before:
                changes.append((unit.get("fa") or "", before, after))
                unit["en"] = after
    if args.write:
        bank.save(deck)

    kinds: collections.Counter = collections.Counter()
    for _fa, before, after in changes:
        if after.startswith("[") or before.startswith("["):
            kinds["object marker unified"] += 1
        elif "n't" in after:
            kinds["negation rewritten"] += 1
        elif before.split()[-1:] == ["of"]:
            kinds["dangling 'of' dropped"] += 1
        else:
            kinds["possessive moved to front"] += 1

    print(f"{len(changes)} glosses changed\n")
    for kind, count in kinds.most_common():
        print(f"  {count:4}  {kind}")

    print(f"\nsample of {min(args.sample, len(changes))}:")
    seen = set()
    shown = 0
    for fa, before, after in changes:
        if (before, after) in seen:
            continue
        seen.add((before, after))
        print(f"   {fa:<18} {before!r:<28} -> {after!r}")
        shown += 1
        if shown >= args.sample:
            break

    print("\n(dry run — pass --write to save)" if not args.write else "\nsaved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
