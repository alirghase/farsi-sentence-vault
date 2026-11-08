#!/usr/bin/env python3
"""Build the knowledge base: kb/ -> web/data/kb.json.

kb/ is what a person writes: the word list, two stems per verb, the pronoun
tables, the grammar notes. This checks all of it, conjugates every verb
(core/kb.py), renders the notes, and writes the one file the app reads for
both the reference screen and the word and form cards.

    python3 tools/build_kb.py            # check, report, change nothing
    python3 tools/build_kb.py --write    # and save web/data/kb.json
    python3 tools/build_kb.py --check    # fail if kb.json is out of date (CI)
    python3 tools/build_kb.py --show رفتن   # print one verb's tables

One file rather than a deck file and a reference file: the cards are the
reference. A verb's tense table on the reference screen and the card that
drills it are the same row, so they cannot disagree.
"""

from __future__ import annotations

import argparse
import collections
import html
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import kb, validate
from core.taxonomy import PARTS_OF_SPEECH

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "kb.json"
NOTES = kb.KB / "notes"


# --- checks ------------------------------------------------------------------

def _script(fa: str, tr: str, en: str, where: str) -> list[str]:
    out = []
    if not validate.PERSIAN_RE.search(fa) or validate.LATIN_RE.search(fa):
        out.append(f"{where}: Persian {fa!r} is not Persian script")
    if validate.PERSIAN_RE.search(tr) or not validate.LATIN_RE.search(tr):
        out.append(f"{where}: transliteration {tr!r} is not Latin")
    if validate.PERSIAN_RE.search(en):
        out.append(f"{where}: English {en!r} contains Persian")
    if "~" in fa + tr + en:
        out.append(f"{where}: stray ~")
    _spoken, written = validate.register_report(fa)
    if written:
        out.append(f"{where}: written-only form in {fa!r}: {written}")
    for formal, spoken in validate.PREFER_SPOKEN.items():
        if spoken and validate._stem_pattern(formal).search(fa):
            out.append(f"{where}: {formal!r} — this deck says {spoken!r}")
    return out


def check_words(words: list[dict]) -> list[str]:
    out = []
    ids = collections.Counter(w["id"] for w in words)
    prompts = collections.defaultdict(list)
    for w in words:
        where = f"word {w['fa']}"
        out += _script(w["fa"], w["tr"], w["en"], where)
        if w["pos"] not in PARTS_OF_SPEECH:
            out.append(f"{where}: unknown part of speech {w['pos']!r}")
        if not 1 <= w["level"] <= 5:
            out.append(f"{where}: level {w['level']} out of range")
        if ids[w["id"]] > 1:
            out.append(f"{where}: two rows share this spelling — give one an id")
        prompts[w["en"].strip().lower()].append(w["fa"])
    # A word card asks for the Persian from the English. Two rows with one
    # English prompt and two answers mark one of them wrong whichever you say.
    for prompt, answers in prompts.items():
        if len(answers) > 1:
            out.append(f"English {prompt!r} asks for {answers} — make the English say which")
    return out


def check_verbs(verbs: list[dict], tables: dict) -> list[str]:
    out = []
    for v in verbs:
        for field in ("inf", "tr", "en", "level"):
            if field not in v:
                out.append(f"verb {v.get('inf')}: missing {field}")
        if v.get("light") and v["light"] not in {x["inf"] for x in verbs}:
            out.append(f"verb {v['inf']}: light verb {v['light']} is not in the list")
        for key, cells in tables[v["inf"]].items():
            for cell in cells or ():
                if cell:
                    out += _script(cell["fa"], cell["tr"], cell["en"], f"{v['inf']} {key}")
        if not any(tables[v["inf"]].values()):
            out.append(f"verb {v['inf']}: no tense at all")
    return out


def check_pronouns(tables: list[dict]) -> list[str]:
    out = []
    for t in tables:
        if len(t["forms"]) < 3:
            out.append(f"pronoun table {t['id']}: fewer than three rows is not a drill")
        for f in t["forms"]:
            out += _script(f["fa"], f["tr"], f["en"], f"pronoun {t['id']}")
    return out


# --- notes ---------------------------------------------------------------------
#
# A small Markdown subset, enough for a grammar note: ## headings, paragraphs,
# "- " lists, | tables |, **bold** and `code`. Everything is escaped first, so
# a note can never put markup in the page the app did not mean to.

def _inline(text: str) -> str:
    text = html.escape(text.replace("~", kb.ZWNJ))
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    return re.sub(r"`(.+?)`", r"<code>\1</code>", text)


def _dir(text: str) -> str:
    """rtl when the line starts in Persian, so punctuation lands correctly."""
    first = re.search(r"[A-Za-z؀-ۿ]", text)
    return ' dir="rtl"' if first and validate.PERSIAN_RE.match(first.group()) else ""


def render_note(source: str) -> tuple[str, str, str]:
    """(Persian title, English title, html) from a note's Markdown."""
    lines = source.strip().splitlines()
    title = lines[0].lstrip("# ").strip()
    fa_title, _, en_title = title.partition(" | ")
    blocks: list[str] = []
    para: list[str] = []
    items: list[str] = []
    rows: list[list[str]] = []

    def flush() -> None:
        if para:
            text = " ".join(para)
            blocks.append(f"<p{_dir(text)}>{_inline(text)}</p>")
            para.clear()
        if items:
            blocks.append("<ul>" + "".join(f"<li{_dir(i)}>{_inline(i)}</li>" for i in items) + "</ul>")
            items.clear()
        if rows:
            head, *body = [r for r in rows if not re.fullmatch(r"[\s|:-]+", "|".join(r))]
            cells = lambda r, tag: "".join(f"<{tag}{_dir(c)}>{_inline(c)}</{tag}>" for c in r)  # noqa: E731
            blocks.append("<table><thead><tr>" + cells(head, "th") + "</tr></thead><tbody>"
                          + "".join(f"<tr>{cells(r, 'td')}</tr>" for r in body) + "</tbody></table>")
            rows.clear()

    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            flush()
        elif stripped.startswith("## "):
            flush()
            blocks.append(f"<h3{_dir(stripped[3:])}>{_inline(stripped[3:])}</h3>")
        elif stripped.startswith("- "):
            if para or rows:
                flush()
            items.append(stripped[2:])
        elif stripped.startswith("|"):
            if para or items:
                flush()
            rows.append([c.strip() for c in stripped.strip("|").split("|")])
        else:
            if items or rows:
                flush()
            para.append(stripped)
    flush()
    return fa_title.strip(), en_title.strip(), "\n".join(blocks)


def notes() -> list[dict]:
    out = []
    for path in sorted(NOTES.glob("*.md")):
        fa, en, body = render_note(path.read_text(encoding="utf-8"))
        out.append({"id": path.stem, "title": fa, "titleEn": en, "html": body})
    return out


# --- build ----------------------------------------------------------------------

def build() -> tuple[dict, list[str]]:
    words = kb.words()
    verbs = kb.verbs()
    by_inf = {v["inf"]: v for v in verbs}
    tables = {v["inf"]: kb.conjugate(v, by_inf) for v in verbs}
    pronouns = kb.pronoun_tables()

    problems = check_words(words) + check_verbs(verbs, tables) + check_pronouns(pronouns)

    tense_meta = {key: (fa, en, level, drill) for key, fa, en, level, drill in kb.TENSES}
    verb_rows = []
    for v in verbs:
        tenses = []
        for key in kb.TENSE_KEYS:
            cells = tables[v["inf"]][key]
            if not cells:
                continue
            _fa, _en, _level, drill = tense_meta[key]
            tenses.append({
                "key": key,
                **({"id": kb.verb_card_id(v["inf"], key)} if drill else {}),
                # Alternatives are derived, so the app derives them: shipping
                # them doubled the file.
                "forms": [{k: c[k] for k in ("p", "fa", "tr", "en")} for c in cells if c],
            })
        verb_rows.append({
            "inf": v["inf"], "tr": v["tr"], "en": kb.gloss(v), "level": v["level"],
            "core": bool(v.get("core")),
            **({"compound": {"nominal": kb._pair(v["nominal"])[0], "light": v["light"]}}
               if v.get("light") else
               {"stems": {"past": kb._pair(v["past"])[0], "pres": kb._pair(v["pres"])[0]}}),
            "tenses": tenses,
        })

    by_topic = collections.defaultdict(list)
    for w in words:
        row = {k: w[k] for k in ("id", "fa", "tr", "en", "pos", "level")}
        if w["core"]:
            row["core"] = True
        if w["alt"]:
            row["alt"] = w["alt"]
        if w["note"]:
            row["note"] = w["note"]
        by_topic[w["topic"]].append(row)

    data = {
        "version": 1,
        "persons": kb.PERSONS,
        "tenses": [{"key": k, "fa": fa, "en": en, "level": lv, "drill": d}
                   for k, fa, en, lv, d in kb.TENSES],
        "topics": [{**t, "words": by_topic[t["id"]]} for t in kb.topics()],
        "verbs": verb_rows,
        "pronouns": pronouns,
        "notes": notes(),
    }
    return data, problems


def serialise(data: dict) -> str:
    """One record per line: small enough to ship, still a readable diff."""
    dump = lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":"))  # noqa: E731
    parts = []
    for key, value in data.items():
        if isinstance(value, list):
            body = ",\n".join(dump(item) for item in value)
            parts.append(f"{dump(key)}:[\n{body}\n]")
        else:
            parts.append(f"{dump(key)}:{dump(value)}")
    return "{\n" + ",\n".join(parts) + "\n}\n"


def show(data: dict, inf: str) -> None:
    verb = next((v for v in data["verbs"] if v["inf"] == inf), None)
    if not verb:
        sys.exit(f"no verb {inf!r}")
    labels = {t["key"]: t["fa"] for t in data["tenses"]}
    print(f"\n  {verb['inf']}  {verb['tr']}  {verb['en']}\n")
    for tense in verb["tenses"]:
        print(f"  {labels[tense['key']]}")
        for f in tense["forms"]:
            print(f"    {kb.PERSONS[f['p']]['fa']:<5} {f['fa']:<22} {f['tr']:<26} {f['en']}")
        print()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="save web/data/kb.json")
    ap.add_argument("--check", action="store_true", help="fail if kb.json is stale")
    ap.add_argument("--show", metavar="VERB", help="print one verb's tables")
    args = ap.parse_args()

    data, problems = build()
    if args.show:
        show(data, kb.fix(args.show))
        return 0
    for p in problems:
        print(f"  {p}")
    if problems:
        print(f"\n  {len(problems)} problems — not built")
        return 1

    words = sum(len(t["words"]) for t in data["topics"])
    cards = (words + sum(1 for v in data["verbs"] for t in v["tenses"] if "id" in t)
             + len(data["pronouns"]))
    print(f"  {words} words and phrases in {len(data['topics'])} topics · "
          f"{len(data['verbs'])} verbs · {len(data['pronouns'])} pronoun tables · "
          f"{len(data['notes'])} notes  ->  {cards} cards")

    text = serialise(data)
    if args.check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print("  web/data/kb.json is out of date — run tools/build_kb.py --write")
            return 1
        print("  web/data/kb.json is up to date")
    elif args.write:
        OUT.write_text(text, encoding="utf-8")
        print(f"  written to {OUT.relative_to(ROOT)} ({len(text.encode()) // 1024} KB)")
    else:
        print("  (dry run — pass --write to save)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
