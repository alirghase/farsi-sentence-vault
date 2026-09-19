#!/usr/bin/env python3
"""Verify the Swift and Python error-tag vocabularies have not drifted apart.

The tag set is duplicated by necessity (Python generates the seed bank, Swift
runs the app). If they diverge, ErrorTagStat counts fragment and the "target my
weak spots" loop silently starts aiming at noise — with no crash and no error.
Run this in CI, or at least before every seed regeneration.
"""
from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from core.taxonomy import ERROR_TAG_KEYS, SITUATIONS

ROOT = pathlib.Path(__file__).resolve().parent.parent
SWIFT_TAXONOMY = ROOT / "FarsiVault" / "AI" / "Taxonomy.swift"


def swift_tags(text: str) -> set[str]:
    block = text.split("enum ErrorTag")[1].split("var title")[0]
    tags: set[str] = set()
    for line in block.splitlines():
        line = line.strip()
        if m := re.match(r'case (\w+) = "([^"]+)"', line):
            tags.add(m.group(2))
        elif m := re.match(r"case (\w+)$", line):
            tags.add(m.group(1))
    return tags


def swift_situations(text: str) -> set[str]:
    block = text.split("enum Situations")[1].split("]")[0]
    return set(re.findall(r'"([^"]+)"', block))


def main() -> int:
    if not SWIFT_TAXONOMY.exists():
        print(f"error: {SWIFT_TAXONOMY} not found", file=sys.stderr)
        return 1

    text = SWIFT_TAXONOMY.read_text(encoding="utf-8")
    failures = 0

    for label, py_set, sw_set in (
        ("error tags", set(ERROR_TAG_KEYS), swift_tags(text)),
        ("situations", set(SITUATIONS), swift_situations(text)),
    ):
        only_py = py_set - sw_set
        only_sw = sw_set - py_set
        if only_py or only_sw:
            failures += 1
            print(f"  MISMATCH in {label}:")
            if only_py:
                print(f"    only in python: {sorted(only_py)}")
            if only_sw:
                print(f"    only in swift:  {sorted(only_sw)}")
        else:
            print(f"  OK  {label} ({len(py_set)} entries, identical)")

    if failures:
        print("\n  Vocabularies have drifted. Fix before regenerating the seed bank.")
        return 1
    print("\n  Swift and Python vocabularies are in sync.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
