"""The knowledge base: words, verbs, pronoun tables and grammar notes.

kb/ holds what a person writes — a word list, two stems per verb, the pronoun
tables, short notes — and this module turns it into what the app needs: every
verb conjugated in every tense spoken Persian uses, with a transliteration and
an English gloss for each cell.

Conjugation is generated rather than typed out because a typed paradigm is
ninety verbs times twelve tenses times six people, and one slip in that many
cells is a wrong ending drilled until it is automatic. Generated, a mistake is
in a rule, it shows up in every verb at once, and tools/test_kb.py pins the
forms that must not move. What does not follow the rules — اومدن، آوردن،
بودن، داشتن — is written out in kb/verbs.json and the rules step aside.

Spoken Tehrani throughout: می‌رم not می‌روم, میام not می‌آیم, 2pl ـین with
ـید accepted, 3pl ـن never ـند.
"""

from __future__ import annotations

import functools
import json
import pathlib
import re
import uuid

KB = pathlib.Path(__file__).resolve().parent.parent / "kb"
ZWNJ = "‌"

PERSONS = [
    {"fa": "من", "en": "I"},
    {"fa": "تو", "en": "you"},
    {"fa": "اون", "en": "he/she"},
    {"fa": "ما", "en": "we"},
    {"fa": "شما", "en": "you (pl.)"},
    {"fa": "اونا", "en": "they"},
]
# The imperative is said to تو and to شما only.
IMPERATIVE_PERSONS = (1, 4)

# key, Persian label, English label, level, drilled as a card.
# The negative subjunctive is in the tables but not dealt: it is the
# subjunctive with نـ for بـ, and the imperative negative already drills that.
TENSES = [
    ("present", "حال", "present", 1, True),
    ("presentNeg", "حال · منفی", "present, negative", 1, True),
    ("past", "گذشتهٔ ساده", "simple past", 1, True),
    ("pastNeg", "گذشتهٔ ساده · منفی", "simple past, negative", 1, True),
    ("imp", "امری", "imperative", 1, True),
    ("impNeg", "امری · منفی", "imperative, negative", 1, True),
    ("subj", "التزامی", "subjunctive", 2, True),
    ("subjNeg", "التزامی · منفی", "subjunctive, negative", 2, False),
    ("presProg", "حال مستمر", "present progressive", 2, True),
    ("imperfect", "گذشتهٔ استمراری", "past habitual", 2, True),
    ("pastProg", "گذشتهٔ مستمر", "past progressive", 3, True),
    ("pastPerf", "گذشتهٔ بعید", "past perfect", 3, True),
]
TENSE_KEYS = [t[0] for t in TENSES]

# Endings, Persian and transliterated. After a stem ending in ا the vowel
# changes the ending: می‌خوام, می‌خواد — not می‌خواام, می‌خواه.
_AFTER_CONSONANT = [("م", "am"), ("ی", "i"), ("ه", "e"), ("یم", "im"), ("ین", "in"), ("ن", "an")]
_AFTER_VOWEL = [("م", "m"), ("ی", "y"), ("د", "d"), ("یم", "ym"), ("ین", "yn"), ("ن", "n")]
_PAST = [("م", "am"), ("ی", "i"), ("", ""), ("یم", "im"), ("ین", "in"), ("ن", "an")]

# داشتن as the auxiliary of the progressive: دارم می‌رم, داشتم می‌رفتم.
_AUX_PRESENT = [("دارم", "dâram"), ("داری", "dâri"), ("داره", "dâre"),
                ("داریم", "dârim"), ("دارین", "dârin"), ("دارن", "dâran")]
_AUX_PAST = [("داشتم", "dâshtam"), ("داشتی", "dâshti"), ("داشت", "dâsht"),
             ("داشتیم", "dâshtim"), ("داشتین", "dâshtin"), ("داشتن", "dâshtan")]

# The two light verbs whose subjunctive and imperative drop بـ inside a
# compound: کار کنم, بلند شو — but زنگ بزن, یاد بگیرم.
_BARE_IN_COMPOUND = {"کردن", "شدن"}


def fix(text: str) -> str:
    return text.replace("~", ZWNJ)


def _pair(value: str) -> tuple[str, str]:
    """'رفت raft' -> ('رفت', 'raft'); 'داشته باشم dâshte bâsham' splits at the Latin."""
    match = re.match(r"([؀-ۿ‌~ ]+?)\s+([^؀-ۿ\s].*)$", value)
    if not match:
        raise ValueError(f"expected 'Persian transliteration', got {value!r}")
    return fix(match.group(1)), match.group(2)


def _ends_in_vowel(fa: str) -> bool:
    return fa.endswith(("ا", "آ"))


def _with(stem: tuple[str, str], endings) -> list[tuple[str, str]]:
    fa, tr = stem
    return [(fa + e_fa, tr + e_tr) for e_fa, e_tr in endings]


def _present_endings(stem_fa: str):
    return _AFTER_VOWEL if _ends_in_vowel(stem_fa) else _AFTER_CONSONANT


def _plural_imperative(stem: tuple[str, str]) -> tuple[str, str]:
    fa, tr = stem
    return (fa + "ین", tr + ("yn" if _ends_in_vowel(fa) else "in"))


def _only(cells: list, persons=IMPERATIVE_PERSONS) -> list:
    return [cell if i in persons else None for i, cell in enumerate(cells)]


def _imperative(sing: tuple[str, str], plural_stem: tuple[str, str]) -> list:
    cells = [None] * 6
    cells[1] = sing
    cells[4] = _plural_imperative(plural_stem)
    return cells


def _simple(verb: dict, compound: bool = False) -> dict[str, list]:
    """Every tense of a simple verb, as six (Persian, transliteration) cells.

    `compound` is True when the verb is the light verb of a compound, which
    changes two things: کردن and شدن lose their بـ, and a tense skipped only
    because nobody says it alone (شدن's imperative) comes back.
    """
    past = _pair(verb["past"])
    pres = _pair(verb["pres"])
    prefix = _pair(verb["prefix"]) if verb.get("prefix") else ("", "")
    full = {k: _pair(v) for k, v in verb.get("full", {}).items()}
    over = verb.get("over", {})
    skip = set(verb.get("skip", ()))
    if not compound:
        skip |= set(verb.get("skipSimple", ()))
    bare = (compound and verb["inf"] in _BARE_IN_COMPOUND) or bool(verb.get("prefix"))
    b = "" if bare else verb.get("b", "be")
    b_imp = "" if bare else verb.get("bimp", b)
    b_fa = "" if bare else "ب"
    p_fa, p_tr = prefix

    def join(*parts: tuple[str, str]) -> tuple[str, str]:
        return "".join(p[0] for p in parts), "".join(p[1] for p in parts)

    mi = full.get("presMi") or join(prefix, ("می" + ZWNJ, "mi"), pres)
    nemi = full.get("presNeg") or join(prefix, ("نمی" + ZWNJ, "nemi"), pres)
    impf = full.get("impf") or join(prefix, ("می" + ZWNJ, "mi"), past)
    subj = full.get("subj") or join(prefix, (b_fa, b), pres)
    subj_neg = full.get("subjNeg") or join(prefix, ("ن", "na"), pres)
    imp_stem = _pair(verb["imp"]) if verb.get("imp") else pres
    if compound and verb.get("cimp"):
        imp_stem = _pair(verb["cimp"])
    imp = full.get("imp") or join(prefix, (b_fa, b_imp), imp_stem)
    imp_neg = full.get("impNeg") or join(prefix, ("ن", "na"), imp_stem)
    past_full = join(prefix, past)
    past_neg = full.get("pastNeg") or join(prefix, ("ن", "na"), past)
    # The imperative plural is the subjunctive's stem plus ـین (برین,
    # بیاین) except inside a کردن/شدن compound, where the bare stem
    # carries it: بلند شین.
    plural = subj if not (compound and verb.get("cimp")) else join(prefix, pres)

    forms: dict[str, list] = {
        "present": _with(mi, _present_endings(mi[0])),
        "presentNeg": _with(nemi, _present_endings(nemi[0])),
        "past": _with(past_full, _PAST),
        "pastNeg": _with(past_neg, _PAST),
        "imperfect": _with(impf, _PAST),
        "subj": _with(subj, _present_endings(subj[0])),
        "subjNeg": _with(subj_neg, _present_endings(subj_neg[0])),
        "imp": _imperative(imp, plural),
        "impNeg": _imperative(imp_neg, subj_neg),
    }
    for key, text in over.items():
        forms[key] = [_pair(cell) if cell != "-" else None for cell in text.split("|")]

    # Built from the tenses above, so an override reaches them too: اومدن's
    # میام gives دارم میام without being written out twice.
    forms["presProg"] = [
        (f"{a_fa} {fa}", f"{a_tr} {tr}")
        for (a_fa, a_tr), (fa, tr) in zip(_AUX_PRESENT, forms["present"])
    ]
    forms["pastProg"] = [
        (f"{a_fa} {fa}", f"{a_tr} {tr}")
        for (a_fa, a_tr), (fa, tr) in zip(_AUX_PAST, forms["imperfect"])
    ]
    perfect = join(past_full, ("ه", "e"))
    forms["pastPerf"] = [
        (f"{perfect[0]} بود{e_fa}", f"{perfect[1]} bud{e_tr}") for e_fa, e_tr in _PAST
    ]
    for key in skip:
        forms[key] = None
    return forms


def _compound(verb: dict, by_inf: dict) -> dict[str, list]:
    nominal = _pair(verb["nominal"])
    light = _simple(by_inf[verb["light"]], compound=True)
    skip = set(verb.get("skip", ()))
    out: dict[str, list] = {}
    for key in TENSE_KEYS:
        cells = light.get(key)
        if key in skip or cells is None:
            out[key] = None
            continue
        out[key] = [
            None if cell is None else (f"{nominal[0]} {cell[0]}", f"{nominal[1]} {cell[1]}")
            for cell in cells
        ]
        # The progressive puts داشتن before the nominal: دارم کار می‌کنم.
        if key in ("presProg", "pastProg"):
            aux = _AUX_PRESENT if key == "presProg" else _AUX_PAST
            base = light["present" if key == "presProg" else "imperfect"]
            out[key] = [
                (f"{a_fa} {nominal[0]} {fa}", f"{a_tr} {nominal[1]} {tr}")
                for (a_fa, a_tr), (fa, tr) in zip(aux, base)
            ]
    return out


# --- English -------------------------------------------------------------------

_SUBJECTS = [p["en"] for p in PERSONS]
_BE = ["am", "are", "is", "are", "are", "are"]
_WAS = ["was", "were", "was", "were", "were", "were"]
_DO = ["don't", "don't", "doesn't", "don't", "don't", "don't"]
_ING = {"be": "being", "begin": "beginning", "forget": "forgetting", "die": "dying", "lie": "lying"}

_DEFAULT_EN = {
    "present": "{S} {s}",
    "presentNeg": "{S} {do} {base}",
    "past": "{S} {past}",
    "pastNeg": "{S} didn't {base}",
    "imperfect": "{S} used to {base}",
    "subj": "(that) {S} {base}",
    "subjNeg": "(that) {S} not {base}",
    "imp": "{base}!",
    "impNeg": "don't {base}!",
    "presProg": "{S} {be} {ing}",
    "pastProg": "{S} {was} {ing}",
    "pastPerf": "{S} had {pp}",
}


def _head(phrase: str) -> tuple[str, str]:
    head, _, tail = phrase.partition(" ")
    return head, (" " + tail if tail else "")


def _s3(phrase: str) -> str:
    head, tail = _head(phrase)
    if head == "have":
        return "has" + tail
    if head.endswith(("s", "sh", "ch", "x", "z", "o")):
        return head + "es" + tail
    if re.search(r"[^aeiou]y$", head):
        return head[:-1] + "ies" + tail
    return head + "s" + tail


def _ing(phrase: str) -> str:
    head, tail = _head(phrase)
    if head in _ING:
        return _ING[head] + tail
    if head.endswith("ie"):
        return head[:-2] + "ying" + tail
    if head.endswith("e") and not head.endswith(("ee", "ye", "oe")) and len(head) > 2:
        return head[:-1] + "ing" + tail
    if re.fullmatch(r"[^aeiou]*[aeiou][^aeiouwxy]", head):
        return head + head[-1] + "ing" + tail
    return head + "ing" + tail


def _regular_past(phrase: str) -> str:
    head, tail = _head(phrase)
    if head.endswith("e"):
        return head + "d" + tail
    if re.search(r"[^aeiou]y$", head):
        return head[:-1] + "ied" + tail
    return head + "ed" + tail


def english(verb: dict, tense: str, person: int) -> str:
    parts = verb["en"].split("|")
    base = parts[0]
    past = parts[1] if len(parts) > 1 else _regular_past(base)
    pp = parts[2] if len(parts) > 2 else past
    template = verb.get("enT", {}).get(tense) or _DEFAULT_EN[tense]
    text = (template
            .replace("{S}", _SUBJECTS[person])
            .replace("{s}", _s3(base) if person == 2 else base)
            .replace("{do}", _DO[person])
            .replace("{base}", base)
            .replace("{past}", past)
            .replace("{pp}", pp)
            .replace("{ing}", _ing(base))
            .replace("{be}", _BE[person])
            .replace("{was}", _WAS[person]))
    if tense in ("imp", "impNeg") and person == 4:
        text += " (pl.)"
    return text


def gloss(verb: dict) -> str:
    """'to go', the way a dictionary lists it."""
    return "to " + verb["en"].split("|")[0]


# --- answers --------------------------------------------------------------------

def alternatives(fa: str, person: int) -> list[str]:
    """Other ways of typing the same answer that are just as right.

    The subject pronoun in front (the app's answer check forgives من, ما and
    شما already, not the others), and for شما the polite ـید that many
    speakers use where Tehran says ـین.
    """
    out = [f"{PERSONS[person]['fa']} {fa}"]
    if person == 4 and re.search(r"ین(?=\s|$)", fa):
        polite = re.sub(r"ین(?=\s|$)", "ید", fa)
        out += [polite, f"{PERSONS[person]['fa']} {polite}"]
    return out


def conjugate(verb: dict, by_inf: dict) -> dict[str, list]:
    """Every tense of `verb`: {tense: [cell or None per person] or None}.

    A cell is {p, fa, tr, en, alt}.
    """
    raw = _compound(verb, by_inf) if verb.get("light") else _simple(verb)
    out: dict[str, list] = {}
    for key in TENSE_KEYS:
        cells = raw.get(key)
        if cells is None:
            out[key] = None
            continue
        if key in ("imp", "impNeg"):
            cells = _only(cells)
        out[key] = [
            None if cell is None else {
                "p": i, "fa": cell[0], "tr": cell[1],
                "en": english(verb, key, i), "alt": alternatives(cell[0], i),
            }
            for i, cell in enumerate(cells)
        ]
    return out


# --- loading ---------------------------------------------------------------------

def _uuid(name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, name))


@functools.lru_cache(maxsize=None)
def _read(name: str) -> dict:
    return json.loads((KB / name).read_text(encoding="utf-8"))


def words() -> list[dict]:
    """Every word row, flattened, with its topic and a stable id."""
    out = []
    for topic in _read("words.json")["topics"]:
        for row in topic["words"]:
            fa, tr, en, pos, level, *rest = row
            flags = {r for r in rest if isinstance(r, str)}
            extra = next((r for r in rest if isinstance(r, dict)), {})
            out.append({
                "id": _uuid(f"word:{extra.get('id') or fix(fa)}"),
                "topic": topic["id"],
                "fa": fix(fa), "tr": tr, "en": en, "pos": pos, "level": level,
                "core": "core" in flags,
                "alt": [fix(a) for a in extra.get("alt", [])],
                "note": extra.get("note", ""),
            })
    return out


def topics() -> list[dict]:
    return [{k: t[k] for k in ("id", "fa", "en")} for t in _read("words.json")["topics"]]


def verbs() -> list[dict]:
    return [dict(v, inf=fix(v["inf"])) for v in _read("verbs.json")["verbs"]]


def pronoun_tables() -> list[dict]:
    tables = []
    for table in _read("pronouns.json")["tables"]:
        forms = []
        for row in table["rows"]:
            person, fa, tr, en, *rest = row
            p = next(i for i, x in enumerate(PERSONS) if x["fa"] == person)
            alt = [fix(a) for a in (rest[0] if rest else [])]
            forms.append({"p": p, "fa": fix(fa), "tr": tr, "en": en,
                          "alt": alt + [f"{person} {fix(fa)}"]})
        tables.append({**{k: table[k] for k in ("id", "group", "label", "labelEn", "lemmaEn", "level")},
                       "lemma": fix(table["lemma"]),
                       "cardId": _uuid(f"pron:{table['id']}"), "forms": forms})
    return tables


def core_words() -> list[tuple[str, str]]:
    """(Persian, English) for the words flagged core, as core/syllabus.py wants them."""
    return [(w["fa"], w["en"]) for w in words() if w["core"]]


def core_verbs() -> list[tuple[str, str]]:
    return [(v["inf"], v["en"].split("|")[0]) for v in verbs() if v.get("core")]


def verb_card_id(inf: str, tense: str) -> str:
    return _uuid(f"form:{inf}:{tense}")
