"""Structural validation for generated sentences.

Catches what a JSON schema cannot: wrong script, empty strings, duplicates,
transliteration that is secretly Persian script. This is the automated half of
quality control. The other half is you reading 20 of them.
"""

from __future__ import annotations

import re
import unicodedata

from core.taxonomy import ERROR_TAG_KEYS

# Persian/Arabic block plus the Persian-specific letters and ZWNJ.
PERSIAN_RE = re.compile(r"[؀-ۿ‌]")
LATIN_RE = re.compile(r"[A-Za-z]")

# Bookish forms that mean the register instruction was ignored. Not exhaustive —
# a tripwire, not a grammar checker.
BOOKISH_MARKERS = {
    "می‌روم": "می‌رم",
    "می‌روی": "می‌ری",
    "می‌خواهم": "می‌خوام",
    "می‌گویم": "می‌گم",
    "می‌کنم": None,   # fine in speech, listed for reference only
    "نمی‌باشد": "نیست",
    "می‌باشد": "هست",
}

# Register detection.
#
# Two hard-won constraints shape this:
#
# 1. Matching must respect word boundaries. Persian is written without spaces
#    inside words, so a naive substring test for یک (one) also fires inside
#    کوچیک (small), نزدیک (near) and یکی (someone) — which produced a 15% false
#    positive rate before this was fixed.
#
# 2. Only forms that are genuinely WRITTEN-ONLY count as problems. یک, به من,
#    تمام and تهران all appear in ordinary speech; flagging them tells the
#    learner their good sentences are bad.

_PERSIAN_CHARS = "\u0600-\u06FF\u200c"


def _word_pattern(word: str) -> re.Pattern:
    """Match `word` only as a whole Persian word, not inside a longer one."""
    return re.compile(
        f"(?<![{_PERSIAN_CHARS}]){re.escape(word)}(?![{_PERSIAN_CHARS}])"
    )


# Uncontracted verb forms and copulas that essentially never occur in casual
# speech. Seeing one means the register instruction was ignored.
WRITTEN_ONLY = {
    "می\u200cباشد": "mibâshad (use هست)",
    "نمی\u200cباشد": "nemibâshad (use نیست)",
    "می\u200cروم": "miravam (use می\u200cرم)",
    "می\u200cروی": "miravi (use می\u200cری)",
    "می\u200cرود": "miravad (use می\u200cره)",
    "می\u200cخواهم": "mikhâham (use می\u200cخوام)",
    "می\u200cخواهد": "mikhâhad (use می\u200cخواد)",
    "می\u200cگویم": "miguyam (use می\u200cگم)",
    "می\u200cگوید": "miguyad (use می\u200cگه)",
    "می\u200cشوم": "mishavam (use می\u200cشم)",
    "می\u200cدهم": "midaham (use می\u200cدم)",
    "می\u200cآیم": "miâyam (use میام)",
    "است": "ast (in speech this attaches as ـه: خوبه)",
}

# Positive signals. Their presence is reassurance, not a requirement — plenty of
# natural sentences contain none of them.
SPOKEN_MARKERS = {
    "خونه": "khune",
    "نون": "nun",
    "می\u200cرم": "miram",
    "می\u200cری": "miri",
    "می\u200cره": "mire",
    "می\u200cخوام": "mikhâm",
    "می\u200cگم": "migam",
    "بهش": "behesh",
    "بهت": "behet",
    "بهم": "beham",
    "ازش": "azesh",
    "واسه": "vâse",
    "دیگه": "dige",
    "چیکار": "chikâr",
    "هیچی": "hichi",
    "یه": "ye",
    "اگه": "age",
    "الان": "alân",
    "تموم": "tamum",
    "کوچیک": "kuchik",
    "می\u200cدونم": "midunam",
    "می\u200cشه": "mishe",
    "نمی\u200cشه": "nemishe",
}

_WRITTEN_PATTERNS = {w: _word_pattern(w) for w in WRITTEN_ONLY}
_SPOKEN_PATTERNS = {w: _word_pattern(w) for w in SPOKEN_MARKERS}


def register_report(farsi: str) -> tuple[list[str], list[str]]:
    """Return (spoken markers found, written-only forms found).

    Written-only findings are the actionable ones. Lets a learner who is not
    confident judging naturalness check the register mechanically rather than
    by feel.
    """
    spoken = [
        SPOKEN_MARKERS[w] for w, pattern in _SPOKEN_PATTERNS.items()
        if pattern.search(farsi)
    ]
    written = [
        WRITTEN_ONLY[w] for w, pattern in _WRITTEN_PATTERNS.items()
        if pattern.search(farsi)
    ]
    return spoken, written


REQUIRED_FIELDS = (
    "englishText",
    "farsiText",
    "finglish",
    "literalGloss",
    "difficulty",
    "situation",
    "grammarTags",
)


def normalise_persian(text: str) -> str:
    """Arabic Yeh/Kaf -> Persian Yeh/Kaf, NFC, collapse whitespace.

    Models mix Arabic ي/ك with Persian ی/ک. Left alone this splits duplicate
    detection and makes on-device text comparison unreliable.
    """
    text = unicodedata.normalize("NFC", text)
    text = text.replace("ي", "ی").replace("ك", "ک")
    text = text.replace("ى", "ی")
    # Strip Arabic diacritics/harakat — Persian is written without them.
    text = re.sub(r"[ً-ْٰ]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def check_sentence(s: dict) -> list[str]:
    """Return a list of problems. Empty list means the sentence is structurally fine."""
    problems: list[str] = []

    for field in REQUIRED_FIELDS:
        if field not in s:
            problems.append(f"missing field '{field}'")
    if problems:
        return problems

    if not str(s["englishText"]).strip():
        problems.append("englishText is empty")
    if not str(s["farsiText"]).strip():
        problems.append("farsiText is empty")

    farsi = str(s["farsiText"])
    if not PERSIAN_RE.search(farsi):
        problems.append("farsiText contains no Persian script")
    if LATIN_RE.search(farsi):
        problems.append(f"farsiText contains Latin letters: {farsi!r}")

    finglish = str(s["finglish"])
    if PERSIAN_RE.search(finglish):
        problems.append("finglish contains Persian script (should be Latin only)")
    if not LATIN_RE.search(finglish):
        problems.append("finglish contains no Latin letters")

    if PERSIAN_RE.search(str(s["englishText"])):
        problems.append("englishText contains Persian script")

    difficulty = s["difficulty"]
    if not isinstance(difficulty, int) or not 1 <= difficulty <= 5:
        problems.append(f"difficulty out of range: {difficulty!r}")

    tags = s["grammarTags"]
    if not isinstance(tags, list):
        problems.append("grammarTags is not a list")
    else:
        unknown = [t for t in tags if t not in ERROR_TAG_KEYS]
        if unknown:
            problems.append(f"unknown grammar tags: {unknown}")
        if not tags:
            problems.append("grammarTags is empty")

    for bookish, spoken in BOOKISH_MARKERS.items():
        if spoken and bookish in farsi:
            problems.append(f"bookish form {bookish!r} (expected {spoken!r})")

    return problems


def dedupe(sentences: list[dict]) -> tuple[list[dict], int]:
    """Drop duplicates by normalised Persian and by lowercased English."""
    seen_fa: set[str] = set()
    seen_en: set[str] = set()
    kept: list[dict] = []
    dropped = 0
    for s in sentences:
        fa = normalise_persian(str(s.get("farsiText", "")))
        en = str(s.get("englishText", "")).strip().lower().rstrip(".!?")
        if not fa or fa in seen_fa or en in seen_en:
            dropped += 1
            continue
        seen_fa.add(fa)
        seen_en.add(en)
        kept.append(s)
    return kept, dropped


def partition(sentences: list[dict]) -> tuple[list[dict], list[tuple[dict, list[str]]]]:
    """Split into (clean, [(sentence, problems)])."""
    clean, bad = [], []
    for s in sentences:
        problems = check_sentence(s)
        if problems:
            bad.append((s, problems))
        else:
            s["farsiText"] = normalise_persian(str(s["farsiText"]))
            clean.append(s)
    return clean, bad
