"""A systematic syllabus for the lower tiers.

Situation-driven generation gives variety but not coverage: sampling "ordering
food" fifty times will never guarantee you have met the past progressive, and
leaves whole verbs untouched. This module defines the matrix that A1 and A2
generation walks deliberately — core verbs x core tenses, plus core vocabulary
domains — so "zero to hero" means something checkable rather than hopeful.
"""

from __future__ import annotations

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


def coverage(sentences: list[dict]) -> dict[str, int]:
    """How many sentences contain each core verb. Reveals the gaps.

    Substring matching is deliberately crude here: Persian verbs inflect, so an
    exact match would find almost nothing. It is a coverage signal, not a parser.
    """
    counts = {verb: 0 for verb, _ in CORE_VERBS}
    for s in sentences:
        text = s.get("farsiText", "")
        for verb, _ in CORE_VERBS:
            # Match the stem: drop the -ن infinitive ending, and for compounds
            # keep the nominal part which does not inflect.
            stem = verb[:-1] if verb.endswith("ن") else verb
            if " " in verb:
                stem = verb.split(" ")[0]
            if stem and stem in text:
                counts[verb] += 1
    return counts
