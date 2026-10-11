#!/usr/bin/env python3
"""Pin the forms the conjugation rules must keep producing.

core/kb.py generates every table from two stems, so one rule changed for one
verb changes it for ninety. Each line below is a form checked by hand; if a
rule edit moves any of them, this fails before the app drills the new form.

    python3 tools/test_kb.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import kb

# verb, tense, person (0 من … 5 اونا), the form
GOLDEN = """
رفتن present 0 می‌رم
رفتن present 2 می‌ره
رفتن presentNeg 3 نمی‌ریم
رفتن past 2 رفت
رفتن pastNeg 0 نرفتم
رفتن subj 3 بریم
رفتن imp 1 برو
رفتن imp 4 برین
رفتن impNeg 1 نرو
رفتن presProg 0 دارم می‌رم
رفتن pastProg 3 داشتیم می‌رفتیم
رفتن pastPerf 0 رفته بودم
اومدن present 0 میام
اومدن present 2 میاد
اومدن presentNeg 1 نمیای
اومدن pastNeg 0 نیومدم
اومدن imperfect 2 میومد
اومدن subj 0 بیام
اومدن imp 1 بیا
اومدن imp 4 بیاین
اومدن impNeg 1 نیا
اومدن pastPerf 2 اومده بود
آوردن present 0 میارم
آوردن pastNeg 0 نیاوردم
آوردن imp 4 بیارین
بودن present 0 هستم
بودن presentNeg 2 نیست
بودن subj 2 باشه
بودن imp 1 باش
داشتن present 0 دارم
داشتن presentNeg 2 نداره
داشتن subj 0 داشته باشم
خواستن present 0 می‌خوام
خواستن present 2 می‌خواد
خواستن subj 1 بخوای
گفتن present 2 می‌گه
گفتن imp 1 بگو
گفتن imp 4 بگین
دادن imp 1 بده
دادن present 0 می‌دم
دیدن subj 0 ببینم
دیدن imp 1 ببین
گذاشتن present 0 می‌ذارم
گذاشتن pastNeg 0 نذاشتم
گذاشتن imp 1 بذار
نشستن present 0 می‌شینم
نشستن imp 1 بشین
شدن present 2 می‌شه
شدن subj 0 بشم
کردن subj 0 بکنم
برداشتن present 0 برمی‌دارم
برداشتن presentNeg 0 برنمی‌دارم
برداشتن pastNeg 0 برنداشتم
برداشتن subj 0 بردارم
برداشتن imp 1 بردار
برگشتن present 0 برمی‌گردم
برگشتن imp 1 برگرد
کار کردن present 0 کار می‌کنم
کار کردن subj 0 کار کنم
کار کردن imp 1 کار کن
کار کردن imp 4 کار کنین
کار کردن presProg 0 دارم کار می‌کنم
بلند شدن imp 1 بلند شو
بلند شدن imp 4 بلند شین
بلند شدن impNeg 1 بلند نشو
بلند شدن subj 0 بلند شم
زنگ زدن subj 0 زنگ بزنم
زنگ زدن imp 1 زنگ بزن
یاد گرفتن subj 0 یاد بگیرم
نشون دادن imp 1 نشون بده
دوست داشتن present 0 دوست دارم
دوست داشتن presentNeg 0 دوست ندارم
دوست داشتن subj 0 دوست داشته باشم
منتظر موندن imp 1 منتظر بمون
افتادن present 0 میفتم
انداختن present 0 میندازم
خوردن subj 0 بخورم
"""

# Tenses that must not exist for a verb.
ABSENT = [
    ("داشتن", "imp"), ("داشتن", "presProg"), ("خواستن", "imp"), ("تونستن", "presProg"),
    ("بودن", "imperfect"), ("دوست داشتن", "imp"), ("شدن", "imp"),
]

PRONOUNS = {
    "poss-consonant": ["کتابم", "کتابت", "کتابش", "کتابمون", "کتابتون", "کتابشون"],
    "prep-be": ["بهم", "بهت", "بهش", "بهمون", "بهتون", "بهشون"],
    "prep-ba": ["باهام", "باهات", "باهاش", "باهامون", "باهاتون", "باهاشون"],
    "cop-consonant": ["خوبم", "خوبی", "خوبه", "خوبیم", "خوبین", "خوبن"],
    "obj-like": ["دوستت دارم", "دوستش دارم", "دوستتون دارم", "دوستشون دارم"],
}


def main() -> int:
    verbs = kb.verbs()
    by_inf = {v["inf"]: v for v in verbs}
    tables: dict[str, dict] = {}
    failures = []

    for line in GOLDEN.strip().splitlines():
        words = line.split(" ")
        # The verb may be two words and the form may be two words; the tense key
        # and the person index sit between them and are the only ASCII tokens.
        i = next(k for k, w in enumerate(words) if w.isascii() and not w.isdigit())
        verb, tense, person, form = " ".join(words[:i]), words[i], int(words[i + 1]), " ".join(words[i + 2:])
        if verb not in by_inf:
            failures.append(f"{verb}: not in kb/verbs.json")
            continue
        table = tables.setdefault(verb, kb.conjugate(by_inf[verb], by_inf))
        cells = table.get(tense)
        got = cells[person]["fa"] if cells and cells[person] else None
        if got != form:
            failures.append(f"{verb} {tense} {kb.PERSONS[person]['fa']}: expected {form}, got {got}")

    for verb, tense in ABSENT:
        table = tables.setdefault(verb, kb.conjugate(by_inf[verb], by_inf))
        if table.get(tense):
            failures.append(f"{verb} has a {tense}, and should not")

    tables_by_id = {t["id"]: t for t in kb.pronoun_tables()}
    for table_id, expected in PRONOUNS.items():
        got = [f["fa"] for f in tables_by_id[table_id]["forms"]]
        if got != expected:
            failures.append(f"pronoun table {table_id}: expected {expected}, got {got}")

    # The core lists core/syllabus.py measures the deck against.
    if len(kb.core_verbs()) != 48:
        failures.append(f"core verbs: expected 48, got {len(kb.core_verbs())}")
    if len(kb.core_words()) != 308:
        failures.append(f"core words: expected 308, got {len(kb.core_words())}")

    for f in failures:
        print(f"  FAIL  {f}")
    golden = len(GOLDEN.strip().splitlines())
    print(f"\n  {golden} pinned forms, {len(ABSENT)} absent tenses, "
          f"{len(PRONOUNS)} pronoun tables — {len(failures)} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
