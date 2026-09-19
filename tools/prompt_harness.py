#!/usr/bin/env python3
"""Iterate generation and grading prompts against real data, fast.

Round-trip here is seconds; through a Swift rebuild it is minutes. Port to
FarsiVault/AI/Prompts.swift only once output is consistently good.

    python3 tools/prompt_harness.py gen --count 5
    python3 tools/prompt_harness.py grade --text "man miram khune"
    python3 tools/prompt_harness.py grade --audio clip.m4a --english "I'm going home"
    python3 tools/prompt_harness.py consistency --runs 10
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from core import gemini
from core import prompts
from core import validate
from core.taxonomy import ERROR_TAG_KEYS, SITUATIONS


def cmd_gen(args) -> int:
    user = prompts.generation_user(
        count=args.count,
        situations=SITUATIONS[: args.situations],
        difficulty_mix={args.difficulty: args.count},
        focus_tags=args.focus or None,
    )
    result = gemini.generate(
        [gemini.text_part(user)],
        system=prompts.generation_system(),
        schema=prompts.SENTENCE_SCHEMA,
        temperature=1.15,
        verbose=True,
    )
    clean, bad = validate.partition(result.get("sentences", []))
    for s in clean:
        print(f"\n  [L{s['difficulty']}] {s['englishText']}")
        print(f"  {s['farsiText']}")
        print(f"  {s['finglish']}")
        print(f"  gloss: {s['literalGloss']}")
        print(f"  tags: {', '.join(s['grammarTags'])}")
    for s, problems in bad:
        print(f"\n  REJECTED {problems}: {s.get('farsiText')}")
    print(f"\n  {len(clean)} clean, {len(bad)} rejected")
    return 0


def cmd_grade(args) -> int:
    attempt = {
        "id": "test-1",
        "englishText": args.english,
        "referenceFarsi": args.reference,
        "learnerText": args.text,
    }
    parts = [gemini.text_part(prompts.grading_user([attempt]))]
    if args.audio:
        parts.append(gemini.audio_part(args.audio))

    result = gemini.generate(
        parts,
        system=prompts.grading_system(),
        schema=prompts.GRADING_SCHEMA,
        temperature=0.2,   # grading should be stable, unlike generation
        verbose=True,
    )
    for g in result.get("grades", []):
        print(f"\n  score:     {g['score']}  ({g['verdict']})")
        if g.get("transcript"):
            print(f"  heard:     {g['transcript']}")
        print(f"  corrected: {g['correctedFarsi']}")
        print(f"  feedback:  {g['feedback']}")
        print(f"  tags:      {', '.join(g['errorTags']) or '(none)'}")
        unknown = [t for t in g["errorTags"] if t not in ERROR_TAG_KEYS]
        if unknown:
            print(f"  !! OFF-VOCABULARY TAGS: {unknown}")
    return 0


def cmd_consistency(args) -> int:
    """The check that matters: does structured output hold across repeated runs?"""
    ok = 0
    all_tags: set[str] = set()
    for i in range(1, args.runs + 1):
        user = prompts.generation_user(
            count=5, situations=SITUATIONS[:3], difficulty_mix={3: 5}
        )
        try:
            result = gemini.generate(
                [gemini.text_part(user)],
                system=prompts.generation_system(),
                schema=prompts.SENTENCE_SCHEMA,
                temperature=1.15,
            )
            clean, bad = validate.partition(result.get("sentences", []))
            for s in clean:
                all_tags.update(s["grammarTags"])
            status = "ok" if not bad else f"{len(bad)} invalid"
            ok += 1 if not bad else 0
            print(f"  run {i:>2}: parsed, {len(clean)} clean, {status}")
        except gemini.GeminiError as exc:
            print(f"  run {i:>2}: FAILED {exc}")
    print(f"\n  {ok}/{args.runs} runs fully clean")
    off = all_tags - set(ERROR_TAG_KEYS)
    print(f"  off-vocabulary tags seen: {off or '(none)'}")
    return 0 if ok == args.runs else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gen", help="generate a few sentences and print them")
    g.add_argument("--count", type=int, default=5)
    g.add_argument("--difficulty", type=int, default=3)
    g.add_argument("--situations", type=int, default=3)
    g.add_argument("--focus", nargs="*")
    g.set_defaults(func=cmd_gen)

    r = sub.add_parser("grade", help="grade one attempt (text or audio)")
    r.add_argument("--english", default="I should have called you yesterday")
    r.add_argument("--reference", default="باید دیروز بهت زنگ می‌زدم")
    r.add_argument("--text", default=None, help="learner attempt as text")
    r.add_argument("--audio", default=None, help="path to .m4a recording")
    r.set_defaults(func=cmd_grade)

    c = sub.add_parser("consistency", help="repeat generation, check schema holds")
    c.add_argument("--runs", type=int, default=10)
    c.set_defaults(func=cmd_consistency)

    args = ap.parse_args()
    try:
        return args.func(args)
    except gemini.GeminiError as exc:
        print(f"\nerror: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
