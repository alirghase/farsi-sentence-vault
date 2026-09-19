#!/usr/bin/env python3
"""Generate the seed sentence bank, once, on the Mac.

The output JSON is bundled into the iOS app so it is useful offline on first
launch. This script is NOT a runtime dependency — delete it afterwards and the
app is unaffected.

Usage:
    export GEMINI_API_KEY=...
    python3 tools/generate_seed.py --count 400
    python3 tools/generate_seed.py --review        # read them before bundling
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
from core.taxonomy import SITUATIONS

OUT = pathlib.Path(__file__).parent / "seed_sentences.json"

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
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding="utf-8"))["sentences"]
        except (json.JSONDecodeError, KeyError):
            print(f"warning: {OUT} unreadable, starting fresh", file=sys.stderr)
    return []


def save(sentences: list[dict]) -> None:
    OUT.write_text(
        json.dumps(
            {"version": 1, "count": len(sentences), "sentences": sentences},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


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
    print("  core/prompts.py, delete tools/seed_sentences.json, regenerate.")
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
    ap.add_argument("--count", type=int, default=400, help="target total (default 400)")
    ap.add_argument("--batch", type=int, default=20, help="sentences per API call")
    ap.add_argument("--review", action="store_true", help="print a sample and exit")
    ap.add_argument("--review-limit", type=int, default=20)
    ap.add_argument("--seed", type=int, default=None)
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

    while len(sentences) < args.count:
        need = min(args.batch, args.count - len(sentences))
        mix, situations = plan_batch(need, rng)
        avoid = [s["englishText"] for s in sentences[-40:]]

        user = prompts.generation_user(
            count=need, situations=situations, difficulty_mix=mix, avoid=avoid
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
            f"  {len(sentences):>4}/{args.count}  "
            f"(+{len(clean)} kept, -{len(bad)} invalid, -{dropped} dupes, {elapsed:.0f}s)"
        )

    summarise(sentences)
    print(f"  rejected during run: {rejected_total}")
    print(f"\n  wrote {OUT}")
    print("  NEXT: python3 tools/generate_seed.py --review")
    return 0


if __name__ == "__main__":
    sys.exit(main())
