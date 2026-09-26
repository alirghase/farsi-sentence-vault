#!/usr/bin/env python3
"""Add a word-by-word breakdown and acceptable alternatives to each sentence.

Two problems this solves.

1. A flat literal gloss misleads on compound verbs, which is most Persian verbs.
   "بلند می‌شه" glossed word-by-word reads "tall becomes" — nonsense. The
   breakdown groups it as one unit meaning "gets up", and labels the part of
   speech, so the learner can see which Persian word carries which part of the
   English.

2. Self-rated translation cannot tell "wrong" from "said it differently".
   Persian has many valid renderings; without alternatives a learner marks
   themselves wrong for a correct answer, which also corrupts the SM-2 schedule.

Resumable: every batch is written immediately, and already-annotated sentences
are skipped, so an interrupted run costs only the batch in flight.

    python3 tools/augment.py              # annotate everything missing it
    python3 tools/augment.py --limit 40   # a sample first, to check quality
    python3 tools/augment.py --show 3     # print annotated examples
"""

from __future__ import annotations

import argparse
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import gemini, prompts
from core.bank import ensure_ids, load, save


def check(entry: dict, sentence: dict) -> list[str]:
    """Structural problems worth rejecting a batch entry over."""
    problems = []
    units = entry.get("breakdown") or []
    if not units:
        problems.append("empty breakdown")
        return problems

    for u in units:
        for field in ("fa", "translit", "en", "pos"):
            if not str(u.get(field, "")).strip():
                problems.append(f"unit missing {field}")
                return problems
        if u["pos"] not in prompts.PARTS_OF_SPEECH:
            problems.append(f"unknown pos {u['pos']!r}")
            return problems

    # The units should account for most of the sentence. Exact reassembly is not
    # possible — spacing and ZWNJ vary — so this is a sanity floor, not a parser.
    joined = "".join(u["fa"] for u in units).replace(" ", "")
    original = sentence["farsiText"].replace(" ", "").rstrip("؟?!.")
    overlap = sum(1 for ch in set(original) if ch in joined)
    if original and overlap / max(len(set(original)), 1) < 0.7:
        problems.append("breakdown does not match the sentence")
    return problems


def show(data: dict, count: int) -> int:
    annotated = [s for s in data["sentences"] if s.get("breakdown")]
    if not annotated:
        print("Nothing annotated yet.", file=sys.stderr)
        return 1
    for s in annotated[:count]:
        print(f"\n  {s['englishText']}")
        print(f"  {s['farsiText']}\n")
        for u in s["breakdown"]:
            print(f"    {u['fa']:<18} {u['translit']:<20} {u['en']:<22} {u['pos']}")
        for alt in s.get("alternatives", []):
            print(f"    also: {alt}")
    print(f"\n  {len(annotated)}/{len(data['sentences'])} annotated")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--batch", type=int, default=10, help="sentences per API call")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many (0 = all)")
    ap.add_argument("--show", type=int, default=0, help="print N annotated examples and exit")
    args = ap.parse_args()

    data = load()
    if args.show:
        return show(data, args.show)

    if ensure_ids(data):
        save(data)

    by_id = {s["id"]: s for s in data["sentences"]}
    pending = [s for s in data["sentences"] if not s.get("breakdown")]
    if args.limit:
        pending = pending[: args.limit]

    if not pending:
        print("  everything is already annotated")
        return 0

    print(f"  annotating {len(pending)} of {len(data['sentences'])} sentences")
    system = prompts.breakdown_system()
    started = time.monotonic()
    done = rejected = 0

    for i in range(0, len(pending), args.batch):
        chunk = pending[i : i + args.batch]
        try:
            result = gemini.generate(
                [gemini.text_part(prompts.breakdown_user(chunk))],
                system=system,
                schema=prompts.BREAKDOWN_SCHEMA,
                temperature=0.3,   # annotation should be stable, unlike generation
                verbose=True,
            )
        except gemini.GeminiError as exc:
            print(f"\n  batch failed: {exc}", file=sys.stderr)
            save(data)
            print(f"  saved {done} annotations; re-run to resume.", file=sys.stderr)
            return 1

        for entry in result.get("items", []):
            sentence = by_id.get(entry.get("id"))
            if not sentence:
                continue
            problems = check(entry, sentence)
            if problems:
                rejected += 1
                print(f"    rejected: {problems[0]} :: {sentence['farsiText'][:34]}")
                continue
            sentence["breakdown"] = entry["breakdown"]
            sentence["alternatives"] = entry.get("alternatives", [])
            done += 1

        save(data)
        elapsed = time.monotonic() - started
        print(f"  {done:>4}/{len(pending)}  (-{rejected} rejected, {elapsed:.0f}s)")

    print(f"\n  annotated {done}, rejected {rejected}")
    print("  NEXT: python3 tools/augment.py --show 3")
    return 0


if __name__ == "__main__":
    sys.exit(main())
