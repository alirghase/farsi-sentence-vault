#!/usr/bin/env python3
"""Ask the model to read the deck the way a native speaker would.

tools/check_deck.py catches what is structurally wrong. This catches what is
only *semantically* wrong, which no regex can reach: a sentence that parses,
validates and still is not something anyone says. The card that prompted it:

    ما هوای بهار رو نمی‌دونیم.  =  "We don't know the spring weather."

Nothing is malformed there. The verb simply does not take that object, and a
learner drilling it learns a sentence that would puzzle the person they said it
to. That is worse than no card.

Three verdicts, deliberately few:

  ok          say it in Tehran and nobody blinks.
  unnatural   grammatical, but not how it is said. Carries a suggestion.
  mismatch    the Persian and the English are not the same sentence.

What the model is told NOT to flag matters as much as what it flags. This deck
is spoken Tehrani on purpose: می‌رم, نمی‌دونم, رو for را, اومدن for آمدن. A
reviewer defaulting to written Persian would flag the entire deck.

Results are cached by sentence id and text, so a rerun costs nothing and only
changed or new sentences reach the API. The free tier is a daily ceiling and
the deck is bigger than one day's worth; --limit stops early, and the next run
resumes where this one left off.

Judgement only: nothing here edits the deck. It prints what to look at.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import bank, gemini

CACHE = pathlib.Path(__file__).resolve().parent / "review_cache.json"

BATCH = 25

SYSTEM = """You are a native Tehrani Persian speaker reviewing flashcards for an
English speaker learning EVERYDAY SPOKEN Persian.

Judge each pair on two questions only:
  1. Do the Persian and the English say the same thing?
  2. Would a Tehrani actually say the Persian sentence, in ordinary speech?

The deck is colloquial ON PURPOSE. Never flag any of these, they are correct:
  - spoken verb forms: می‌رم, می‌خوام, نمی‌دونم, می‌گم, بذار, بیا
  - رو instead of را; اومدن for آمدن; خونه for خانه; آروم for آرام
  - dropped ezâfe, dropped final consonants, یه for یک
  - missing tashdid or tanvin, casual punctuation
  - short replies and fragments: a card can be one word if people say it

Flag only real problems:
  unnatural  grammatical but not said that way. Give the sentence a Tehrani
             would say instead, with the same meaning.
  mismatch   the English is not a translation of the Persian, or an idiom is
             glossed as if it were literal.

Be conservative. If you would accept the sentence from a friend, it is ok.
Return one entry per input, in the same order, using the given index."""

SCHEMA = {
    "type": "object",
    "properties": {
        "reviews": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "verdict": {"type": "string", "enum": ["ok", "unnatural", "mismatch"]},
                    "note": {"type": "string"},
                    "suggestion": {"type": "string"},
                },
                "required": ["index", "verdict"],
            },
        }
    },
    "required": ["reviews"],
}


def load_cache() -> dict:
    return json.loads(CACHE.read_text()) if CACHE.exists() else {}


def key_for(sentence: dict) -> str:
    return f"{sentence['id']}|{sentence['farsiText']}|{sentence['englishText']}"


def review(batch: list[dict], verbose: bool) -> dict[int, dict]:
    lines = [f"{i}. FA: {s['farsiText']}\n   EN: {s['englishText']}"
             for i, s in enumerate(batch)]
    response = gemini.generate(
        parts=[gemini.text_part("\n".join(lines))],
        system=SYSTEM,
        schema=SCHEMA,
        temperature=0.2,
        verbose=verbose,
    )
    return {r["index"]: r for r in response.get("reviews", [])}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="stop after this many API calls")
    ap.add_argument("--source", choices=["all", "generated", "handwritten"], default="all")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    sentences = bank.load()["sentences"]
    if args.source == "generated":
        sentences = [s for s in sentences if s.get("source") != "handwritten"]
    elif args.source == "handwritten":
        sentences = [s for s in sentences if s.get("source") == "handwritten"]

    cache = load_cache()
    todo = [s for s in sentences if key_for(s) not in cache]
    print(f"{len(sentences)} in scope · {len(sentences) - len(todo)} already reviewed "
          f"· {len(todo)} to go")

    calls = 0
    try:
        for start in range(0, len(todo), BATCH):
            if args.limit and calls >= args.limit:
                print(f"\nstopping at --limit {args.limit}")
                break
            batch = todo[start:start + BATCH]
            try:
                verdicts = review(batch, args.verbose)
            except Exception as error:      # quota, 503, a malformed reply
                print(f"\n  stopped: {type(error).__name__}: {str(error)[:160]}")
                break
            for i, sentence in enumerate(batch):
                verdict = verdicts.get(i)
                if verdict:
                    cache[key_for(sentence)] = verdict
            calls += 1
            print(f"  batch {calls}: {len(verdicts)}/{len(batch)} judged", flush=True)
    finally:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1) + "\n")

    counts: collections.Counter = collections.Counter()
    flagged: list[tuple[dict, dict]] = []
    for sentence in sentences:
        verdict = cache.get(key_for(sentence))
        if not verdict:
            continue
        counts[verdict["verdict"]] += 1
        if verdict["verdict"] != "ok":
            flagged.append((sentence, verdict))

    judged = sum(counts.values())
    print(f"\n{judged} judged: " + " · ".join(f"{k} {v}" for k, v in counts.most_common()))
    if judged:
        print(f"{len(flagged) / judged:.1%} flagged\n")

    for sentence, verdict in flagged:
        print(f"  [{verdict['verdict']}] {sentence['farsiText']}")
        print(f"            = {sentence['englishText']}")
        if verdict.get("note"):
            print(f"            {verdict['note']}")
        if verdict.get("suggestion"):
            print(f"            -> {verdict['suggestion']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
