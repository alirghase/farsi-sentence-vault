"""Prompt templates and response schemas for generation and grading.

Mirrored in Swift at FarsiVault/AI/Prompts.swift. Iterate here first — a Python
round-trip is seconds, a Swift rebuild is minutes.
"""

from __future__ import annotations

from core.taxonomy import (
    DIFFICULTY,
    ERROR_TAG_KEYS,
    SITUATIONS,
    difficulty_reference,
    tag_reference,
)

# ---------------------------------------------------------------------------
# Register. This is the single most important part of the generation prompt.
# Without it the model writes literary/written Persian — grammatical, and not
# how anyone actually speaks. Drilling that register is worse than useless: it
# trains you to sound like a newsreader in a coffee shop.
# ---------------------------------------------------------------------------

REGISTER_RULES = """\
Write SPOKEN, everyday Tehrani Persian — the register used between friends and
family in conversation. NOT written, literary, formal, or news Persian.

Apply these spoken forms consistently:
  - Present verbs contract: می‌روم -> می‌رم, می‌خواهم -> می‌خوام, می‌گویم -> می‌گم
  - "است" becomes the attached -ه: "خوب است" -> "خوبه", "کجاست" not "کجا است"
  - را -> رو after a vowel, or drops in fast speech: "کتاب رو بده"
  - Prepositional pronouns contract: "به او" -> "بهش", "از او" -> "ازش"
  - ân -> un raising: نان -> نون, تهران -> تهرون, خانه -> خونه
  - برای -> واسه, هیچ چیز -> هیچی, چه کار -> چیکار
  - Use informal 2nd person (تو / -ی) unless the situation calls for formality,
    in which case use شما and say so via the "formality" grammar tag.

Never mix registers inside one sentence. Never use Arabic-heavy literary
vocabulary where a common Persian word exists.
"""

FINGLISH_RULES = """\
The "finglish" field is a Latin transliteration using this exact scheme:
  - â = the long open 'a' (آب -> âb, نون -> nun uses u not â)
  - a e o i u = short/other vowels
  - kh gh ch sh zh for خ ق/غ چ ش ژ
  - ' for the glottal stop (معنی -> ma'ni)
  - Write it as it is SPOKEN, matching the colloquial Persian exactly:
    "می‌رم خونه" -> "miram khune", never "miravam khâne"
  - Separate clitics with no hyphen: "behesh", "khubam"
"""


def generation_system() -> str:
    return f"""\
You write translation-practice sentences for an English speaker learning to SPEAK
conversational Persian (Farsi). The learner knows common words and verbs but
freezes when producing a sentence under time pressure. Your sentences are what
they will say out loud, hundreds of times.

{REGISTER_RULES}

{FINGLISH_RULES}

The "literalGloss" field is a word-by-word English gloss of the Persian, in
Persian word order, so the learner can see the structure. Example:
  Persian: باید دیروز بهت زنگ می‌زدم
  Gloss:   "must yesterday to-you bell I-was-hitting"

Difficulty levels:
{difficulty_reference()}

Tag each sentence with the grammar features a learner must get right to produce
it. Use ONLY these tags:
{tag_reference()}

Rules:
  - The English must be natural English, not a translation of the Persian.
  - Every sentence must be something a real person would actually say.
  - No proper nouns that need cultural knowledge to understand.
  - Vary sentence openings; do not start many sentences the same way.
"""


def generation_user(
    *,
    count: int,
    situations: list[str],
    difficulty_mix: dict[int, int],
    focus_tags: list[str] | None = None,
    avoid: list[str] | None = None,
    verb_targets: list[tuple[str, str]] | None = None,
    tense_targets: list[tuple[str, str]] | None = None,
) -> str:
    mix = ", ".join(f"{n} at level {lvl}" for lvl, n in sorted(difficulty_mix.items()))
    lines = [
        f"Generate exactly {count} sentences.",
        f"Difficulty mix: {mix}.",
        f"Spread them across these situations: {', '.join(situations)}.",
    ]
    if focus_tags:
        lines.append(
            "PRIORITY: the learner is currently failing these grammar features — "
            f"at least half the sentences must require them: {', '.join(focus_tags)}."
        )
    if verb_targets:
        verbs = "\n".join(f"  - {v} ({gloss})" for v, gloss in verb_targets)
        lines.append(
            "COVERAGE REQUIREMENT: these core verbs are missing from the learner's "
            "deck. Every sentence must use one of them as its main verb, and you "
            "must use each at least once:\n" + verbs
        )
    if tense_targets:
        tenses = "\n".join(f"  - {name}: {detail}" for name, detail in tense_targets)
        lines.append(
            "Spread the sentences across these tenses and moods. Skip any "
            "combination that would be unnatural rather than forcing it:\n" + tenses
        )
    if avoid:
        sample = "\n".join(f"  - {s}" for s in avoid[:40])
        lines.append(
            "Do NOT repeat or trivially reword any of these already-seen sentences:\n"
            + sample
        )
    return "\n\n".join(lines)


SENTENCE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "sentences": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "englishText": {"type": "STRING"},
                    "farsiText": {"type": "STRING"},
                    "finglish": {"type": "STRING"},
                    "literalGloss": {"type": "STRING"},
                    "difficulty": {"type": "INTEGER"},
                    "situation": {"type": "STRING"},
                    "grammarTags": {
                        "type": "ARRAY",
                        "items": {"type": "STRING", "enum": ERROR_TAG_KEYS},
                    },
                },
                "required": [
                    "englishText",
                    "farsiText",
                    "finglish",
                    "literalGloss",
                    "difficulty",
                    "situation",
                    "grammarTags",
                ],
                "propertyOrdering": [
                    "englishText",
                    "farsiText",
                    "finglish",
                    "literalGloss",
                    "difficulty",
                    "situation",
                    "grammarTags",
                ],
            },
        }
    },
    "required": ["sentences"],
}


# ---------------------------------------------------------------------------
# Grading
# ---------------------------------------------------------------------------

def grading_system() -> str:
    return f"""\
You grade a Persian learner's translation attempts. You are strict about meaning
and grammar, and generous about register variation that a native would accept.

For each attempt you receive the English prompt, the reference Persian, and the
learner's attempt (as text, or as an audio recording you must transcribe first).

{REGISTER_RULES}

Grading:
  - score 0-100. 100 = a native would say this and it means the same thing.
  - The reference Persian is ONE correct answer, not the only one. If the
    learner's version is different but equally natural and correct, score it
    high and say so. Do not penalise valid alternatives.
  - Penalise meaning changes hardest, then grammar, then register, then
    naturalness.
  - verdict: "correct" (90-100), "minor" (70-89), "major" (40-69), "wrong" (0-39).

feedback: ONE short sentence, addressed to the learner, naming the single most
useful thing to fix. No preamble, no praise padding. If the attempt was correct,
say what made it good in a few words.

correctedFarsi: the learner's own sentence minimally repaired. If it was already
correct, echo it back unchanged.

errorTags: ONLY from this list, and only tags the learner actually got wrong.
An empty list is correct for a perfect attempt.
{tag_reference()}

For audio attempts, "transcript" is what you actually heard in Persian script —
transcribe honestly, including errors and hesitation. Do not silently correct the
learner's speech into the reference sentence. If the audio is unintelligible or
silent, set transcript to "" and verdict to "wrong" with the tag "vocab-gap".
"""


GRADING_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "grades": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "attemptId": {"type": "STRING"},
                    "transcript": {"type": "STRING"},
                    "score": {"type": "INTEGER"},
                    "verdict": {
                        "type": "STRING",
                        "enum": ["correct", "minor", "major", "wrong"],
                    },
                    "feedback": {"type": "STRING"},
                    "correctedFarsi": {"type": "STRING"},
                    "errorTags": {
                        "type": "ARRAY",
                        "items": {"type": "STRING", "enum": ERROR_TAG_KEYS},
                    },
                },
                "required": [
                    "attemptId",
                    "transcript",
                    "score",
                    "verdict",
                    "feedback",
                    "correctedFarsi",
                    "errorTags",
                ],
                "propertyOrdering": [
                    "attemptId",
                    "transcript",
                    "score",
                    "verdict",
                    "feedback",
                    "correctedFarsi",
                    "errorTags",
                ],
            },
        }
    },
    "required": ["grades"],
}


def grading_user(attempts: list[dict]) -> str:
    """attempts: [{id, englishText, referenceFarsi, learnerText|None}]"""
    blocks = []
    for a in attempts:
        learner = a.get("learnerText")
        learner_line = (
            f'  learner attempt (text): {learner}'
            if learner
            else "  learner attempt: see the attached audio recording, in order"
        )
        blocks.append(
            f"attemptId: {a['id']}\n"
            f"  english: {a['englishText']}\n"
            f"  reference persian: {a['referenceFarsi']}\n"
            f"{learner_line}"
        )
    return (
        f"Grade these {len(attempts)} attempts. Return one entry per attemptId, "
        "in the same order.\n\n" + "\n\n".join(blocks)
    )

# ---------------------------------------------------------------------------
# Word-by-word breakdown and acceptable alternatives
# ---------------------------------------------------------------------------

# Closed set, for the same reason the error tags are closed: free-form labels
# fragment and stop being groupable or stylable.
PARTS_OF_SPEECH = [
    "noun",
    "verb",
    "compound verb",
    "adjective",
    "adverb",
    "pronoun",
    "attached pronoun",
    "preposition",
    "question word",
    "conjunction",
    "number",
    "particle",
    "expression",
]


def breakdown_system() -> str:
    return f"""\
You annotate Persian sentences for an English-speaking learner, so they can see
which Persian word carries which part of the English meaning.

{REGISTER_RULES}

For each sentence produce two things.

1. "breakdown": the sentence split into meaning units, in Persian word order.

   UNIT RULES - these matter more than anything else:
   - A COMPOUND VERB IS ONE UNIT. Persian builds most verbs as noun + light
     verb, and splitting them produces nonsense. "بلند می‌شه" is one unit
     meaning "gets up" - never "tall" + "becomes". Likewise "زنگ می‌زنم" is
     "I call", not "bell" + "I hit"; "دوست دارم" is "I like", not "friend" +
     "I have".
   - An attached pronoun stays with its host: "خواهرت" is one unit, "your
     sister". Tag it "attached pronoun" when the clitic is the point.
   - A preposition plus its pronoun is one unit: "بهش" = "to him/her".
   - Ezâfe chains that form one idea stay together: "هوای تهران" = "Tehran's
     weather".
   - Otherwise split at word boundaries.

   Each unit has:
     fa        the Persian, exactly as it appears in the sentence
     translit  the same transliteration scheme as elsewhere
     en        what this unit contributes in English, in plain words
     pos       ONE of: {", ".join(PARTS_OF_SPEECH)}

2. "alternatives": one or two OTHER natural ways a native speaker could say the
   same English sentence, in the same spoken register. These exist so a learner
   whose answer differs from the reference can tell whether they were actually
   wrong. If the sentence has no genuinely different natural rendering, return
   an empty list rather than inventing a clumsy one.
"""


BREAKDOWN_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "items": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "id": {"type": "STRING"},
                    "breakdown": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "fa": {"type": "STRING"},
                                "translit": {"type": "STRING"},
                                "en": {"type": "STRING"},
                                "pos": {"type": "STRING", "enum": PARTS_OF_SPEECH},
                            },
                            "required": ["fa", "translit", "en", "pos"],
                            "propertyOrdering": ["fa", "translit", "en", "pos"],
                        },
                    },
                    "alternatives": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["id", "breakdown", "alternatives"],
                "propertyOrdering": ["id", "breakdown", "alternatives"],
            },
        }
    },
    "required": ["items"],
}


def breakdown_user(sentences: list[dict]) -> str:
    blocks = [
        f"id: {s['id']}\n  english: {s['englishText']}\n  persian: {s['farsiText']}"
        for s in sentences
    ]
    return (
        f"Annotate these {len(sentences)} sentences. Return one entry per id.\n\n"
        + "\n\n".join(blocks)
    )
