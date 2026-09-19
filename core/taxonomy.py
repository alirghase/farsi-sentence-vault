"""Shared vocabulary for sentence generation and attempt grading.

This module is the single source of truth for the closed sets the model is
constrained to. It is mirrored in Swift at FarsiVault/AI/Prompts.swift — if you
change anything here, change it there too, or adaptation silently breaks.

Why closed sets: free-form tags from an LLM fragment across runs
("ezafe" / "ezāfe" / "missing ezafe" / "incorrect ezafe construction"). Once tags
fragment, ErrorTagStat counts split across near-duplicates and the "target my
weak spots" loop starts aiming at noise.
"""

# --- Error tags -------------------------------------------------------------
# Persian-specific learner errors. The two that matter most for the "knows the
# words but freezes" failure mode are COMPOUND_VERB and COLLOQUIAL.

ERROR_TAGS = {
    "ezafe": "Missing, added, or misplaced ezâfe (the -e/-ye linking vowel).",
    "ra-marker": "Object marker را missing, added wrongly, or misplaced.",
    "verb-tense": "Wrong tense (past vs present vs perfect vs progressive).",
    "subjunctive": "Subjunctive missing or malformed after a modal/wish/necessity.",
    "verb-agreement": "Verb ending disagrees with the subject in person or number.",
    "word-order": "Constituents out of order; Persian is subject-object-verb.",
    "preposition": "Wrong or missing preposition (به/از/با/در/روی/تو).",
    "pronoun-clitic": "Attached possessive/object pronouns (-am/-et/-esh/-emun) wrong.",
    "plural": "Plural formation wrong (ها/ان) or plural used where Persian uses singular.",
    "compound-verb": "Persian compound verb wrong: wrong light verb (کردن/شدن/زدن/دادن/گرفتن) or wrong nominal part.",
    "vocab-gap": "Did not produce the needed word at all.",
    "vocab-wrong": "Produced a word that exists but is the wrong choice here.",
    "formality": "Register mismatch: formal form where informal is natural, or vice versa.",
    "colloquial": "Used a bookish/written form where spoken Persian differs (می‌روم vs می‌رم, است vs ـه).",
    "spelling": "Persian script spelling error, including ZWNJ (نیم‌فاصله) mistakes.",
    "naturalness": "Grammatical and understandable, but not how a native speaker would say it.",
}

ERROR_TAG_KEYS = sorted(ERROR_TAGS)

# --- Situations -------------------------------------------------------------
# Everyday contexts where an intermediate speaker actually freezes. Deliberately
# weighted toward interaction under time pressure rather than description.

SITUATIONS = [
    "phone call with family",
    "ordering food or coffee",
    "shopping and asking prices",
    "giving or following directions",
    "making plans with a friend",
    "apologising or explaining lateness",
    "disagreeing politely",
    "talking about the past (what you did)",
    "talking about future plans",
    "expressing an opinion",
    "small talk about weather or traffic",
    "at the doctor or pharmacy",
    "taxi, metro, and travel",
    "complaining about something not working",
    "asking someone to repeat or clarify",
    "compliments and thanking (taarof)",
    "talking about work or study",
    "describing how you feel",
    "hosting or visiting someone's home",
    "negotiating or asking for a favour",
]

# --- Difficulty -------------------------------------------------------------

DIFFICULTY = {
    1: "One clause, present tense, high-frequency vocabulary. 3-6 words.",
    2: "One clause, past or future tense, or a simple compound verb. 5-9 words.",
    3: "Two clauses joined by که/اگر/وقتی, or a subjunctive after a modal. 8-14 words.",
    4: "Multiple clauses, conditionals, reported speech, or nuanced register. 12-20 words.",
    5: "Idiomatic, abstract, or emotionally nuanced; needs taarof awareness or fixed expressions. 12-25 words.",
}

DIRECTIONS = ["enToFa", "faToEn"]


def tag_reference() -> str:
    """Render the tag vocabulary for inclusion in a prompt."""
    return "\n".join(f"- {k}: {v}" for k, v in ERROR_TAGS.items())


def difficulty_reference() -> str:
    return "\n".join(f"- Level {k}: {v}" for k, v in DIFFICULTY.items())
