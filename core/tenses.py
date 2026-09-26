"""Detect which tense or structure a sentence uses.

Written after reporting that the deck held five past-progressive sentences when
it holds thirty-two. The pattern had required داشتن and the می- verb to be
adjacent, but Persian puts the object between them — داشتیم شام می‌خوردیم. The
content was right and the measurement was wrong, which is the worse failure of
the two because it sends you off writing sentences you do not need.

So every pattern here is written to be checked: tools/tenses.py --show prints
the sentences a pattern matched, and anything whose samples do not read as the
structure named is a bug in the pattern, not a gap in the deck.

These are surface regexes over an unvocalised script with no morphological
analyser. They are a signal, not a parse. Where a structure cannot be
distinguished reliably — بـ- subjunctive without a modal trigger, the clitic
copula ـه — it is left out rather than guessed at.
"""

from __future__ import annotations

import re

FA = r"[؀-ۿ]"
Z = "‌"
B = rf"(?<!{FA})"
E = rf"(?!{FA})"
ENDING = r"(?:یم|ید|ین|ند|م|ی|ه|ن|د)?"

# Past stems of the core verbs, longest first so رفت wins over ر.
PAST_STEMS = (
    "برداشت|برگشت|خوابید|شناخت|فروخت|گذاشت|نشست|پرسید|فهمید|خواست|تونست|دونست|"
    "رسید|نوشت|آورد|گرفت|خورد|خوند|موند|خرید|اومد|گشت|بست|گفت|دید|داد|کرد|شد|رفت|برد|زد|داشت|بود"
)

# A داشتن auxiliary and a می- verb in the same clause. Up to four words may sit
# between them, which is where the object goes.
_PROGRESSIVE = rf"{B}داشت{ENDING}{E}(?:\s+{FA}+){{0,4}}\s+ن?می{Z}?{FA}+"

PATTERNS: dict[str, str] = {
    "present": rf"{B}ن?می{Z}?(?!(?:{PAST_STEMS}){ENDING}{E}){FA}+",
    "present-have-be": rf"{B}(?:ن?دار(?:م|ی|ه|یم|ید|ین|ن)|هست\S*|نیست\S*){E}",
    "past-simple": rf"{B}(?<!می)(?<!می{Z})ن?(?:{PAST_STEMS}){ENDING}{E}",
    "past-progressive": _PROGRESSIVE,
    "past-perfect": rf"ه{Z}?\s*بود{ENDING}{E}",
    "imperative": (
        rf"{B}(?:برو|برید|بیا|بیاید|بیاین|بگو|بگید|بده|بدید|بگیر|ببین|بذار|بشین|"
        rf"بخور|بپرس|بزن|بیار|بمون|ببخشید|بفرمایید|بفرما|نرو|نکن|نترس|نباش|نخور|نگو){E}"
    ),
    "subjunctive-modal": rf"{B}ن?باید{E}|{B}ن?می{Z}?(?:خوا|تون)\S*(?:\s+{FA}+){{0,2}}\s+ن?ب{FA}+",
    "conditional": rf"{B}(?:اگه|اگر){E}",
    "negative": rf"{B}ن(?:می)?{Z}?{FA}+{E}",
    "question": r"؟",
    "passive": rf"{B}ن?(?:{PAST_STEMS})ه{Z}?\s+ن?(?:شد{ENDING}|شده|می{Z}?ش(?:ه|ود)){E}",
    # گم شده / خراب شده / تموم شده. Not a passive — the subject changed state
    # rather than had something done to it — but the same shape to a learner,
    # and far commoner in speech than the participial passive above.
    # ید is excluded from the endings here: شدید is far commoner as the
    # adjective "severe" (سرفه شدید) than as "you became", and it was matching
    # "a severe cough" as a change of state.
    "resultative": rf"{B}(?!(?:{PAST_STEMS})ه{E})\S+\s+ن?(?:شده|شد(?:یم|ین|ند|م|ی|ه|ن)?){E}",
}

COMPILED = {name: re.compile(p) for name, p in PATTERNS.items()}

# Read in the report, so a low number is not mistaken for a gap when the
# structure is simply rare in speech by design.
NOTES = {
    "past-progressive": "داشتم می‌رفتم — the object sits between the two parts",
    "passive": "the participial passive; spoken Persian largely avoids it",
    "resultative": "گم شده, خراب شده — a change of state, and the commoner form",
    "present-have-be": "داشتن and بودن take no می- prefix",
    "subjunctive-modal": "only counted after a modal, so this undercounts",
}


def matches(sentence: dict, name: str) -> bool:
    return bool(COMPILED[name].search(sentence.get("farsiText", "")))


def distribution(sentences: list[dict]) -> dict[str, int]:
    return {
        name: sum(1 for s in sentences if pattern.search(s.get("farsiText", "")))
        for name, pattern in COMPILED.items()
    }


def examples(sentences: list[dict], name: str, limit: int = 8) -> list[dict]:
    pattern = COMPILED[name]
    return [s for s in sentences if pattern.search(s.get("farsiText", ""))][:limit]
