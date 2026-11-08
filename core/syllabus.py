"""The core verbs, and a count of how well the deck covers them.

Situations give variety but not coverage: a deck full of "ordering food" can
leave whole verbs untouched. tools/coverage.py reports from here.
"""

from __future__ import annotations

import functools
import re

from core import kb

# --- Core verbs -----------------------------------------------------------
# The highest-frequency Persian verbs, flagged "core" in kb/verbs.json. Persian
# leans heavily on compound verbs (noun + light verb), so those are their own
# entries: a learner who knows کردن but not "زنگ زدن" still cannot make a
# phone call.

CORE_VERBS = kb.core_verbs()

# Present stems, which are irregular and cannot be derived from the infinitive:
# رفتن -> می‌رم, اومدن -> میام. Without these the count sees only the past tense
# and calls a verb thin when half the deck uses it.
#
# Several are a single letter (رفتن -> ر). Those must never be matched as bare
# substrings — "ر" occurs inside a large fraction of Persian words, which scored
# رفتن at 622 of 849 sentences. A present stem only counts inside a conjugated
# form: a می‌/ب/ن prefix and a personal ending.
PRESENT_STEMS = {
    "بودن": "هست", "داشتن": "دار", "رفتن": "ر", "اومدن": "ی", "کردن": "کن",
    "شدن": "ش", "گفتن": "گ", "دیدن": "بین", "دادن": "د", "گرفتن": "گیر",
    "خوردن": "خور", "خواستن": "خوا", "تونستن": "تون", "دونستن": "دون",
    "شناختن": "شناس", "آوردن": "آر", "بردن": "بر", "گذاشتن": "ذار",
    "برداشتن": "دار", "زدن": "زن", "خریدن": "خر", "فروختن": "فروش",
    "نوشتن": "نویس", "خوندن": "خون", "موندن": "مون", "رسیدن": "رس",
    "فهمیدن": "فهم", "پرسیدن": "پرس", "گشتن": "گرد", "نشستن": "شین",
    "خوابیدن": "خواب", "بستن": "بند",
}

# A few verbs do not compose from prefix + stem + ending. اومدن is the one that
# matters: its present is میاد / میام and its imperative بیا, none of which fall
# out of the stem. Without these it scored 8 where the true figure is 30.
EXTRA_FORMS = {
    "اومدن": (r"ن?می\u200c?ا(?:م|د|ی|ن|یم|ین)", r"ن?بیا(?:م|د|ی|ن|یم|ین)?"),
    "گفتن": (r"ن?بگو",),
    "شدن": (r"ن?میش(?:م|ه|ی|ن|یم|ین)",),
}

# Forms of the light verbs that close a compound.
_LIGHT_VERB_FORMS = (
    "کرد", "کن", "شد", "شو", "زد", "زن", "داشت", "دار",
    "گرفت", "گیر", "موند", "مون",
)

_FA = r"[\u0600-\u06FF]"
_ENDINGS = r"(?:یم|ید|ین|ند|م|ی|ه|ن|د)?"
_PREFIX = r"(?:ن?می\u200c?|ب|ن)"


def _past_stem(infinitive: str) -> str:
    return infinitive[:-1] if infinitive.endswith("ن") else infinitive


@functools.lru_cache(maxsize=None)
def _verb_pattern(infinitive: str) -> re.Pattern:
    """A regex that matches an inflected form of a simple verb."""
    past = _past_stem(infinitive)
    alternatives = [rf"ن?{re.escape(past)}{_ENDINGS}"]
    present = PRESENT_STEMS.get(infinitive)
    if present:
        alternatives.append(rf"{_PREFIX}{re.escape(present)}{_ENDINGS}")
    alternatives.extend(EXTRA_FORMS.get(infinitive, ()))
    body = "|".join(alternatives)
    return re.compile(rf"(?<!{_FA})(?:{body})(?!{_FA})")


def coverage(sentences: list[dict]) -> dict[str, int]:
    """How many sentences actually use each core verb.

    Two things this deliberately does NOT do, both learned from versions that
    lied:

    * A compound verb is not scored by its nominal alone. "کار کردن" matched on
      "کار" counts every occurrence of the noun "work" — 24 hits at A1+A2 with
      no verb present. The light verb has to follow it.
    * A present stem is not matched as a bare substring, for the reason in the
      PRESENT_STEMS note above.

    It remains a coverage signal, not a parser.
    """
    counts = {verb: 0 for verb, _ in CORE_VERBS}
    for sentence in sentences:
        text = sentence.get("farsiText", "")
        words = text.split()
        for verb, _ in CORE_VERBS:
            if " " in verb:
                nominal, light = verb.split(" ", 1)
                forms = (_past_stem(light), *_LIGHT_VERB_FORMS)
                hit = any(
                    word.startswith(nominal)
                    and any(form in nxt for nxt in words[i + 1:i + 3] for form in forms)
                    for i, word in enumerate(words)
                )
            else:
                hit = bool(_verb_pattern(verb).search(text))
            if hit:
                counts[verb] += 1
    return counts


# --- Core words ---------------------------------------------------------------
# The small words everyday speech is mostly made of — the ones worth meeting in
# several sentences rather than once — flagged "core" in kb/words.json, so the
# knowledge base and this count work from one list. Written from experience,
# not a corpus: no frequency list ships with the repo. Verbs are in CORE_VERBS
# above.
#
# A word "counts" when a sentence contains it, bare or with a clitic or plural
# ending (کتابم, کتابا, خونه‌ست). Close enough to show where the deck is thin.


CORE_WORD_LIST = kb.core_words()

_WORD_ENDINGS = ("", "م", "ت", "ش", "مون", "تون", "شون", "ه", "ی", "ها", "ا", "رو", "و",
                 "ام", "ای", "ست", "یم", "ین", "ن", "اش", "هام", "هات", "هاش", "امون", "ات",
                 "مه", "ته", "شه")


def word_counts(texts: list[str]) -> dict[str, int]:
    """How many of `texts` contain each core word, bare or with an ending."""
    split = [{w.replace("‌", "") for w in re.split(r"[\s؟،؛.!?:«»\"]+", t) if w}
             for t in texts]
    counts = {}
    for word, _gloss in CORE_WORD_LIST:
        forms = {word + ending for ending in _WORD_ENDINGS}
        counts[word] = sum(1 for tokens in split if tokens & forms)
    return counts


def core_share(text: str) -> float:
    """How much of a sentence is core words, to the nearest quarter.

    The app introduces new sentences highest share first, so the words everyday
    speech is mostly made of come before the ones it rarely needs. Quarters
    rather than exact fractions so each tier is big enough to shuffle.
    """
    tokens = [w.replace("\u200c", "") for w in re.split(r"[\s؟،؛.!?:«»\"]+", text) if w]
    if not tokens:
        return 0.0
    forms, verbs = _core_forms()
    return round(sum(t in forms or bool(verbs.fullmatch(t)) for t in tokens) / len(tokens) * 4) / 4


@functools.lru_cache(maxsize=None)
def _core_forms() -> tuple[set[str], re.Pattern]:
    """Every core word with its endings, and one pattern for the core verbs."""
    forms = {word + ending for word, _gloss in CORE_WORD_LIST for ending in _WORD_ENDINGS}
    simple = [v for v, _gloss in CORE_VERBS if " " not in v]
    verbs = re.compile("|".join(f"(?:{_verb_pattern(v).pattern})" for v in simple))
    return forms, verbs
