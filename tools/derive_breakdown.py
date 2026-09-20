#!/usr/bin/env python3
"""Derive word mappings from the gloss the deck already carries.

Every sentence has a literalGloss written in Persian word order — "tomorrow
I-go home" against "فردا می‌رم خونه". Where the Persian, the transliteration
and the gloss tokenise to the same length, the mapping is already there and
only needs extracting. That covers ~80% of the deck instantly and costs no API
quota.

The results are marked `breakdownSource: "derived"` so a later model pass can
tell them apart and upgrade them: part-of-speech here is heuristic, and only
compound verbs listed in the syllabus get merged. Anything the model annotates
is marked "model" and is never overwritten by this tool.

    python3 tools/derive_breakdown.py
    python3 tools/derive_breakdown.py --dry-run --show 5
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core.syllabus import CORE_VERBS

BANK = pathlib.Path(__file__).parent / "seed_sentences.json"
PUNCT = "؟?!.،,:;"

# Light verbs that form Persian compound verbs. A compound is a nominal plus one
# of these; splitting them is the single worst thing a word-by-word gloss can do,
# because it teaches that "بلند" means "get up" rather than "tall".
LIGHT_VERB_STEMS = [
    "کن", "کرد", "می‌کن", "نکن", "بکن",
    "شد", "می‌ش", "بش", "نش",
    "زد", "می‌زن", "بزن", "نزن",
    "داد", "می‌د", "بد", "ند",
    "گرفت", "می‌گیر", "بگیر", "نگیر",
    "دار", "داش", "ندار",
    "خورد", "می‌خور", "بخور",
    "موند", "می‌مون", "بمون",
    "باش", "بود",
]

# Nominal halves of the compound verbs the syllabus tracks.
COMPOUND_NOMINALS = {v.split(" ")[0] for v, _ in CORE_VERBS if " " in v}
COMPOUND_NOMINALS |= {"منتظر", "دوست", "قدم", "زنگ", "کمک", "صحبت", "کار",
                      "شروع", "تموم", "پیدا", "باز", "درست", "یاد", "فکر",
                      "بلند", "لازم", "سعی", "گوش", "استفاده", "سفر"}

PRONOUN_SUFFIXES = ("-my", "-your", "-his", "-her", "-its", "-our", "-their",
                    "my-", "your-", "his-", "her-", "its-", "our-", "their-")
SUBJECT_MARKERS = ("i-", "you-", "he-", "she-", "we-", "they-", "it-",
                   "-i", "-you", "-we", "-they")
QUESTION_WORDS = {"what", "where", "when", "who", "why", "how", "how-much",
                  "how-many", "which", "how-much-is", "whose"}
PREPOSITIONS = {"to", "from", "with", "in", "on", "at", "for", "by", "under",
                "behind", "near", "until", "about"}
CONJUNCTIONS = {"and", "but", "because", "that", "if", "or", "when", "so"}


def tokens(text: str) -> list[str]:
    return [w for w in re.split(r"\s+", (text or "").strip()) if w.strip(PUNCT)]


def guess_pos(fa: str, gloss: str) -> str:
    """Heuristic part of speech. Deliberately conservative: 'noun' is the
    commonest answer and a wrong guess is worse than a dull one."""
    g = gloss.lower().strip(PUNCT)

    if g in ("[obj]", "[object]", "ra", "rā"):
        return "particle"
    if g in QUESTION_WORDS or g.endswith("-is") and g.split("-")[0] in QUESTION_WORDS:
        return "question word"
    if g in CONJUNCTIONS:
        return "conjunction"
    if g in PREPOSITIONS:
        return "preposition"
    if any(g.startswith(p) or g.endswith(p) for p in PRONOUN_SUFFIXES):
        return "attached pronoun"
    if any(m in g for m in SUBJECT_MARKERS):
        return "verb"
    if re.fullmatch(r"[a-z]+-[a-z]+", g) and any(
        g.startswith(x) for x in ("can-", "must-", "will-", "did-", "do-", "is-", "are-")
    ):
        return "verb"
    if g.isdigit() or g in ("one", "two", "three", "four", "five", "a", "an"):
        return "number"
    if g in ("i", "you", "he", "she", "we", "they", "it", "this", "that", "me", "him", "her"):
        return "pronoun"
    if g in ("very", "really", "again", "now", "yesterday", "tomorrow", "today",
             "always", "never", "here", "there", "still", "already", "just"):
        return "adverb"
    return "noun"


# Periphrastic verb forms: a participle plus an auxiliary, which the gloss
# splits into two meaningless halves ("have" + "I be" for داشته باشم).
PARTICIPLE_AUXILIARIES = ("باش", "بود", "بش")


def is_participle(fa: str) -> bool:
    return fa.endswith("ه") and len(fa) > 3


# Auxiliary glosses that carry no meaning of their own once merged: "داشته
# باشم" is "have", not "have I be".
EMPTY_AUXILIARY_GLOSSES = {"i be", "be", "is", "was", "am", "are", "i am", "he be", "it be"}


def merged_gloss(first: str, second: str, participle: bool) -> str:
    a = first.replace("-", " ").strip()
    b = second.replace("-", " ").strip()
    if participle and b.lower() in EMPTY_AUXILIARY_GLOSSES:
        return a
    return f"{a} {b}".strip()


def merge_compounds(units: list[dict]) -> list[dict]:
    """Join a nominal to the light verb that follows it.

    Without this the gloss reads "tall becomes" for بلند می‌شه, which teaches
    the learner something false about the most common verb pattern in Persian.
    """
    merged: list[dict] = []
    i = 0
    while i < len(units):
        current = units[i]
        nxt = units[i + 1] if i + 1 < len(units) else None
        joins_compound = (
            nxt
            and current["fa"].strip(PUNCT) in COMPOUND_NOMINALS
            and any(stem in nxt["fa"] for stem in LIGHT_VERB_STEMS)
        )
        joins_participle = (
            nxt
            and is_participle(current["fa"].strip(PUNCT))
            and any(nxt["fa"].startswith(a) or nxt["fa"].startswith("ب" + a)
                    for a in PARTICIPLE_AUXILIARIES)
        )
        if joins_compound or joins_participle:
            merged.append(
                {
                    "fa": f"{current['fa']} {nxt['fa']}",
                    "translit": f"{current['translit']} {nxt['translit']}",
                    "en": merged_gloss(current["en"], nxt["en"], joins_participle),
                    "pos": "compound verb" if joins_compound else "verb",
                }
            )
            i += 2
            continue
        merged.append(current)
        i += 1
    return merged


def derive(sentence: dict) -> list[dict] | None:
    fa = tokens(sentence["farsiText"])
    tr = tokens(sentence.get("finglish", ""))
    gl = tokens(sentence.get("literalGloss", ""))
    if not fa or len(fa) != len(tr) or len(fa) != len(gl):
        return None

    units = [
        {
            "fa": f.strip(PUNCT),
            "translit": t.strip(PUNCT),
            "en": g.strip(PUNCT).replace("-", " "),
            "pos": guess_pos(f, g),
        }
        for f, t, g in zip(fa, tr, gl)
    ]
    return merge_compounds(units)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--show", type=int, default=0)
    args = ap.parse_args()

    data = json.loads(BANK.read_text(encoding="utf-8"))
    derived = skipped = kept = 0
    examples = []

    for s in data["sentences"]:
        if s.get("breakdown"):
            kept += 1        # never overwrite a model or hand-written annotation
            continue
        units = derive(s)
        if not units:
            skipped += 1
            continue
        if not args.dry_run:
            s["breakdown"] = units
            s["breakdownSource"] = "derived"
            s.setdefault("alternatives", [])
        derived += 1
        if len(examples) < args.show:
            examples.append((s, units))

    for s, units in examples:
        print(f"\n  {s['englishText']}")
        print(f"  {s['farsiText']}")
        for u in units:
            print(f"    {u['fa']:<20} {u['en']:<24} {u['pos']}")

    if not args.dry_run:
        BANK.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    total = len(data["sentences"])
    print(f"\n  derived {derived}   already annotated {kept}   unalignable {skipped}")
    print(f"  coverage now {(derived + kept)}/{total} = {(derived + kept) / total:.0%}")
    if skipped:
        print(f"  the {skipped} unalignable ones need a model pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
