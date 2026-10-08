#!/usr/bin/env python3
"""Build the swap drills from tools/handwritten/drills/swaps.json.

A swap card shows one version of a frame and a cue — "say it with ما", "say it
with لازم داشتن" — and asks for another version. It is the drill for being able
to move between sentences rather than recite them: the same words with another
person, another verb, another opening phrase.

Unlike transforms.py nothing here asks a model. The versions of a frame are
minimal pairs and one wrong ending in a paradigm is wrong Farsi drilled six
ways, so a person writes them and this tool only checks and arranges.

Each frame yields up to PER_FRAME cards, chosen deterministically so a rebuild
changes nothing, and so that across a frame every version turns up both as the
thing you are shown and as the thing you must produce.

Rewrites only the swap rows in web/data/transforms.json. Rows written by
transforms.py are left exactly as they are.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from core import validate
from core.taxonomy import SWAP_KEYS

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tools" / "handwritten" / "drills" / "swaps.json"
OUT = ROOT / "web" / "data" / "transforms.json"

PER_FRAME = 4
ZWNJ = "‌"


def load_frames() -> list[dict]:
    """Frames with every version spelled out as {cue, cueEn, fa, tr, en}."""
    raw = json.loads(SOURCE.read_text())
    presets = raw["presets"]
    frames = []
    for frame in raw["frames"]:
        kind = frame["kind"]
        if kind not in SWAP_KEYS:
            sys.exit(f"{frame['id']}: unknown kind {kind!r}")
        preset = presets.get("pronoun") if kind == "pronoun" else None
        cue_en = frame.get("cueEn") or (preset or {}).get("cueEn")

        versions = []
        for i, form in enumerate(frame["forms"]):
            if form is None:
                versions.append(None)
            elif preset:
                fa, tr, en = form
                versions.append({"cue": preset["cues"][i], "cueEn": cue_en[i],
                                 "fa": fa, "tr": tr, "en": en})
            else:
                cue, cue_en_i, fa, tr, en = form
                versions.append({"cue": cue, "cueEn": cue_en_i,
                                 "fa": fa, "tr": tr, "en": en})
        frames.append({**frame, "versions": [
            v and {k: val.replace("~", ZWNJ) for k, val in v.items()} for v in versions
        ]})
    return frames


def problems(frame: dict) -> list[str]:
    """Everything wrong with one frame, as readable strings."""
    out: list[str] = []
    present = [v for v in frame["versions"] if v]
    if len(present) < 3:
        out.append("needs at least three versions to be worth a drill")

    seen: dict[str, str] = {}
    for v in present:
        for field in ("cue", "cueEn", "fa", "tr", "en"):
            if not v[field].strip():
                out.append(f"{v['fa'] or v['cue']}: empty {field}")
        key = validate.normalise_persian(v["fa"])
        if key in seen:
            out.append(f"{v['fa']}: same as the version for {seen[key]}")
        seen[key] = v["cue"]

        row = {
            "englishText": v["en"], "farsiText": v["fa"], "finglish": v["tr"],
            "literalGloss": "", "difficulty": frame["d"], "situation": frame["sit"],
            "grammarTags": frame["tags"], "alternatives": [],
        }
        out += [f"{v['fa']}: {p}" for p in validate.check_sentence(row)]
        if "~" in v["fa"] + v["tr"] + v["en"]:
            out.append(f"{v['fa']}: stray ~")

    cues = [v["cue"] for v in present]
    if len(set(cues)) != len(cues):
        out.append("two versions share a cue, so a card could not say which you want")
    return out


def pairs(frame: dict, position: int) -> list[tuple[int, int]]:
    """(shown, asked-for) index pairs for one frame.

    `position` offsets the choice so frames do not all start from the same
    version; the shift varies per card so a frame does not teach only
    "the next one along".
    """
    valid = [i for i, v in enumerate(frame["versions"]) if v]
    n = len(valid)
    chosen: list[tuple[int, int]] = []
    for k in range(min(PER_FRAME, n)):
        a = (position + k) % n
        b = (a + 1 + (position + 2 * k) % (n - 1)) % n
        pair = (valid[a], valid[b])
        if pair not in chosen:
            chosen.append(pair)
    return chosen


# The pronouns a subject frame can also be answered with. Persian drops the
# subject, but a learner who writes ما قهوه می‌خوایم has not made a mistake.
SUBJECTS = ["من", "تو", "اون", "ما", "شما", "اونا"]


def rows_for(frame: dict, position: int) -> list[dict]:
    rows = []
    for a, b in pairs(frame, position):
        shown, asked = frame["versions"][a], frame["versions"][b]
        alternatives = [f"{SUBJECTS[b]} {asked['fa']}"] if frame.get("subject") else []
        rows.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL,
                                 f"swap:{frame['id']}:{shown['cue']}>{asked['cue']}")),
            "kind": "transform",
            "stemId": frame["id"],
            "stem": shown["fa"],
            "stemEn": shown["en"],
            "transform": frame["kind"],
            "cue": asked["cue"],
            "cueEn": asked["cueEn"],
            "farsiText": asked["fa"],
            "finglish": asked["tr"],
            "englishText": asked["en"],
            "difficulty": frame["d"],
            "situation": frame["sit"],
            "grammarTags": frame["tags"],
            "alternatives": alternatives,
        })
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="save to web/data/")
    args = ap.parse_args()

    frames = load_frames()
    failed = False
    for frame in frames:
        for message in problems(frame):
            print(f"  {frame['id']}: {message}")
            failed = True
    if failed:
        print("\nnot built — fix the frames above")
        return 1

    swaps = [row for position, frame in enumerate(frames)
             for row in rows_for(frame, position)]

    existing = json.loads(OUT.read_text())["transforms"] if OUT.exists() else []
    kept = [r for r in existing if r["transform"] not in SWAP_KEYS]
    rows = kept + swaps

    by = collections.Counter(r["transform"] for r in swaps)
    print(f"{len(frames)} frames -> {len(swaps)} swap cards "
          f"({' · '.join(f'{k} {v}' for k, v in sorted(by.items()))})")
    print(f"{len(kept)} other drills kept -> {len(rows)} in total")

    if args.write:
        OUT.write_text(json.dumps({"count": len(rows), "transforms": rows},
                                  ensure_ascii=False, indent=2) + "\n")
        print(f"written to {OUT.relative_to(pathlib.Path.cwd())}")
    else:
        print("(dry run — pass --write to save)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
