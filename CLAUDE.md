# Farsi Sentence Vault

A static PWA for drilling spoken Tehrani Persian, plus a knowledge base (`kb/`)
that the app both drills and shows as a reference. See README.md for the app
and the pipeline.

## Rules for content

- **Spoken Tehrani, everywhere.** می‌رم not می‌روم, اون not او, مامان not مادر.
  `core/validate.py` enforces what it can (`PREFER_SPOKEN`, the register check);
  a sentence can pass every check and still be something nobody says.
- **Hand-written.** No generated sentences go in unread. Every new sentence,
  word or verb is read line by line before it is committed.
- **Native-speaker review.** Anything uncertain — a negative past nobody uses,
  an idiom, a register call — goes into the PR description under "For a native
  speaker" rather than being guessed. If unsure, leave a tense out (`skip` in
  kb/verbs.json) rather than ship a wrong form.
- **Never push to `master`.** It deploys. Work on a branch and open a PR.
- Public repo: commits as `alirghase <305536277+alirghase@users.noreply.github.com>`;
  nothing personal, nothing from anyone's employer.

## Where things live

```
kb/words.json      words and phrases by topic -> word cards + reference
kb/verbs.json      two stems per verb (+ overrides) -> every tense, form cards
kb/pronouns.json   attached pronouns, prepositions, copula -> form cards
kb/notes/*.md      grammar notes (small Markdown subset) -> reference screen
core/kb.py         the conjugation engine; tools/test_kb.py pins its output
tools/handwritten/ sentence batches, each sentence with its word map
web/data/          what the app loads; kb.json is generated, never hand-edited
```

## Checks — all must pass before a commit

```bash
python3 tools/test_kb.py            # pinned conjugations
python3 tools/build_kb.py --write   # validate kb/ and regenerate web/data/kb.json
python3 tools/check_handwritten.py  # word maps cover every word
python3 tools/check_deck.py         # card-level mistakes
node tools/check_js.mjs             # modules, calls, ids, string keys
node --test tools/test_js.mjs       # scheduler, matching, every shipped card
python3 tools/coverage.py           # the worklist: what is thin
```

Growing the deck or the knowledge base: use the `expand` skill
(`.claude/skills/expand/SKILL.md`).
