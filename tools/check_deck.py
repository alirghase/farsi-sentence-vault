#!/usr/bin/env python3
"""Check the deck for the mistakes a flashcard makes visible and a schema does not.

core/validate.py already covers structure: wrong script, empty fields, tags
outside the closed vocabularies, bookish register. These are the ones that only
show up when you are actually being drilled by the card, and each one was found
on a real card before it was written down here:

  word map      a chip that is not in the sentence, or a word with no chip.
                A spoken-register fix rewrote مادرم to مامانم and left the map
                pointing at a word the sentence no longer contains.

  one meaning   a chip glossed "health — nothing much" gives the learner two
                per chip     answers and no way to choose. The literal belongs
                in literalGloss, where it reads as an aside. A slash is a
                different thing and is left alone: "your head / you" is one
                meaning rendered two ways, which is ordinary in an interlinear
                gloss. The em-dash was pairing a literal against an idiom.

  one answer    two cards sharing an English prompt but not a Farsi answer
                per prompt   means whichever you say, one of them calls it
                wrong. Either the prompts distinguish themselves, or each
                card lists the other as an accepted alternative.

  transliteration  an ezâfe or a possessive clitic written as its own word —
                   "sar etun", "ghahve ye sard" — is read aloud wrongly. They
                   attach: "saretun", "ghahveye sard".

Missing word maps are reported as a count, not a failure: annotation runs
against a daily quota and the deck is expected to be mid-annotation.

Exit code 1 if anything failed, so CI can run it.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import bank
from core.taxonomy import DRILL_KEYS, SWAP_KEYS

PUNCT = '.،؟!؛:«»"\'()'

# Two meanings in one chip: a literal set against an idiom, joined by a dash.
# Deliberately narrow — see the note above about slashes.
TWO_MEANINGS = ("—", " – ", "; ")

# Forms that attach to the previous word in speech and so must attach in the
# transliteration too. "ye" is deliberately absent: it is also the article یه,
# and telling them apart needs the Persian, which the check below does.
ATTACHING = {"e", "et", "esh", "etun", "eshun", "em", "emun", "am", "at", "ash"}


def words(text: str) -> list[str]:
    return [w.strip(PUNCT) for w in text.split() if w.strip(PUNCT)]


TRANSFORMS_FILE = pathlib.Path(__file__).resolve().parent.parent / "web" / "data" / "transforms.json"


def check_transforms(sentences: list[dict]) -> tuple[list[str], int]:
    """The transformation and swap drills that ship beside the deck.

    They land in the same IndexedDB store as the sentences, so their ids share
    one space with them: a collision would make one card overwrite the other on
    the device. This check lived as inline Python inside the CI YAML and broke
    on its own quoting, which is the argument for it being here.
    """
    if not TRANSFORMS_FILE.exists():
        return [], 0

    rows = json.loads(TRANSFORMS_FILE.read_text())["transforms"]
    failures: list[str] = []
    sentence_ids = {s.get("id") for s in sentences}
    seen: set[str] = set()

    for row in rows:
        row_id = row.get("id")
        if not row_id:
            failures.append(f"transform with no id: {row.get('farsiText')}")
        elif row_id in seen or row_id in sentence_ids:
            failures.append(f"transform id collides with another card: {row_id}")
        else:
            seen.add(row_id)

        if not row.get("stem"):
            failures.append(f"transform with no stem: {row.get('farsiText')}")
        if row.get("transform") not in DRILL_KEYS:
            failures.append(f"unknown transformation {row.get('transform')!r}: {row.get('farsiText')}")
        if row.get("transform") in SWAP_KEYS and not row.get("cue"):
            # A swap with no cue is a sentence and nothing to do with it.
            failures.append(f"swap with no cue: {row.get('farsiText')}")
        if not row.get("stemEn"):
            # Without it the drill is also a comprehension test.
            failures.append(f"transform with no English for its stem: {row.get('stem')}")
        if row.get("farsiText", "").strip() == row.get("stem", "").strip():
            failures.append(f"transform whose answer is its own stem: {row.get('stem')}")

    return failures, len(rows)


def check(sentences: list[dict]) -> tuple[list[str], int]:
    failures: list[str] = []
    unmapped = 0

    for s in sentences:
        fa = s["farsiText"]
        units = s.get("breakdown") or []

        if not units:
            unmapped += 1
        elif words(" ".join(u.get("fa", "") for u in units)) != words(fa):
            mapped = " + ".join(u.get("fa", "") for u in units)
            failures.append(f"word map does not reconstruct the sentence: {fa}\n      {mapped}")

        for unit in units:
            gloss = unit.get("en") or ""
            if any(marker in gloss for marker in TWO_MEANINGS):
                failures.append(
                    f"chip gives two meanings: {unit.get('fa')} = {gloss!r}  ({fa})\n"
                    f"      put the literal in literalGloss and leave one meaning here")

        # An attaching form standing as its own transliterated word.
        tokens = s.get("finglish", "").split()
        for i, token in enumerate(tokens):
            if i and token.strip(PUNCT + ",") in ATTACHING:
                failures.append(
                    f"transliteration splits a clitic: ...{tokens[i-1]} {token}...  ({fa})")

        # The ezâfe written as a loose "ye": more standalone "ye" in the
        # transliteration than there are یه in the Persian.
        loose = (sum(1 for t in tokens if t.strip(PUNCT + ",") == "ye")
                 - sum(1 for t in fa.split() if t.strip(PUNCT) == "یه"))
        if loose > 0:
            failures.append(f"transliteration splits an ezâfe from its word: {s['finglish']}  ({fa})")

    # One answer per prompt.
    by_prompt: dict[str, list[dict]] = collections.defaultdict(list)
    for s in sentences:
        by_prompt[s["englishText"].strip().lower()].append(s)
    for prompt, rows in by_prompt.items():
        answers = {r["farsiText"] for r in rows}
        if len(answers) < 2:
            continue
        # Cross-listed alternatives make the pair safe: either answer is accepted.
        if all(answers - {r["farsiText"]} <= set(r.get("alternatives") or []) for r in rows):
            continue
        failures.append(
            f"two cards answer {prompt!r} differently: {' / '.join(sorted(answers))}\n"
            f"      distinguish the prompts, or list each as the other's alternative")

    return failures, unmapped


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quiet", action="store_true", help="print only failures")
    args = ap.parse_args()

    deck = bank.load()
    sentences = deck["sentences"]
    failures, unmapped = check(sentences)
    transform_failures, transform_count = check_transforms(sentences)
    failures += transform_failures

    for failure in failures:
        print(f"  FAIL  {failure}")

    if not args.quiet or failures:
        print(f"\n{len(sentences)} sentences · {len(sentences) - unmapped} word maps "
              f"({unmapped} still to annotate) · {transform_count} transformation drills "
              f"· {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
