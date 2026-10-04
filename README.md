# Farsi Sentence Vault

**Live: <https://alirghase.github.io/farsi-sentence-vault/>** — open on a phone,
Share → Add to Home Screen.

Translation drilling for someone who knows the words but freezes when they have
to produce a sentence. Prompt → say it → reveal → Fail or Pass. Hundreds of reps
a week, offline, on a commute.

The problem is retrieval under pressure, not vocabulary — so the rating is one
tap, a miss comes straight back, and the whole loop runs with no network.

## Using it

Opening the app puts you on a card. There is no home screen and no tab bar,
because there is nowhere else to be.

1. **A sentence appears**, with a box under it. Type the translation.
2. **جواب (Check).** You get the answer, the transliteration, and a word map —
   each Persian word over its English gloss. Tap a word for its part of speech.
   What you typed sits above the answer with a ✓ when it matches the reference
   or a listed alternative.
3. **غلط (wrong)** or **درست (right)**. Wrong comes back later in the same round.
   Right shows how many days until you see it again. Mis-tapped? **برگرد (Undo)**
   in the top corner.
4. At the end of a round, **یه دور دیگه (Another round)**, or **تنظیمات**.

A round is 20 cards: reviews that are due first, then new sentences from your
current level. 20 new cards a day is the cap, and it is deliberate — new cards
are what create tomorrow's reviews, so taking a hundred today buries you for a
week. **Sentences you add yourself are exempt**: you wrote it down because you
wanted it now.

There is no progress screen and no level screen. The gate still runs, unwatched;
clearing it moves you up between rounds and says so once.

**تنظیمات**, reached only from the end of a round, holds three things: your own
sentences, **Save a backup** — do that now and then, because iOS can clear a web
app's storage and nothing else holds a copy — and your level.

On a keyboard: <kbd>Enter</kbd> checks, <kbd>1</kbd> wrong, <kbd>2</kbd> right,
<kbd>U</kbd> undo.

## How it works

```
BUILD TIME (on the Mac, no network needed at run time)
  tools/         write, validate and annotate sentences
                 └─> web/data/seed_sentences.json, bundled into the app

RUN TIME
  ┌──────────────── PWA on the phone, fully offline ────────────────┐
  │  IndexedDB · SM-2 scheduler · CEFR level gate · service worker   │
  │  word map · answer check · backup file                           │
  └──────────────────────────────────────────────────────────────────┘
```

Everything the practice loop needs is local. There is no runtime dependency on
anything else.

## Repository layout

| Path | What it is |
|---|---|
| `web/` | The app. Static PWA, ES modules, no build step, no `node_modules` |
| `core/` | Shared Python: taxonomy, prompts, validation, Gemini client |
| `tools/` | Content pipeline — see below |
| `backend/`, `infra/` | **Parked.** A Cloud Run service and its Terraform, built then set aside when the GCP route was dropped. Nothing references them at run time |

## The content pipeline

| Tool | What it does |
|---|---|
| `generate_seed.py` | Adds model-generated sentences, optionally `--syllabus` to target core-verb gaps |
| `merge_handwritten.py` | Merges hand-written batches, through the same validation |
| `check_handwritten.py` | Checks a batch before it is merged: parts of speech, tags, register, and that the word map covers every word |
| `derive_breakdown.py` | Builds word mappings from the gloss already in the deck — no API |
| `augment.py` | Model-written breakdowns and alternatives for what cannot be derived |
| `fix_glosses.py` | Repairs word maps written before the gloss and part-of-speech rules existed |
| `coverage.py` | Reports core-verb coverage and what is still missing |
| `vocabulary.py` | Content-lemma exposure: what is met once and never again |
| `tenses.py` | Which tenses and constructions the deck actually contains |
| `check_deck.py` | Card-level mistakes: word maps that do not reconstruct their sentence, two meanings in one chip, two cards answering one prompt, split clitics |
| `review_deck.py` | Asks the model whether a native would say the sentence. Caches and resumes — the free tier is a daily ceiling |
| `prompt_harness.py` | Iterate prompts without a rebuild |
| `check_js.mjs` | Modules import, cross-module calls resolve, every `$('id')` and string key exists |
| `test_js.mjs` | Unit tests: scheduler, session selection, answer matching |

Every tool reads and writes `web/data/seed_sentences.json` — the file the app
ships — through `core/bank.py`, which also gives each sentence a stable id. The
app uses that id to land a corrected sentence on the row that already holds its
review history, so fixes to the deck reach existing devices.

## How the app decides what to show you

**Levels.** A1 → C1. New cards come only from your current level; due reviews
come from every level, so passing A1 does not mean forgetting it.

**The gate.** Three things must all hold: 60 distinct cards seen, 85% accuracy
over the last 40 reviews, and 30 cards past a 7-day interval. Retention is the
one that stops a level being crammed. Answer time is recorded on every review
but gates nothing yet.

**Scheduling.** SM-2. Fail is a lapse and returns the card this session; pass
follows the standard 1, 6, 15, 38, 95, 238-day progression. New cards are
capped per day, and the two directions of one sentence never share a round —
each is the other's answer.

## Getting it running

```bash
python3 -m http.server 8000 --directory web    # then open localhost:8000
```

To add content, write a batch into `tools/handwritten/`, then:

```bash
python3 tools/merge_handwritten.py
python3 tools/derive_breakdown.py
git diff --stat web/data     # the diff is the review
```

Deploys happen on push — `.github/workflows/pages.yml` runs the checks and
publishes `web/`.

## Things that will bite you

- **Apple has no Persian dictation**, and there is no free on-device Persian
  speech recognition anywhere on iOS. That is why the app checks typing rather
  than speech. Text-to-speech was there and is gone: it needed a Farsi voice
  installed by hand, so on the one device that matters it read nothing aloud.
- **Gemini retires models aggressively** and the free tier has a hard daily
  request ceiling shared across models. The client falls back through
  `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-flash-latest`.
- **Deleting a function by matching braces has eaten its neighbour three
  times** — walking backwards from `{` runs into the doc comment above the
  function before it. Every time the module still imported and the failure
  waited for a button press. `check_js.mjs` now resolves every cross-module
  call, so it fails in CI instead.
- **A sentence can pass every check and still be wrong.** `ما هوای بهار رو
  نمی‌دونیم` parses, validates and is not something anyone says. That is what
  `review_deck.py` is for; `check_deck.py` cannot see it.
- **iOS can evict web-app storage.** Install to the Home Screen rather than
  leaving it a browser tab, and save a backup from Settings now and then.
  Restoring maps through the Persian text, so it works on a new device too.

## Checks

```bash
node tools/check_js.mjs
node --test tools/test_js.mjs
python3 tools/check_deck.py
python3 tools/coverage.py
python3 tools/review_deck.py                 # model review, resumes on quota
```

## History

A native SwiftUI client was built first and removed in favour of the PWA,
because building for iOS requires Xcode. It is preserved in history:

```bash
git checkout f7f9bb7 -- FarsiVault FarsiVaultTests
```
