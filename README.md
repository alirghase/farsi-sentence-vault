# Farsi Sentence Vault

Translation drilling for people who know the words but freeze when they have to
speak. Prompt → produce the sentence out loud → reveal → rate. Hundreds of reps
a week, offline, on a commute.

The problem is retrieval under pressure, not vocabulary. So the default path
costs **zero taps until Reveal**: read the prompt, say the Farsi aloud, tap to
check, tap to rate. Typing and recording are opt-in per card.

## How it fits together

```
BUILD TIME (once, on the Mac)
  tools/generate_seed.py ──> Gemini ──> seed_sentences.json ──┐
                                                              │ bundled
RUN TIME                                                      ▼
  ┌────────────── PWA on the phone (offline) ────────────────────┐
  │  IndexedDB · SM-2 scheduler · service worker · MediaRecorder │
  └────────────────────────────┬─────────────────────────────────┘
                               │ HTTPS, only when you tap Sync
                               ▼
  ┌──────────────────────── GCP ─────────────────────────────────┐
  │  Cloud Run (FastAPI)  ──>  Gemini 3.6 Flash                  │
  │    ├─ grade attempts (text + audio) → scores, error tags     │
  │    └─ generate next batch, weighted to your weak spots       │
  │  Firestore · Secret Manager · Cloud Scheduler (05:00 nightly)│
  └──────────────────────────────────────────────────────────────┘
```

Everything in the practice loop is local. Sync is the only network boundary and
it is a pull — nothing is pushed to the phone.

`core/` is shared by the seed generator and the Cloud Run service, so prompts,
taxonomy, and validation cannot drift between them. `tools/check_mirror.py`
guards the JavaScript copy of the taxonomy on top of that.

## Repository layout

| Path | What it is |
|---|---|
| `core/` | Shared Python: Gemini client, prompts, taxonomy, validation |
| `tools/` | One-off CLIs: seed generation, prompt iteration, drift checks |
| `backend/` | FastAPI service deployed to Cloud Run |
| `infra/` | Terraform for the whole GCP footprint |
| `web/` | The app: static PWA, no build step, ES modules |

There is no bundler and no `node_modules`. `web/` is served as-is.

## Getting it running

Step-by-step, in order, is in [SETUP.md](SETUP.md). Short version:

```bash
export GEMINI_API_KEY=...                       # aistudio.google.com/apikey
python3 tools/generate_seed.py --count 400      # ~15 min
python3 tools/generate_seed.py --review         # READ THIS
cp tools/seed_sentences.json web/data/

python3 -m http.server 8000 --directory web     # open http://localhost:8000
```

The backend is optional — the app practises offline without it. Only grading
and new batches need it. See [`infra/README.md`](infra/README.md).

## Things worth knowing before building on this

- **Apple does not support Persian dictation.** Farsi is absent from the iOS
  Dictation language list, so there is no free on-device Persian speech
  recognition anywhere on the platform. Recordings are transcribed by Gemini at
  sync time instead.
- **Persian text-to-speech depends on an installed system voice.** iOS Safari
  exposes only voices present on the device. The app detects this and hides
  playback rather than failing; Settings explains how to add one.
- **Gemini retires models aggressively.** `gemini-2.5-flash` now 404s for new
  API keys while still appearing in the model listing. The client defaults to
  `gemini-3.6-flash` and falls back through `gemini-3.5-flash` and
  `gemini-flash-latest`, so a retirement degrades rather than breaks.
- **GCP's free tier needs a billing account.** Three guardrails exist because of
  that: instance caps, per-day model-call limits enforced in Firestore, and a
  budget alert. See `infra/README.md`.
- **The error tag vocabulary is closed and duplicated** across Python and
  JavaScript. Run `python3 tools/check_mirror.py` after touching either — if
  they drift, adaptation degrades silently, with no crash.
- **iOS can evict web-app storage.** The app requests persistent storage and the
  backend holds a copy of everything that matters, but install it to the Home
  Screen rather than leaving it a browser tab.

## Checks

```bash
python3 tools/check_mirror.py     # JS ↔ Python vocabulary
node tools/check_js.mjs           # web modules import cleanly
python3 -m py_compile backend/*.py core/*.py
cd infra && terraform validate
```

## History

A native SwiftUI client was built first and removed in favour of the PWA,
because building for iOS requires Xcode and the download was blocking all
progress. It is preserved in git history:

```bash
git checkout f7f9bb7 -- FarsiVault FarsiVaultTests
```
