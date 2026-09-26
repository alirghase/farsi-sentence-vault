# Farsi Sentence Vault

**Live: <https://alirghase.github.io/farsi-sentence-vault/>** — open on a phone,
Share → Add to Home Screen.

Translation drilling for someone who knows the words but freezes when they have
to produce a sentence. Prompt → say it → reveal → Fail or Pass. Hundreds of reps
a week, offline, on a commute.

The problem is retrieval under pressure, not vocabulary — so the rating is one
tap, a miss comes straight back, and the whole loop runs with no network.

## Using it

1. **Today → شروع (Start).** A round is 20 cards: reviews that are due first,
   then new sentences from your current level.
2. **Say the sentence out loud**, or tap **تایپ (Type)** and write it.
3. **جواب (Reveal).** You get the answer, the transliteration, and a word map —
   each Persian word over its English gloss. Tap a word for its part of speech.
   If you typed, your answer is shown above the key with a ✓ when it matches
   the reference or a listed alternative.
4. **غلط (wrong)** or **درست (right)**. Wrong comes back later in the same round.
   Right shows how many days until you see it again. Mis-tapped? **برگرد (Undo)**
   in the top corner.
5. At the end, **یه دور دیگه (Another round)** or Exit.

Do the due reviews every day before anything else; new cards are what create
tomorrow's reviews. **Progress** shows the level gate, your streak and daily
target, a 14-day register, and which grammar features your misses cluster on.
**Settings** has new cards a day (default 20), cards per round (20), daily
target (40), level, audio, and **Save a backup** — do that now and then,
because iOS can clear a web app's storage and nothing else holds a copy.

On a keyboard: <kbd>Space</kbd> reveals, <kbd>1</kbd> wrong, <kbd>2</kbd> right,
<kbd>T</kbd> type, <kbd>P</kbd> play, <kbd>U</kbd> undo, <kbd>Esc</kbd> exit.
While typing, <kbd>Enter</kbd> reveals.

## How it works

```
BUILD TIME (on the Mac, no network needed at run time)
  tools/         write, validate and annotate sentences
                 └─> web/data/seed_sentences.json, bundled into the app

RUN TIME
  ┌──────────────── PWA on the phone, fully offline ────────────────┐
  │  IndexedDB · SM-2 scheduler · CEFR level gate · service worker   │
  │  word map · answer check · TTS · backup file                     │
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
| `derive_breakdown.py` | Builds word mappings from the gloss already in the deck — no API |
| `augment.py` | Model-written breakdowns and alternatives for what cannot be derived |
| `coverage.py` | Reports core-verb coverage and what is still missing |
| `check_mirror.py` | Guards the JS ↔ Python vocabularies against drift |
| `prompt_harness.py` | Iterate prompts without a rebuild |
| `check_js.mjs` | Every web module imports cleanly |
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

- **Apple has no Persian dictation.** There is no free on-device Persian speech
  recognition anywhere on iOS. Text-to-speech works if a Farsi voice is
  installed; the app detects this and hides the play button when it is not.
- **Gemini retires models aggressively** and the free tier has a hard daily
  request ceiling shared across models. The client falls back through
  `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-flash-latest`.
- **The error tag vocabulary is closed and duplicated** across Python and
  JavaScript. Run `check_mirror.py` after touching either: drift degrades
  adaptation silently, with no crash.
- **`SITUATIONS` in `web/js/taxonomy.js` looks unused.** It is parsed by
  `check_mirror.py`. Deleting it disables that check rather than breaking
  anything visible.
- **iOS can evict web-app storage.** Install to the Home Screen rather than
  leaving it a browser tab, and save a backup from Settings now and then.
  Restoring maps through the Persian text, so it works on a new device too.

## Checks

```bash
node tools/check_js.mjs
node --test tools/test_js.mjs
python3 tools/check_mirror.py
python3 tools/coverage.py
python3 tools/generate_seed.py --review      # register health
```

## History

A native SwiftUI client was built first and removed in favour of the PWA,
because building for iOS requires Xcode. It is preserved in history:

```bash
git checkout f7f9bb7 -- FarsiVault FarsiVaultTests
```
