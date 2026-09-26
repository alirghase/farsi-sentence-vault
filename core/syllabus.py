"""A systematic syllabus for the lower tiers.

Situation-driven generation gives variety but not coverage: sampling "ordering
food" fifty times will never guarantee you have met the past progressive, and
leaves whole verbs untouched. This module defines the matrix that A1 and A2
generation walks deliberately — core verbs x core tenses, plus core vocabulary
domains — so "zero to hero" means something checkable rather than hopeful.
"""

from __future__ import annotations

import functools
import re

# --- Core verbs -----------------------------------------------------------
# The highest-frequency Persian verbs. Persian leans heavily on compound verbs
# (noun + light verb), so those are listed as their own entries: a learner who
# knows کردن but not "زنگ زدن" still cannot make a phone call.

CORE_VERBS = [
    ("بودن", "to be"),
    ("داشتن", "to have"),
    ("رفتن", "to go"),
    ("اومدن", "to come"),
    ("کردن", "to do / make"),
    ("شدن", "to become"),
    ("گفتن", "to say"),
    ("دیدن", "to see"),
    ("دادن", "to give"),
    ("گرفتن", "to take / get"),
    ("خوردن", "to eat"),
    ("خواستن", "to want"),
    ("تونستن", "to be able"),
    ("دونستن", "to know (a fact)"),
    ("شناختن", "to know (a person)"),
    ("آوردن", "to bring"),
    ("بردن", "to take away / win"),
    ("گذاشتن", "to put / let"),
    ("برداشتن", "to pick up"),
    ("زدن", "to hit / strike"),
    ("خریدن", "to buy"),
    ("فروختن", "to sell"),
    ("نوشتن", "to write"),
    ("خوندن", "to read / sing"),
    ("موندن", "to stay"),
    ("رسیدن", "to arrive"),
    ("فهمیدن", "to understand"),
    ("پرسیدن", "to ask"),
    ("گشتن", "to look for / wander"),
    ("نشستن", "to sit"),
    ("خوابیدن", "to sleep"),
    ("بلند شدن", "to get up"),
    ("کار کردن", "to work"),
    ("صحبت کردن", "to talk"),
    ("زنگ زدن", "to phone"),
    ("قدم زدن", "to walk / stroll"),
    ("دوست داشتن", "to like / love"),
    ("لازم داشتن", "to need"),
    ("یاد گرفتن", "to learn"),
    ("فکر کردن", "to think"),
    ("منتظر موندن", "to wait"),
    ("کمک کردن", "to help"),
    ("درست کردن", "to make / fix"),
    ("پیدا کردن", "to find"),
    ("باز کردن", "to open"),
    ("بستن", "to close"),
    ("شروع کردن", "to start"),
    ("تموم کردن", "to finish"),
]

# --- Core tenses and moods ------------------------------------------------
# Each entry carries an instruction the prompt can use directly.

TENSES = [
    ("present", "Simple present with mi- (می‌رم، می‌خورم). Everyday habitual or current action."),
    ("present-negative", "Negated present (نمی‌رم، نمی‌خوام)."),
    ("past-simple", "Simple past (رفتم، خوردم)."),
    ("past-negative", "Negated past (نرفتم، نخوردم)."),
    ("past-progressive", "Past progressive with mi- (می‌رفتم، می‌خوردم) — was doing, used to do."),
    ("present-perfect", "Present perfect (رفتم/رفته‌ام -> spoken رفتم، خورده‌ام -> خوردم), 'have done'."),
    ("future-intent", "Future or intention, usually spoken as present or with می‌خوام."),
    ("subjunctive", "Subjunctive after باید / می‌خوام / می‌تونم / شاید (باید برم، می‌خوام بخورم)."),
    ("imperative", "Command, informal and formal (برو / برید، بخور / بخورید)."),
    ("question", "A question using کی، کجا، چی، چرا، چطور، چند or a yes/no question."),
]

# --- Core vocabulary domains ----------------------------------------------

DOMAINS = [
    "family and relationships",
    "food, drink and eating out",
    "numbers, prices and money",
    "time, days and dates",
    "places, directions and the city",
    "body, health and feeling unwell",
    "clothes, sizes and shopping",
    "transport: taxi, metro, driving",
    "the home and household objects",
    "work, study and daily routine",
    "weather and seasons",
    "feelings, opinions and reactions",
    "describing people and things",
    "greetings, politeness and taarof",
    "phone, messages and making plans",
]


def matrix(levels_per_cell: int = 1) -> list[dict]:
    """Every (verb, tense) cell, for deterministic coverage.

    Walking this guarantees each core verb is met in each core tense, which
    random situational sampling cannot promise.
    """
    cells = []
    for verb, gloss in CORE_VERBS:
        for tense, description in TENSES:
            cells.append(
                {
                    "verb": verb,
                    "gloss": gloss,
                    "tense": tense,
                    "tense_detail": description,
                    "count": levels_per_cell,
                }
            )
    return cells


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
