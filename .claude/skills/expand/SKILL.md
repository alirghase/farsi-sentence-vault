---
name: expand
description: Grow the Farsi deck and knowledge base by one reviewed batch — sentences for thin words and verbs, new words, verbs, pronoun tables or grammar notes — then run every check and open a PR. Use when asked to expand, add content, add vocabulary/verbs, or fill coverage gaps.
---

# Expand the vault

One batch per run: small enough to read every line. The goal is that every
word in the knowledge base is met in at least three sentences, every verb has
examples, and the knowledge base keeps growing into the vocabulary everyday
speech needs.

## 1. Pick the work from the worklist

```bash
python3 tools/coverage.py          # commonest gaps first
python3 tools/coverage.py --kb     # all of them
```

Choose, in this order, unless the user asked for something specific:

1. **Verbs with no example sentence**, then verbs in 1–2 sentences.
2. **Core words in fewer than 3 cards**, then other A1/A2 words.
3. **New knowledge-base entries** once the gaps are small: words a topic is
   missing, common verbs not yet in `kb/verbs.json`, a pronoun table or a
   grammar note that is missing.

Aim for 15–30 sentences, or 20–40 words, or 5–10 verbs per batch.

## 2. Write it

**Sentences** — a new file in `tools/handwritten/`, named
`<level>_<theme>.json` (e.g. `a2_verbs_without_examples.json`). Copy the
shape of an existing batch: `note`, `difficulty`, `sentences` with `en`, `fa`,
`tr`, `sit`, `tags`, `bd` (the word map: `[fa, translit, gloss, part of
speech]` per unit, rebuilding the sentence exactly) and `alt`. Each sentence
should use one target word or verb naturally — something a person would
actually say, not a sentence built around a word.

**Words** — rows in `kb/words.json` under the right topic:
`[fa, tr, en, pos, level, "core"?, {alt, note, id}?]`. The English must say
which meaning (two rows may not share an English prompt). `id` only when two
rows share a Persian spelling.

**Verbs** — entries in `kb/verbs.json`: `inf`, `tr`, `en` ("base|past|pp"),
`past` and `pres` stems as "Persian translit", `level`; compounds use
`nominal` + `light`. Irregular forms go in `full` (per tense) or `over` (a
whole tense); leave out a tense you are not sure is said (`skip`). Check the
tables with `python3 tools/build_kb.py --show <verb>` and read every cell. Pin
two or three forms of each new irregular verb in `tools/test_kb.py`.

**Notes** — `kb/notes/NN-name.md`, first line `# فارسی | English`; `##`
headings, paragraphs, `- ` lists, `|` tables, `**bold**`, `` `code` ``.

In every file: spoken Tehrani only, `~` for the half-space where the file
uses it.

## 3. Check

```bash
python3 tools/check_handwritten.py
python3 tools/merge_handwritten.py      # sentences into the deck
python3 tools/test_kb.py
python3 tools/build_kb.py --write
python3 tools/check_deck.py
node tools/check_js.mjs
node --test tools/test_js.mjs
python3 tools/coverage.py               # the gap you picked should have shrunk
```

Fix what fails; do not loosen a check to pass it.

## 4. Ship as a PR, never to master

```bash
git switch -c expand/<short-theme>
git add <only the files this batch touched> web/data
git commit                              # say what was added and the coverage before/after
git push -u origin HEAD
gh pr create --fill
```

In the PR description list:

- what was added (counts) and the coverage numbers before → after;
- **For a native speaker:** every sentence, form or word you were not sure of,
  with why. Uncertain items are listed, not guessed.

Stop there. A human merges.
