#!/usr/bin/env python3
"""Add model-generated sentences to the bank the app ships.

Writes straight into web/data/seed_sentences.json, saving after every batch,
so a run stopped by the free-tier quota keeps everything it got. Nothing here
runs on the phone.

Usage:
    export GEMINI_API_KEY=...
    python3 tools/generate_seed.py --count 40                 # add 40, weighted mix
    python3 tools/generate_seed.py --count 40 --difficulty 3  # add 40 at B1
    python3 tools/generate_seed.py --review                   # read them before shipping
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from core import gemini
from core import prompts
from core import validate
from core.syllabus import CORE_VERBS, DOMAINS, TENSES, coverage
from core.taxonomy import SITUATIONS

from core import bank

OUT = bank.BANK

# Weighted toward 2-3: level 1 gets boring fast, level 5 is demoralising in bulk.
DIFFICULTY_WEIGHTS = {1: 0.15, 2: 0.30, 3: 0.30, 4: 0.18, 5: 0.07}


def plan_batch(size: int, rng: random.Random) -> tuple[dict[int, int], list[str]]:
    mix: dict[int, int] = {}
    for _ in range(size):
        level = rng.choices(
            list(DIFFICULTY_WEIGHTS), weights=list(DIFFICULTY_WEIGHTS.values())
        )[0]
        mix[level] = mix.get(level, 0) + 1
    situations = rng.sample(SITUATIONS, k=min(4, len(SITUATIONS)))
    return mix, situations


def load_existing() -> list[dict]:
    # Unreadable is fatal, not "start fresh": starting fresh here would
    # overwrite the shipped deck with the first batch.
    return bank.load()["sentences"]


def save(sentences: list[dict]) -> None:
    bank.save({"version": 1, "sentences": sentences})


def review(limit: int) -> int:
    """Print a sample with register annotations, for a human to judge.

    The annotations exist so a learner who is not confident judging naturalness
    can check mechanically: spoken markers are what you want to see, written
    markers mean the register instruction was ignored for that sentence.
    """
    sentences = load_existing()
    if not sentences:
        print("No sentences yet. Run without --review first.", file=sys.stderr)
        return 1

    # Whole-bank register health first — one number tells you whether to read on.
    spoken_count = written_count = 0
    offenders = []
    for s in sentences:
        sp, wr = validate.register_report(s["farsiText"])
        if sp:
            spoken_count += 1
        if wr:
            written_count += 1
            offenders.append((s, wr))

    total = len(sentences)
    print(f"\n  REGISTER HEALTH across all {total} sentences")
    print(f"    contain spoken markers:  {spoken_count:>4}  ({spoken_count/total:.0%})")
    print(f"    contain WRITTEN markers: {written_count:>4}  ({written_count/total:.0%})  <- want ~0%")
    if offenders:
        print(f"\n    Sentences using written forms (these are the ones to worry about):")
        for s, wr in offenders[:10]:
            print(f"      {s['farsiText']}")
            print(f"        written: {', '.join(wr)}")
        if len(offenders) > 10:
            print(f"      ... and {len(offenders) - 10} more")

    rng = random.Random(0xF00D)
    sample = rng.sample(sentences, k=min(limit, total))
    print(f"\n{'=' * 64}")
    print(f"  SAMPLE OF {len(sample)} — read each Persian line OUT LOUD.")
    print("  Ask: could I say this to a friend? Does the English match?")
    print(f"{'=' * 64}\n")

    for i, s in enumerate(sample, 1):
        sp, wr = validate.register_report(s["farsiText"])
        print(f"  {i:>2}. [L{s['difficulty']}] {s['englishText']}")
        print(f"      {s['farsiText']}")
        print(f"      {s['finglish']}")
        print(f"      gloss: {s['literalGloss']}")
        marks = []
        if sp:
            marks.append(f"spoken: {', '.join(sp)}")
        if wr:
            marks.append(f"!! WRITTEN: {', '.join(wr)}")
        line = f"      {s['situation']} · {', '.join(s['grammarTags'])}"
        print(line)
        if marks:
            print(f"      {' | '.join(marks)}")
        print()

    print("  If the written-marker percentage is near zero and these sound")
    print("  sayable, you are good. If not, tighten REGISTER_RULES in")
    print("  core/prompts.py and regenerate; `git checkout web/data` undoes a bad run.")
    return 0


def summarise(sentences: list[dict]) -> None:
    by_level: dict[int, int] = {}
    by_tag: dict[str, int] = {}
    for s in sentences:
        by_level[s["difficulty"]] = by_level.get(s["difficulty"], 0) + 1
        for t in s["grammarTags"]:
            by_tag[t] = by_tag.get(t, 0) + 1
    print(f"\n  total: {len(sentences)}")
    print("  by difficulty: " + "  ".join(
        f"L{k}={v}" for k, v in sorted(by_level.items())
    ))
    top = sorted(by_tag.items(), key=lambda kv: -kv[1])[:8]
    print("  top tags: " + "  ".join(f"{k}={v}" for k, v in top))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--count", type=int, default=40,
                    help="sentences to add (default 40, about two batches of quota)")
    ap.add_argument("--batch", type=int, default=20, help="sentences per API call")
    ap.add_argument("--review", action="store_true", help="print a sample and exit")
    ap.add_argument("--review-limit", type=int, default=20)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument(
        "--syllabus",
        action="store_true",
        help="generate against the core verb x tense matrix, targeting gaps first",
    )
    ap.add_argument(
        "--difficulty",
        type=int,
        choices=[1, 2, 3, 4, 5],
        default=None,
        help="generate only at this level (1=A1 .. 5=C1) instead of the weighted mix",
    )
    args = ap.parse_args()

    if args.review:
        return review(args.review_limit)

    rng = random.Random(args.seed)
    sentences = load_existing()
    if sentences:
        print(f"  resuming from {len(sentences)} existing sentences")

    system = prompts.generation_system()
    rejected_total = 0
    started = time.monotonic()

    target = len(sentences) + args.count
    while len(sentences) < target:
        need = min(args.batch, target - len(sentences))
        verb_targets = None
        tense_targets = None
        if args.syllabus:
            # Target the verbs the deck is actually missing, worst first. Six
            # per batch keeps each sentence's instruction specific enough to
            # follow without the prompt becoming a wall of requirements.
            counts = coverage([s for s in sentences if s["difficulty"] <= 2])
            gaps = sorted(counts.items(), key=lambda kv: kv[1])
            verb_targets = [
                (v, gloss)
                for v, n in gaps[:6]
                for vv, gloss in CORE_VERBS
                if vv == v
            ]
            tense_targets = rng.sample(TENSES, k=min(5, len(TENSES)))

        if args.difficulty:
            # Topping up one CEFR tier: the weighted mix would scatter the
            # output across levels the learner cannot reach yet.
            mix = {args.difficulty: need}
            situations = rng.sample(SITUATIONS, k=min(4, len(SITUATIONS)))
        else:
            mix, situations = plan_batch(need, rng)
        avoid = [s["englishText"] for s in sentences[-40:]]

        user = prompts.generation_user(
            count=need,
            situations=situations if not args.syllabus else rng.sample(DOMAINS, k=3),
            difficulty_mix=mix,
            avoid=avoid,
            verb_targets=verb_targets,
            tense_targets=tense_targets,
        )

        try:
            result = gemini.generate(
                [gemini.text_part(user)],
                system=system,
                schema=prompts.SENTENCE_SCHEMA,
                temperature=1.15,   # variety matters more than determinism here
                verbose=True,
            )
        except gemini.GeminiError as exc:
            print(f"\n  batch failed: {exc}", file=sys.stderr)
            print(f"  saved {len(sentences)} so far; re-run to resume.", file=sys.stderr)
            save(sentences)
            return 1

        batch = result.get("sentences", [])
        clean, bad = validate.partition(batch)
        for s, problems in bad:
            rejected_total += 1
            print(f"    rejected: {problems[0]} :: {str(s.get('farsiText'))[:40]}")

        sentences.extend(clean)
        sentences, dropped = validate.dedupe(sentences)
        save(sentences)

        elapsed = time.monotonic() - started
        print(
            f"  {len(sentences):>4}/{target}  "
            f"(+{len(clean)} kept, -{len(bad)} invalid, -{dropped} dupes, {elapsed:.0f}s)"
        )

    summarise(sentences)
    print(f"  rejected during run: {rejected_total}")
    print(f"\n  wrote {OUT}")
    print("  NEXT: python3 tools/generate_seed.py --review")
    return 0


if __name__ == "__main__":
    sys.exit(main())
