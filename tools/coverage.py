#!/usr/bin/env python3
"""Report how well the deck covers the core verbs and the core words.

A word met in one sentence is a word the scheduler never reinforces, so the
target is three. This prints what falls short, so gaps are visible before they
become gaps in your speech.

    python3 tools/coverage.py
    python3 tools/coverage.py --max-difficulty 2     # A1 + A2 only
    python3 tools/coverage.py --kb                   # every gap in the knowledge base

The knowledge-base section is the worklist for growing the deck: words from
kb/words.json met in fewer than three sentences, and verbs from kb/verbs.json
with no example sentence at all. It counts the whole deck, every level.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import kb
from core.bank import BANK
from core.syllabus import _WORD_ENDINGS, CORE_VERBS, CORE_WORD_LIST, coverage, word_counts

DATA = BANK.parent

CEFR = {1: "A1", 2: "A2", 3: "B1", 4: "B2", 5: "C1"}


def _tokens(text: str) -> list[str]:
    return [w for w in re.split(r"[\s؟،؛.!?:«»\"]+", text.replace("\u200c", "")) if w]


def kb_gaps(texts: list[str]) -> tuple[list[tuple[int, dict]], list[tuple[int, dict]]]:
    """(words in fewer than 3 texts, verbs in fewer than 3), each with its count.

    A word counts bare or with an ending, a phrase as written; a verb counts in
    any of its forms, so دارم می‌رم is an example of رفتن.
    """
    token_sets = [set(_tokens(t)) for t in texts]
    padded = [f" {' '.join(_tokens(t))} " for t in texts]

    words = []
    for w in kb.words():
        fa = w["fa"].replace("\u200c", "")
        if " " in fa:
            n = sum(1 for p in padded if f" {fa} " in p)
        else:
            forms = {fa + e for e in _WORD_ENDINGS}
            n = sum(1 for tokens in token_sets if tokens & forms)
        if n < 3:
            words.append((n, w))

    verbs = []
    all_verbs = kb.verbs()
    by_inf = {v["inf"]: v for v in all_verbs}
    for v in all_verbs:
        forms = {f" {cell['fa'].replace(chr(0x200c), '')} "
                 for cells in kb.conjugate(v, by_inf).values() if cells
                 for cell in cells if cell}
        n = sum(1 for p in padded if any(f in p for f in forms))
        if n < 3:
            verbs.append((n, v))
    # Commonest first: core, then by level, then the fewest examples.
    order = lambda pair: (not pair[1].get("core"), pair[1]["level"], pair[0])  # noqa: E731
    return sorted(words, key=order), sorted(verbs, key=order)


def report_kb(texts: list[str], show_all: bool) -> None:
    words, verbs = kb_gaps(texts)
    limit = None if show_all else 25
    total_words, total_verbs = len(kb.words()), len(kb.verbs())
    print(f"\n  Knowledge base — {total_words - len(words)}/{total_words} words "
          f"in 3+ cards, {total_verbs - len(verbs)}/{total_verbs} verbs")
    no_example = [v for n, v in verbs if n == 0]
    if no_example:
        print(f"\n  Verbs with no example sentence ({len(no_example)}):")
        for v in no_example[:limit]:
            print(f"    {v['inf']:<16} {CEFR[v['level']]}  {kb.gloss(v)}")
    thin = [(n, v) for n, v in verbs if n]
    if thin:
        print(f"\n  Verbs in 1-2 sentences ({len(thin)}):")
        for n, v in thin[:limit]:
            print(f"    {v['inf']:<16} {n}  {CEFR[v['level']]}  {kb.gloss(v)}")
    if words:
        print(f"\n  Words in fewer than 3 cards ({len(words)}):")
        for n, w in words[:limit]:
            print(f"    {w['fa']:<16} {n}  {CEFR[w['level']]}  {w['en']}")
    if limit and (len(words) > limit or len(verbs) > limit):
        print("\n  (commonest first; --kb for all of it)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-difficulty", type=int, default=2,
                    help="only count sentences at or below this level (default 2 = A1+A2)")
    ap.add_argument("--show-all", action="store_true", help="list every verb, not just gaps")
    ap.add_argument("--kb", action="store_true", help="list every knowledge-base gap")
    args = ap.parse_args()

    if not BANK.exists():
        print(f"error: {BANK} not found", file=sys.stderr)
        return 1

    data = json.loads(BANK.read_text(encoding="utf-8"))
    pool = [s for s in data["sentences"] if s["difficulty"] <= args.max_difficulty]
    counts = coverage(pool)

    ceiling = CEFR.get(args.max_difficulty, "?")
    print(f"\n  Core verb coverage up to {ceiling} — {len(pool)} sentences\n")

    absent = sorted(v for v, n in counts.items() if n == 0)
    thin = sorted(((v, n) for v, n in counts.items() if 0 < n < 3), key=lambda x: x[1])
    good = sorted(((v, n) for v, n in counts.items() if n >= 3), key=lambda x: -x[1])

    bar_width = 24
    if args.show_all:
        for verb, n in good:
            filled = min(bar_width, n)
            print(f"    {verb:<14} {n:>3}  {'▪' * filled}")
        print()

    if thin:
        print("  THIN (1-2 sentences):")
        for verb, n in thin:
            gloss = next(g for v, g in CORE_VERBS if v == verb)
            print(f"    {verb:<14} {n}   {gloss}")
        print()

    if absent:
        print("  ABSENT:")
        for verb in absent:
            gloss = next(g for v, g in CORE_VERBS if v == verb)
            print(f"    {verb:<14} -   {gloss}")
        print()

    total = len(CORE_VERBS)
    print(f"  {len(good)}/{total} well covered   {len(thin)} thin   {len(absent)} absent")
    if not (absent or thin):
        print("\n  Every core verb is covered at this level.")

    # Core words count every card you can be dealt, drills and replies included.
    texts = [s["farsiText"] for s in pool]
    for name, field in (("transforms.json", "transforms"), ("replies.json", "replies")):
        rows = json.loads((DATA / name).read_text())[field]
        texts += [t for r in rows if r.get("difficulty", 1) <= args.max_difficulty
                  for t in (r["farsiText"], r["stem"])]
    words = word_counts(texts)
    gloss = dict(CORE_WORD_LIST)
    short = sorted((n, w) for w, n in words.items() if n < 3)
    print(f"\n  Core words — {len(words) - len(short)}/{len(words)} in 3+ cards")
    for n, w in short:
        print(f"    {w:<12} {n}   {gloss[w]}")

    # The knowledge base against the whole deck: every level, every kind of card.
    deck = [s["farsiText"] for s in data["sentences"]]
    for name, field in (("transforms.json", "transforms"), ("replies.json", "replies")):
        rows = json.loads((DATA / name).read_text())[field]
        deck += [t for r in rows for t in (r["farsiText"], r["stem"])]
    report_kb(deck, args.kb)

    by_level: dict[str, int] = {}
    for s in data["sentences"]:
        by_level[CEFR[s["difficulty"]]] = by_level.get(CEFR[s["difficulty"]], 0) + 1
    print("\n  Deck by level: " + "   ".join(
        f"{lvl} {by_level.get(lvl, 0)}" for lvl in ["A1", "A2", "B1", "B2", "C1"]
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
