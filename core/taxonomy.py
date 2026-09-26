"""Shared vocabulary for sentence generation and attempt grading.

This module is the single source of truth for the closed sets the model is
constrained to. It is mirrored in web/js/taxonomy.js — if you change anything
here, change it there too. tools/check_mirror.py enforces that, and runs in CI.

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

SITUATION_SET = set(SITUATIONS)

# Mapping any free-text theme onto the closed set.
#
# The field fragmented to 396 distinct values across 1,224 sentences. Three
# causes, all fixable: generate_seed.py wrote a vocabulary DOMAIN into the
# situation field verbatim; a domain containing commas
# ("transport: taxi, metro, driving") was split into three labels; and the
# hand-written batches invented their own wording ("family news", "at home").
#
# Order matters — the first keyword that matches wins, so the specific ones
# come before the general.
_SITUATION_KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    (("doctor", "pharmacy", "health", "ill", "sick", "pain", "medicine",
      "hospital", "body", "fever", "unwell", "allerg"), "at the doctor or pharmacy"),
    (("taxi", "metro", "transport", "driving", "bus", "travel", "train",
      "flight", "station"), "taxi, metro, and travel"),
    (("direction", "street", "address", "city", "places", "lost", "map"),
     "giving or following directions"),
    (("restaurant", "food", "coffee", "eating", "meal", "drink", "cafe",
      "order", "breakfast", "lunch", "dinner", "waiter", "menu"),
     "ordering food or coffee"),
    (("shop", "price", "money", "cost", "buy", "size", "market", "clothes",
      "number", "bill", "pay", "bargain"), "shopping and asking prices"),
    (("late", "apolog", "sorry", "delay", "missed"),
     "apologising or explaining lateness"),
    (("broken", "complain", "not working", "repair", "fix", "fault", "problem"),
     "complaining about something not working"),
    (("repeat", "clarify", "understand", "hear", "confus"),
     "asking someone to repeat or clarify"),
    (("thank", "taarof", "compliment", "polite", "greet", "welcome",
      "goodbye", "hello", "farewell", "affection"),
     "compliments and thanking (taarof)"),
    (("weather", "rain", "traffic", "season", "spring", "summer", "winter",
      "autumn", "snow", "hot day", "cold"), "small talk about weather or traffic"),
    (("work", "study", "office", "university", "school", "class", "job",
      "exam", "routine", "lesson", "interview", "salary", "colleague"),
     "talking about work or study"),
    (("feel", "mood", "tired", "happy", "sad", "upset", "angry", "worried",
      "reaction", "emotion", "nervous"), "describing how you feel"),
    (("host", "guest", "visit", "home", "house", "household", "room",
      "kitchen", "neighbour"), "hosting or visiting someone's home"),
    (("favour", "request", "permission", "help", "negotiat", "borrow"),
     "negotiating or asking for a favour"),
    (("disagree", "argu", "object"), "disagreeing politely"),
    (("opinion", "agree", "think", "describ", "advice", "recommend"),
     "expressing an opinion"),
    (("plan", "arrange", "meet", "invit", "weekend", "time", "day", "date",
      "schedule", "appointment"), "making plans with a friend"),
    (("past", "yesterday", "memory", "childhood", "recount", "last night",
      "used to"), "talking about the past (what you did)"),
    (("future", "tomorrow", "next", "someday"), "talking about future plans"),
    (("phone", "message", "call", "text", "voicemail"), "phone call with family"),
    (("family", "relationship", "sister", "brother", "mother", "father",
      "child", "parent", "cousin", "relative", "sibling"), "phone call with family"),
    # A second round, from the scenario wording the hand-written batches used.
    (("news", "secret", "announce", "reveal", "group chat", "reach someone"),
     "phone call with family"),
    (("warn", "encourag", "comfort", "reassur", "correct", "advis", "summaris",
      "hedg", "compar", "discussion", "philosoph", "decid", "weighing",
      "confirm", "disbelief", "candid", "claim", "declin", "offer"),
     "expressing an opinion"),
    (("locked out", "accident", "near miss", "garage", "wet", "broke", "stuck",
      "emergency", "failure", "frustrat", "waiting", "queue"),
     "complaining about something not working"),
    (("small talk", "chat", "catching up", "cooking", "reading", "football",
      "match", "sport", "learning"), "small talk about weather or traffic"),
    (("hotel", "reception", "venue", "cinema", "party", "gathering", "trip",
      "celebration", "desk", "bakery", "park", "stranger", "outing"),
     "making plans with a friend"),
    (("teacher", "student", "deadline", "project", "test", "application",
      "errand"), "talking about work or study"),
    (("leaving", "goodbye", "seeing someone off", "welcom", "introduc",
      "gift", "toast", "glass", "bed", "knock", "doorway", "door"),
     "compliments and thanking (taarof)"),
    (("wait", "interrupt", "someone walks in", "topic", "postpon", "silence",
      "conversation"), "asking someone to repeat or clarify"),
    (("looking for", "forget", "lost", "return", "hands full", "before going out",
      "somewhere new", "scene", "surprise", "coincidence", "unease"),
     "describing how you feel"),
]

DEFAULT_SITUATION = "expressing an opinion"


def canonical_situation(label: str) -> str:
    """Map any theme label onto one of SITUATIONS.

    Returns DEFAULT_SITUATION when nothing matches, so the field can be
    validated as a closed set rather than drifting again.
    """
    if label in SITUATION_SET:
        return label
    lowered = (label or "").lower()
    for keywords, situation in _SITUATION_KEYWORDS:
        if any(k in lowered for k in keywords):
            return situation
    return DEFAULT_SITUATION


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
