# Farsi Sentence Vault

Translation drilling for people who know the words but freeze when they have to
speak. Prompt → produce the sentence → check → rate. Hundreds of reps a week,
offline, on a commute.

The problem this targets is retrieval under pressure, not vocabulary. So the
default path costs **zero taps until Reveal**: read the prompt, say the Farsi
out loud, tap to check, tap to rate.

## How it fits together

```
BUILD TIME (once, on the Mac)
  tools/generate_seed.py ──> Gemini ──> seed_sentences.json ──┐
                                                              │ bundled
RUN TIME                                                      ▼
  ┌──────────────────────── iPhone (offline) ────────────────────┐
  │  SwiftData · SM-2 scheduler · Farsi TTS · audio recording    │
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

`core/` is shared by the seed generator and the Cloud Run service, so the
prompts, error taxonomy, and validation cannot drift between them.
`tools/check_mirror.py` additionally guards the Swift copy of the taxonomy.

## Repository layout

| Path | What it is |
|---|---|
| `core/` | Shared Python: Gemini client, prompts, taxonomy, validation |
| `tools/` | One-off CLIs: seed generation, prompt iteration, drift check |
| `backend/` | FastAPI service deployed to Cloud Run |
| `infra/` | Terraform for the whole GCP footprint |
| `FarsiVault/` | The iOS app (SwiftUI + SwiftData) |
| `FarsiVaultTests/` | Unit tests for the scheduler, taxonomy, and models |

## Getting it running

### 1. Seed bank

```bash
export GEMINI_API_KEY=...            # aistudio.google.com/apikey
python3 tools/generate_seed.py --count 400
python3 tools/generate_seed.py --review
```

**Read the review output before shipping it.** Bad reference sentences teach bad
Farsi, and it is the one failure the app cannot detect on its own. If the Persian
reads like a newsreader rather than a friend, fix the register rules in
`core/prompts.py` and regenerate.

Then move the output into the app bundle:

```bash
cp tools/seed_sentences.json FarsiVault/Resources/
```

### 2. Backend

See [`infra/README.md`](infra/README.md). Short version:

```bash
cp infra/example.tfvars infra/terraform.tfvars   # fill in
cd infra && terraform init && terraform apply
cd .. && bash infra/deploy.sh YOUR_PROJECT_ID
```

The backend is optional. With no URL configured the app calls Gemini directly
from the phone — useful before deploying, but the key then lives on the device
and there is no server-side usage cap.

### 3. App

```bash
brew install xcodegen
xcodegen generate
open FarsiVault.xcodeproj
```

Set your Apple ID under Signing & Capabilities, then run on a device.

## Things worth knowing before you build on this

- **Apple does not support Persian dictation.** Farsi is absent from the iOS
  Dictation language list, so there is no free on-device Persian speech
  recognition. Recordings are transcribed by Gemini at sync time. Farsi *speech
  synthesis* does work, which is why playback is on-device and free.
- **Free Apple accounts cannot use iCloud, Push, or App Groups.** That rules out
  iCloud sync and any server-initiated notification, which is why the design is
  plain HTTPS and pull-only.
- **A free provisioning profile expires after 7 days** and the app then stops
  launching — not a warning, it simply dies until you rebuild from Xcode. Free
  accounts also cap at 3 apps per device. The $99/yr programme removes this;
  worth paying only once daily use is proven.
- **GCP's free tier needs a billing account.** Three guardrails exist because of
  that: instance caps, per-day model-call limits enforced in Firestore, and a
  budget alert. See `infra/README.md`.
- **The error tag vocabulary is closed and duplicated** across Python and Swift
  by necessity. Run `python3 tools/check_mirror.py` after touching either — if
  they drift, adaptation degrades silently, with no crash.

## Tests

```bash
python3 tools/check_mirror.py        # Swift ↔ Python vocabulary
xcodebuild test -scheme FarsiVault -destination 'platform=iOS Simulator,name=iPhone 17'
```
