"""Tidy the per-word glosses that derive_breakdown.py produces.

The derived breakdowns come from splitting a whole-sentence literal gloss and
aligning it to Persian words. That alignment is faithful to Persian word order,
which is exactly what makes some results unreadable as English chips:

    سرم        ->  "head my"      (the possessive clitic trails)
    وای‌فای     ->  "Wi Fi of"     (the ezâfe became a dangling "of")
    ندادیم     ->  "not we gave"  (the negation prefix leads)

Every rule here rewrites a *mechanical* artefact of that alignment. None of
them guesses at meaning, and anything not matching a known shape is returned
untouched — an awkward gloss beats a confidently wrong one, because the learner
cannot tell the difference.

Two things a first attempt got wrong, both worth keeping in mind:

1. Tense comes from the ENGLISH verb form, not from Persian morphology. نمی is
   not reliably a present negative: نمی‌خواست is past ("didn't want"). Reading
   the tense off "wanted" instead is correct by construction.
2. Modals and copulas must never reach the lexical-verb rules, or you get
   "I don't can" and "I didn't was".
"""

from __future__ import annotations

import re
import string

POSSESSIVES = {"my", "your", "his", "her", "our", "their", "its"}
PRONOUNS = {"I", "you", "he", "she", "we", "they", "it"}
THIRD_SINGULAR = {"he", "she", "it"}

# The râ marker was glossed ten different ways across the deck — [ra], RA,
# (ra), OBJ, "direct object" and so on. One form now.
#
# Matching is on the normalised spelling AND on the Persian being رو/را, because
# رو is also the ordinary word "on"; that sense must survive untouched.
OBJECT_MARKER = "[object]"
_RA_WORDS = {"رو", "را"}
_MARKER_SPELLINGS = {
    "ra", "obj", "object", "object marker", "ra marker", "direct object",
    "ra particle", "object particle", "accusative",
}


def _is_object_marker(farsi: str, english: str) -> bool:
    if farsi.strip() not in _RA_WORDS:
        return False
    stripped = english.strip().strip("[](){}<>").strip().lower()
    return stripped in _MARKER_SPELLINGS

# Past form -> base. A negated past takes "didn't" plus the base.
_PAST = {
    "gave": "give", "became": "become", "did": "do", "had": "have",
    "took": "take", "went": "go", "came": "come", "said": "say",
    "knew": "know", "saw": "see", "wanted": "want", "sat": "sit",
    "understood": "understand", "thought": "think", "brought": "bring",
    "found": "find", "made": "make", "told": "tell", "got": "get",
    "slept": "sleep", "ate": "eat", "bought": "buy", "paid": "pay",
    "recognized": "recognise", "worked": "work", "asked": "ask",
    "answered": "answer", "arrived": "arrive", "opened": "open",
}

# Third-person present -> base. A negated present takes "doesn't"/"don't".
_THIRD_PRESENT = {
    "does": "do", "goes": "go", "takes": "take", "comes": "come",
    "becomes": "become", "has": "have", "gives": "give", "says": "say",
    "knows": "know", "wants": "want", "sees": "see", "puts": "put",
    "works": "work", "sleeps": "sleep", "eats": "eat", "makes": "make",
}

# Bare present forms that can follow a subject pronoun unchanged.
_BARE_PRESENT = {
    "do", "go", "take", "come", "become", "have", "give", "say", "know",
    "want", "see", "put", "work", "sleep", "eat", "make", "understand",
    "think", "remember", "buy", "pay", "ask", "answer",
}

_MODALS = {
    "can": "can't", "could": "couldn't", "must": "mustn't",
    "should": "shouldn't", "will": "won't", "would": "wouldn't",
    "may": None, "might": None,   # no safe contraction — leave these alone
}

# Never treated as a lexical verb by the negation rules.
_COPULAS = {"is", "are", "was", "were", "am", "be", "been", "being"}


def _split_trailing_punctuation(token: str) -> tuple[str, str]:
    stripped = token.rstrip(string.punctuation + "؟،")
    return stripped, token[len(stripped):]


def _negate_verb(verb: str, subject: str | None) -> list[str] | None:
    """Return [aux, base] for a lexical verb, or None when it is not safe."""
    word, tail = _split_trailing_punctuation(verb)
    lowered = word.lower()

    if lowered in _COPULAS or lowered in _MODALS:
        return None

    if lowered in _PAST:
        return ["didn't", _PAST[lowered] + tail]
    if lowered in _THIRD_PRESENT:
        return ["doesn't", _THIRD_PRESENT[lowered] + tail]
    if lowered in _BARE_PRESENT:
        if subject is None:
            # Imperative ("don't become") or third person ("doesn't become")?
            # Nothing in the gloss distinguishes them, so leave it alone.
            return None
        aux = "doesn't" if subject in THIRD_SINGULAR else "don't"
        return [aux, word + tail]
    return None


# "her" and "his" are possessive OR object pronouns. After a preposition they
# are objects and the gloss is already correct: "to her" must not become
# "her to".
_PREPOSITIONS = {
    "to", "for", "from", "with", "at", "in", "on", "about", "of", "by",
    "into", "onto", "toward", "towards", "near", "under", "over", "behind",
}


def _fix_possessive(tokens: list[str]) -> list[str] | None:
    """"head my" -> "my head". Persian attaches the possessive; English leads."""
    if len(tokens) < 2 or tokens[-1] not in POSSESSIVES:
        return None

    # "to her" is a preposition plus an object pronoun and is already correct.
    # The guard is only for that two-token shape: in "of headache my" the "of"
    # is a stray ezâfe, not a preposition governing "my".
    if len(tokens) == 2 and tokens[0].lower() in _PREPOSITIONS:
        return None

    body = tokens[:-1]
    if len(body) > 1 and body[0].lower() == "of":
        body = body[1:]
    return [tokens[-1]] + body


def _fix_dangling_of(tokens: list[str]) -> list[str] | None:
    """"weather of" -> "weather".

    The ezâfe links two words; the literal gloss renders it as a trailing "of"
    on the first. The next chip already shows the link, so the "of" is noise.
    A lone "of" is left alone — that is a real preposition.
    """
    if len(tokens) >= 2 and tokens[-1].lower() == "of":
        return tokens[:-1]
    return None


def _fix_negation(tokens: list[str]) -> list[str] | None:
    lowered = [t.lower() for t in tokens]
    if "not" not in lowered:
        return None

    # Copulas and "have", exact two-token forms only.
    exact = {
        ("is", "not"): ["isn't"], ("was", "not"): ["wasn't"],
        ("are", "not"): ["aren't"], ("were", "not"): ["weren't"],
        ("am", "not"): ["am", "not"],
        ("has", "not"): ["doesn't", "have"], ("have", "not"): ["don't", "have"],
    }
    if tuple(lowered) in exact:
        return exact[tuple(lowered)]

    # "it was not" -> "it wasn't";  "necessary was not" -> "wasn't necessary"
    for pair, contraction in ((("was", "not"), "wasn't"), (("is", "not"), "isn't"),
                              (("are", "not"), "aren't"), (("were", "not"), "weren't")):
        if len(tokens) > 2 and tuple(lowered[-2:]) == pair:
            head = tokens[:-2]
            if len(head) == 1 and (head[0] in PRONOUNS or head[0].lower() == "there"):
                return head + [contraction]
            if not any(t in PRONOUNS for t in head):
                return [contraction] + head
            return None

    index = lowered.index("not")

    # "not I can" -> "I can't";  "not must" -> "mustn't"
    modal_slot = tokens[index + 1:]
    if index == 0 and len(modal_slot) in (1, 2):
        subject = modal_slot[0] if modal_slot[0] in PRONOUNS else None
        modal_word = modal_slot[1] if subject else modal_slot[0]
        contraction = _MODALS.get(modal_word.lower())
        if contraction and len(modal_slot) == (2 if subject else 1):
            return ([subject] if subject else []) + [contraction]

    # "not we gave" -> "we didn't give"
    if index == 0 and len(tokens) == 3 and tokens[1] in PRONOUNS:
        negated = _negate_verb(tokens[2], tokens[1])
        return [tokens[1]] + negated if negated else None

    # "not I did understand" -> "I didn't understand"
    if (index == 0 and len(tokens) == 4 and tokens[1] in PRONOUNS
            and lowered[2] in {"did", "do", "does"}
            and lowered[3] not in _COPULAS and lowered[3] not in _MODALS):
        aux = "didn't" if lowered[2] == "did" else (
            "doesn't" if tokens[1] in THIRD_SINGULAR else "don't")
        return [tokens[1], aux, tokens[3]]

    # "not goes" -> "doesn't go"
    if index == 0 and len(tokens) == 2:
        negated = _negate_verb(tokens[1], None)
        return negated

    # "work not it does" -> "doesn't work" (a negated compound verb)
    if 0 < index < len(tokens) - 1:
        head, tail = tokens[:index], tokens[index + 1:]
        head_ok = head and not any(
            t in PRONOUNS or t.lower() in _COPULAS or t.lower() in _MODALS
            or t.lower() in _PAST or t.lower() in _THIRD_PRESENT for t in head)
        if head_ok and len(tail) == 2 and tail[0] in PRONOUNS:
            negated = _negate_verb(tail[1], tail[0])
            if negated:
                return [negated[0]] + head

    # "come not" -> "not come", but never for a modal or copula: "must not"
    # and "was not" are already correct English and the flip breaks them.
    if index == len(tokens) - 1 and len(tokens) == 2:
        first = tokens[0].lower()
        if first not in _MODALS and first not in _COPULAS:
            return ["not", tokens[0]]

    return None


def tidy(farsi: str, english: str) -> str:
    """Return a cleaned gloss, or the original when no rule applies."""
    english = re.sub(r"\s+", " ", (english or "").strip())
    if not english:
        return english

    if _is_object_marker(farsi, english):
        return OBJECT_MARKER

    tokens = english.split()
    for rule in (_fix_negation, _fix_possessive, _fix_dangling_of):
        replacement = rule(tokens)
        if replacement:
            tokens = replacement

    return " ".join(tokens).strip()
