#!/usr/bin/env python3
"""Generate transformation drills from sentences the deck already has.

A transformation card shows a sentence you know and asks you to change one
thing: make it negative, put it in the past, say it to شما, make the subject
plural. Translation drilling teaches you the sentences in the deck; this is the
only exercise here that asks you to produce one that is not in it.

Why the model and not a rule
----------------------------
Persian negation and formality look regular enough to code. They are not, and
this repository has the scar: the gloss repair inferred tense from Persian
morphology, got roughly half the negations wrong, and shipped "I don't can".
Transformations are worse, because a wrong answer here is wrong Farsi drilled
to fluency. So the model writes them, `core/validate.py` checks them, and a
human reads the diff before any of it reaches the deck.

The model is also asked to say when a transformation does NOT apply — already
negative, already past, no second person to make formal — and those are dropped
rather than forced. A card whose answer equals its stem teaches nothing.

Output goes to tools/transforms_out.json for review. Nothing touches the deck
until merge_transforms() is run with --write.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import bank, gemini, tenses, validate
from core.taxonomy import TRANSFORM_KEYS, transform_reference

OUT = pathlib.Path(__file__).resolve().parent / "transforms_out.json"
MERGED = pathlib.Path(__file__).resolve().parent.parent / "web" / "data" / "transforms.json"

BATCH = 12

SYSTEM = f"""You transform spoken Tehrani Persian sentences for a learner's
drill. You are given a sentence and one transformation to apply.

The transformations:
{transform_reference()}

Rules:
- Output EVERYDAY SPOKEN TEHRANI, the same register as the input: می‌رم not
  می‌روم, رو not را, خونه not خانه, اومدن not آمدن, یه not یک.
- Change ONLY what the transformation asks. Keep every other word the same.
- If the transformation does not apply — the sentence is already negative,
  already past, has no second-person verb to make formal, has no singular
  subject to pluralise — set applies=false and leave farsi empty. Do not force
  it, and do not return the sentence unchanged.
- english must be a natural English translation OF YOUR TRANSFORMED SENTENCE,
  not of the original.
- finglish is the transformed sentence transliterated: â for the long a, clitics
  and ezâfe joined to their word (saretun, ghahveye sard), not split off.
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "applies": {"type": "boolean"},
                    "farsi": {"type": "string"},
                    "finglish": {"type": "string"},
                    "english": {"type": "string"},
                    "note": {"type": "string"},
                },
                "required": ["index", "applies"],
            },
        }
    },
    "required": ["results"],
}


def _has(sentence: dict, pattern: str) -> bool:
    return bool(tenses.COMPILED[pattern].search(sentence["farsiText"]))


# Addressing someone is a precondition for "say it to شما". A sentence with no
# second person in it has nothing to make formal, and the first run spent 26 of
# 45 toFormal requests being told so.
#
# Permissive on purpose: it is cheaper to send a few that get refused than to
# hand-roll Persian agreement and wrongly drop good stems. Any of a standalone
# تو, a word ending in the 2nd-person ی or the ـت clitic, or an imperative.
_SECOND_PERSON = re.compile(
    r"(?<![\u0600-\u06FF])تو(?![\u0600-\u06FF])"
    r"|[\u0600-\u06FF](?:ی|ت)(?![\u0600-\u06FF])"
)


def addresses_someone(sentence: dict) -> bool:
    text = sentence["farsiText"]
    return bool(_SECOND_PERSON.search(text)) or _has(sentence, "imperative")


def suits(sentence: dict, transform: str) -> bool:
    """Is this stem worth spending a request on for this transformation?

    The model is asked to refuse what does not apply, and does. But a refusal
    still costs a slot in the batch, and the obvious cases are cheap to rule out
    here — including one the model answers rather than refuses: the past tense
    of an imperative. "Give me a discount" does have a past form, and it is a
    different sentence, so nothing is wrong with the Persian. It just is not the
    exercise.
    """
    if transform == "negate":
        if _has(sentence, "negative"):
            return False
        # خدا حفظت کنه, خیلی لطف داری, ببخشید مزاحم شدم. Negating a blessing or
        # an apology gives you a curse or a nonsense, and the model will produce
        # it rather than refuse, because the grammar is fine.
        if sentence.get("situation") == "compliments and thanking (taarof)":
            return False
        if sentence.get("situation") == "apologising or explaining lateness":
            return False
        # داشتم می‌خوندم. Persian does not really negate the progressive, and the
        # model answered by quietly dropping داشتم.
        return not _has(sentence, "past-progressive")
    if transform == "toPast":
        return not _has(sentence, "imperative") and not _has(sentence, "past-simple")
    if transform == "toPlural":
        return not _has(sentence, "imperative")
    if transform == "toFormal":
        return addresses_someone(sentence)
    return True


def already_done() -> set[tuple[str, str]]:
    """(stem id, transformation) pairs that are already in the shipped file.

    Without this a second run re-proposes everything the first run produced and
    spends the day's quota regenerating cards that exist.
    """
    if not MERGED.exists():
        return set()
    rows = json.loads(MERGED.read_text())["transforms"]
    return {(r["stemId"], r["transform"]) for r in rows}


def candidates(sentences: list[dict], per_transform: int,
               only: list[str] | None = None) -> list[tuple[dict, str]]:
    """Pick stems worth transforming, and which transformation to ask for.

    Short, low-level sentences with a hand-checked word map make the best
    stems: the learner must already know the sentence for the exercise to be
    about grammar rather than vocabulary.
    """
    pool = [
        s for s in sentences
        if s.get("source") != "custom"
        and s.get("breakdown")
        and s.get("difficulty", 9) <= 3
        and 3 <= len(s["farsiText"].split()) <= 10
    ]
    pool.sort(key=lambda s: (s.get("difficulty", 9), len(s["farsiText"].split())))

    done = already_done()
    chosen: list[tuple[dict, str]] = []
    used: set[str] = set()
    # A run cut short by quota or a busy model leaves the later transformations
    # untouched, because the plan is built in order. --only is how the next run
    # picks up the ones that were starved rather than redoing the first.
    for transform in (only or TRANSFORM_KEYS):
        taken = 0
        for s in pool:
            if taken >= per_transform:
                break
            if s["id"] in used or (s["id"], transform) in done:
                continue
            if not suits(s, transform):
                continue
            used.add(s["id"])
            chosen.append((s, transform))
            taken += 1
    return chosen


def ask(batch: list[tuple[dict, str]], verbose: bool) -> dict[int, dict]:
    lines = []
    for i, (s, transform) in enumerate(batch):
        lines.append(f"{i}. transformation: {transform}\n"
                     f"   sentence: {s['farsiText']}\n"
                     f"   means: {s['englishText']}")
    response = gemini.generate(
        parts=[gemini.text_part("\n".join(lines))],
        system=SYSTEM, schema=SCHEMA, temperature=0.3, verbose=verbose,
    )
    return {r["index"]: r for r in response.get("results", [])}


def acceptable(stem: dict, transform: str, result: dict) -> str | None:
    """Return a reason to reject, or None to keep."""
    if not result.get("applies"):
        return "does not apply"
    farsi = (result.get("farsi") or "").strip()
    if not farsi:
        return "empty"
    if not validate.PERSIAN_RE.search(farsi):
        return "not Persian"
    if validate.normalise_persian(farsi) == validate.normalise_persian(stem["farsiText"]):
        return "unchanged from the stem"
    if not (result.get("english") or "").strip():
        return "no English"
    # The register tripwire that guards every other sentence in the deck.
    row = {
        "englishText": result.get("english", ""),
        "farsiText": farsi,
        "finglish": result.get("finglish", ""),
        "literalGloss": "",
        "difficulty": stem.get("difficulty", 1),
        "situation": stem.get("situation"),
        # The stem's tags carry over: a transformation changes the sentence,
        # not what it is an example of. An empty list fails the validator.
        "grammarTags": stem.get("grammarTags") or ["colloquial"],
        "alternatives": [],
    }
    problems = validate.check_sentence(row) or []
    if problems:
        return "; ".join(str(p) for p in problems)[:80]

    # A transformation changes a word; it does not remove one. "داشتم کتاب
    # می‌خوندم" came back as "کتاب نمی‌خوندم" — grammatical, and not the
    # sentence that was asked for.
    if len(farsi.split()) < len(stem["farsiText"].split()):
        return "lost a word from the stem"
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--per-transform", type=int, default=40,
                    help="stems to try for each transformation")
    ap.add_argument("--limit", type=int, default=0, help="stop after N API calls")
    ap.add_argument("--only", help="comma-separated transformations to generate")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    only = None
    if args.only:
        only = [k.strip() for k in args.only.split(",")]
        unknown = [k for k in only if k not in TRANSFORM_KEYS]
        if unknown:
            sys.exit(f"unknown transformation(s): {', '.join(unknown)}")

    deck = bank.load()
    plan = candidates(deck["sentences"], args.per_transform, only)
    print(f"{len(plan)} stems planned across {len(TRANSFORM_KEYS)} transformations")

    kept: list[dict] = []
    rejected: collections.Counter = collections.Counter()
    examples: dict[str, list[str]] = collections.defaultdict(list)
    calls = 0

    try:
        for start in range(0, len(plan), BATCH):
            if args.limit and calls >= args.limit:
                print(f"\nstopping at --limit {args.limit}")
                break
            batch = plan[start:start + BATCH]
            try:
                results = ask(batch, args.verbose)
            except Exception as error:
                print(f"\n  stopped: {type(error).__name__}: {str(error)[:140]}")
                break
            calls += 1
            for i, (stem, transform) in enumerate(batch):
                result = results.get(i)
                if not result:
                    rejected["no answer"] += 1
                    continue
                reason = acceptable(stem, transform, result)
                if reason:
                    rejected[reason] += 1
                    if len(examples[reason]) < 2:
                        examples[reason].append(f"{transform}: {stem['farsiText']}")
                    continue
                finglish = (result.get("finglish") or "").strip()
                if finglish[:1].isupper():
                    finglish = finglish[0].lower() + finglish[1:]
                kept.append({
                    "stemId": stem["id"],
                    "stem": stem["farsiText"],
                    "stemEn": stem["englishText"],
                    "transform": transform,
                    "farsiText": result["farsi"].strip(),
                    "finglish": finglish,
                    "englishText": result["english"].strip(),
                    "difficulty": stem.get("difficulty", 1),
                    "situation": stem.get("situation"),
                    "grammarTags": stem.get("grammarTags") or ["colloquial"],
                })
            print(f"  batch {calls}: {len(kept)} kept so far", flush=True)
    finally:
        OUT.write_text(json.dumps({"count": len(kept), "transforms": kept},
                                  ensure_ascii=False, indent=2) + "\n")

    print(f"\n{len(kept)} kept, {sum(rejected.values())} rejected")
    for reason, n in rejected.most_common():
        print(f"  {n:4}  {reason}")
        for e in examples[reason]:
            print(f"          {e}")
    by = collections.Counter(k["transform"] for k in kept)
    print("\nkept by transformation: " + " · ".join(f"{k} {v}" for k, v in by.most_common()))
    print(f"\nwritten to {OUT.relative_to(pathlib.Path.cwd())} — read it before merging")
    return 0


if __name__ == "__main__":
    sys.exit(main())
