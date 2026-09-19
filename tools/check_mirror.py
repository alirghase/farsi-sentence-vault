#!/usr/bin/env python3
"""Verify the JavaScript and Python error-tag vocabularies have not drifted.

The tag set is duplicated by necessity: Python generates the seed bank and runs
the backend, JavaScript runs the app. If they diverge, per-tag counts fragment
and the "target my weak spots" loop silently starts aiming at noise — with no
crash and no error. Run before every seed regeneration.
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from core.taxonomy import ERROR_TAG_KEYS, SITUATIONS

ROOT = pathlib.Path(__file__).resolve().parent.parent
JS_TAXONOMY = ROOT / "web" / "js" / "taxonomy.js"


def js_tags(text: str) -> set[str]:
    block = text.split("export const ERROR_TAGS")[1].split("export const ERROR_TAG_KEYS")[0]
    return set(re.findall(r"^\s*'([a-z-]+)':\s*\{", block, re.M))


# Matches a single- or double-quoted JS string as two alternatives. A character
# class like ['"] at both ends is wrong: it treats the apostrophe in
# "someone's home" as a closing quote and truncates the value.
_JS_STRING = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"")


def js_situations(text: str) -> set[str]:
    block = text.split("export const SITUATIONS")[1].split("];")[0]
    found = set()
    for single, double in _JS_STRING.findall(block):
        value = single or double
        if value.strip():
            found.add(value.replace("\\'", "'"))
    return found


def main() -> int:
    if not JS_TAXONOMY.exists():
        print(f"error: {JS_TAXONOMY} not found", file=sys.stderr)
        return 1

    text = JS_TAXONOMY.read_text(encoding="utf-8")
    failures = 0

    for label, py_set, sw_set in (
        ("error tags", set(ERROR_TAG_KEYS), js_tags(text)),
        ("situations", set(SITUATIONS), js_situations(text)),
    ):
        only_py = py_set - sw_set
        only_sw = sw_set - py_set
        if only_py or only_sw:
            failures += 1
            print(f"  MISMATCH in {label}:")
            if only_py:
                print(f"    only in python: {sorted(only_py)}")
            if only_sw:
                print(f"    only in js:     {sorted(only_sw)}")
        else:
            print(f"  OK  {label} ({len(py_set)} entries, identical)")

    if failures:
        print("\n  Vocabularies have drifted. Fix before regenerating the seed bank.")
        return 1
    print("\n  JavaScript and Python vocabularies are in sync.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
