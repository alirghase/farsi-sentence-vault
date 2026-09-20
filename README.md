# Farsi Sentence Vault

**Live: <https://alirghase.github.io/farsi-sentence-vault/>** — open on a phone,
Share → Add to Home Screen.

Translation drilling for someone who knows the words but freezes when they have
to produce a sentence. Prompt → say it → reveal → Fail or Pass. Hundreds of reps
a week, offline, on a commute.

The problem is retrieval under pressure, not vocabulary — so the card is timed,
the rating is one tap, and the whole loop runs with no network.

## How it works

```
BUILD TIME (on the Mac, no network needed at run time)
  tools/         write, validate and annotate sentences
                 └─> web/data/seed_sentences.json, bundled into the app

RUN TIME
  ┌──────────────── PWA on the phone, fully offline ────────────────┐
  │  IndexedDB · SM-2 scheduler · CEFR level gate · service worker   │
  │  word map · pace timing · TTS · audio recording                  │
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
| `generate_seed.py` | Generates sentences, optionally `--syllabus` to target core-verb gaps |
| `merge_handwritten.py` | Merges hand-written batches, through the same validation |
| `derive_breakdown.py` | Builds word mappings from the gloss already in the deck — no API |
| `augment.py` | Model-written breakdowns and alternatives for what cannot be derived |
| `coverage.py` | Reports core-verb coverage and what is still missing |
| `check_mirror.py` | Guards the JS ↔ Python vocabularies against drift |
| `prompt_harness.py` | Iterate prompts without a rebuild |
| `check_js.mjs` | Every web module imports cleanly |

## How the app decides what to show you

**Levels.** A1 → C1. New cards come only from your current level; due reviews
come from every level, so passing A1 does not mean forgetting it.

**The gate.** Four things must all hold: 60 distinct cards seen, 85% accuracy
over the last 40 reviews, 30 cards past a 7-day interval, and 60% of answers
produced inside their target time. Retention stops a level being crammed; pace
stops you passing while still needing ten seconds a sentence.

**Scheduling.** SM-2. Fail is a lapse and returns the card this session; pass
follows the standard 1, 6, 15, 38, 95, 238-day progression.

## Getting it running

```bash
python3 -m http.server 8000 --directory web    # then open localhost:8000
```

To add content, write a batch into `tools/handwritten/`, then:

```bash
python3 tools/merge_handwritten.py
python3 tools/derive_breakdown.py
cp tools/seed_sentences.json web/data/
```

Deploys happen on push — `.github/workflows/pages.yml` runs the checks and
publishes `web/`.

## Things that will bite you

- **Apple has no Persian dictation.** There is no free on-device Persian speech
  recognition anywhere on iOS. Text-to-speech works if a Farsi voice is
  installed; the app detects this and hides listening entirely when it is not.
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
  leaving it a browser tab.

## Checks

```bash
node tools/check_js.mjs
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
