"""Content-word exposure: which words has the learner actually met, and how often.

A word met once is a word SM-2 never reinforces, so the deck builds recognition
where it should build recall. Measuring that is harder than counting tokens,
for two reasons discovered the hard way:

* **Surface forms overstate the problem.** خونه, خونه‌م and خونه‌تون look like
  three words and are one. Counting raw forms put 54% of the vocabulary at
  "seen once"; most of those were inflections of words the deck covers well.
* **English glosses cannot stand in for lemmas.** The word maps gloss verbs as
  whole phrases — "did not read", "do you like", "are you well" — so each
  inflection becomes its own meaning.

So this works on the Persian, over content words only (noun, adjective,
adverb), where the morphology is regular clitics rather than irregular verb
stems. Verbs have their own report in core/syllabus.py:coverage().

The stripping is guarded: a suffix comes off only when what remains is a word
attested somewhere else in the deck. Without that guard دست loses its ت and
becomes دس, because a final ت is also the possessive clitic.
"""

from __future__ import annotations

import collections

ZWNJ = "‌"
CONTENT_POS = {"noun", "adjective", "adverb"}

# A gloss beginning "is"/"are" marks a word carrying the spoken copula —
# اشتباهه is اشتباه + ه. Stripping ـه from every word would wreck خونه, so the
# gloss is what licenses it.
COPULA_GLOSS = ("is ", "are ", "am ")
# The gloss may carry Persian word order — "big is", "hard is" — so a trailing
# copula counts too.
COPULA_GLOSS_END = (" is", " are", " am")
COPULAS = ("ست", "ه")
COMPARATIVES = ("ترین", "تر")

OBJECT_MARKERS = ("رو", "و")
POSSESSIVES = ("شون", "تون", "مون", "ام", "ات", "اش", "م", "ت", "ش")
PLURALS = ("هایی", "های", "ها", "ا")


def bare(word: str) -> str:
    return (word or "").strip().strip("؟،.!?").replace(ZWNJ, "")


def _peel(word: str, suffixes: tuple[str, ...]) -> list[str]:
    """The word itself, plus it with EACH matching suffix removed.

    Every match is offered, not just the first: دخترو ends with both رو and و,
    and stopping at رو strips it to دخت, which is not a word, so دخترو never
    rejoins دختر.
    """
    out = [word]
    for suffix in suffixes:
        if len(word) > len(suffix) + 1 and word.endswith(suffix):
            out.append(word[: -len(suffix)])
    return out


def stem(word: str, attested: collections.Counter, gloss: str = "") -> str:
    """Strip clitics, but only down to a form the deck actually contains.

    Tries every combination of the suffix groups so that لباسمو reaches لباس —
    intermediate forms need not be words, only the result.
    """
    word = bare(word)
    lowered = (gloss or "").strip().lower()
    is_copula = lowered.startswith(COPULA_GLOSS) or lowered.endswith(COPULA_GLOSS_END)
    copula = COPULAS if is_copula else ()
    candidates = [
        c
        for cop in _peel(word, copula)
        for obj in _peel(cop, OBJECT_MARKERS)
        for poss in _peel(obj, POSSESSIVES)
        for plural in _peel(poss, PLURALS)
        for c in _peel(plural, COMPARATIVES)
    ]
    # Shortest attested candidate is the most-stripped real word.
    real = [c for c in candidates if c != word and attested.get(c)]
    return min(real, key=len) if real else word


_VERBAL_GLOSS_START = (
    "i ", "you ", "he ", "she ", "we ", "they ", "it ",
    "do ", "does ", "did ", "don't", "doesn't", "didn't", "to ",
)


def _looks_verbal(gloss: str) -> bool:
    """True when a gloss reads as a verb phrase despite its part-of-speech tag.

    The derived maps still mislabel some verbs as nouns — بخر "buy", اومدی
    "came" — and they would otherwise be counted as vocabulary.
    """
    lowered = (gloss or "").strip().lower()
    return lowered.startswith(_VERBAL_GLOSS_START)


def content_units(sentences: list[dict]) -> list[dict]:
    return [
        unit
        for sentence in sentences
        if sentence.get("breakdown")
        for unit in sentence["breakdown"]
        if unit.get("pos") in CONTENT_POS and not _looks_verbal(unit.get("en"))
    ]


def exposure(sentences: list[dict]) -> collections.Counter:
    """How many times each content lemma appears across the deck."""
    units = content_units(sentences)
    attested = collections.Counter(bare(u["fa"]) for u in units)
    counts: collections.Counter = collections.Counter()
    for unit in units:
        counts[stem(unit["fa"], attested, unit.get("en"))] += 1
    return counts


def glosses(sentences: list[dict]) -> dict[str, str]:
    """The commonest English gloss for each lemma, for reporting."""
    units = content_units(sentences)
    attested = collections.Counter(bare(u["fa"]) for u in units)
    seen: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for unit in units:
        seen[stem(unit["fa"], attested, unit.get("en"))][(unit.get("en") or "").strip()] += 1
    return {lemma: c.most_common(1)[0][0] for lemma, c in seen.items() if c}
