# Setup, in order

No Xcode, no Apple ID, no App Store, no build step. The app is static files you
open in Safari and add to your Home Screen.

---

## Step 1 — Gemini API key

1. Go to <https://aistudio.google.com/apikey>, sign in, **Create API key**.
2. Store it where the tools look:

```bash
mkdir -p ~/.config/farsi-vault && printf '%s' 'YOUR-KEY' > ~/.config/farsi-vault/gemini_key && chmod 600 ~/.config/farsi-vault/gemini_key
```

`export GEMINI_API_KEY=...` also works for a single terminal session.

**Never paste a key into a chat, an issue, or a commit.** If you do, delete it
in AI Studio and create a new one.

### On models

Google retires models aggressively. `gemini-2.5-flash` was withdrawn from new
API keys and now returns **404** while still appearing in the model listing.
The client defaults to `gemini-3.6-flash` and falls back through
`gemini-3.5-flash` and `gemini-flash-latest`. To see what your key can reach:

```bash
curl -sS "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY&pageSize=100" | python3 -c "import sys,json;[print(m['name'].replace('models/','')) for m in json.load(sys.stdin).get('models',[]) if 'generateContent' in m.get('supportedGenerationMethods',[])]"
```

---

## Step 2 — Seed bank

~400 sentences, roughly 15 minutes. It saves after every batch, so if it stops,
re-run the same command and it resumes.

```bash
cd ~/projects/farsi-sentence-vault && python3 tools/generate_seed.py --count 400
```

Then the step not to skip:

```bash
python3 tools/generate_seed.py --review
```

Two things come back. A **register health summary** across the whole bank — if
"contain WRITTEN markers" is near 0%, the mechanical check passed. Then a
20-sentence sample with spoken markers annotated.

What is left is the part a script cannot do:

- **Read each Persian line out loud.** Not "is it correct" but "could I say this
  to a friend?"
- **Check the English matches.** The model can write good Farsi that means
  something slightly different from the prompt.
- **Send 10 to a Farsi-speaking relative.** Highest-value check available, costs
  one message. Ask "does this sound normal or weird?", not "is it correct" —
  the second invites a grammar lecture instead of a register judgement.

If it reads stiff, tighten `REGISTER_RULES` in `core/prompts.py`, delete
`tools/seed_sentences.json`, and regenerate.

Then put it in the app:

```bash
cp tools/seed_sentences.json web/data/seed_sentences.json
```

---

## Step 3 — Run it locally

```bash
python3 -m http.server 8000 --directory web
```

Open <http://localhost:8000>. You should see `0 due · 100 new`. Press Start and
do a few cards.

---

## Step 4 — Get it on your phone

The app needs **HTTPS** to install as a PWA and to use the microphone. Two ways.

### Option A — same WiFi, for a quick try

```bash
ipconfig getifaddr en0        # your Mac's local IP
python3 -m http.server 8000 --directory web
```

Open `http://YOUR-IP:8000` on the phone. Good enough to look at, but Safari
blocks the microphone on plain HTTP and will not install it properly.

### Option B — GitHub Pages, the real one

Free, HTTPS, and permanent.

```bash
cd ~/projects/farsi-sentence-vault
git add -A && git commit -m "Farsi Vault PWA"
gh repo create farsi-sentence-vault --private --source=. --push
```

Then in the repo's **Settings → Pages**, set source to `main` / `/web`. A minute
later it is live at `https://YOUR-USERNAME.github.io/farsi-sentence-vault/`.

**On the phone:** open that URL in Safari → Share → **Add to Home Screen**.
Launch it from the Home Screen icon, not from Safari — that is what gives you
the standalone window and durable storage.

**Checkpoint:** put the phone in airplane mode and complete a full session. No
network, no backend, no API key. That is the whole point of the design.

---

## Step 5 — Persian audio (optional)

The app reads reference sentences aloud if a Persian voice is installed.
On the phone: **Settings → Accessibility → Spoken Content → Voices → Farsi**,
download one, then reopen the app. Settings will confirm the voice was found.

If no voice is available the play button simply does not appear. Nothing breaks.

---

## Step 6 — The GCP backend (optional)

Needed only for grading typed/recorded answers and for adaptive daily batches.
Everything else works without it. Full detail in [`infra/README.md`](infra/README.md).

```bash
brew install --cask google-cloud-sdk
brew install hashicorp/tap/terraform

gcloud auth login
gcloud projects create farsi-vault-$RANDOM --name="Farsi Vault"
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default login
```

Attach a billing account at <https://console.cloud.google.com/billing>. GCP's
always-free tier requires a card, which is why the budget alert below is not
optional.

```bash
cp infra/example.tfvars infra/terraform.tfvars
openssl rand -base64 32        # api_token
gcloud billing accounts list   # billing_account
```

Fill in `infra/terraform.tfvars` — including `allowed_origins`, which must be
your GitHub Pages origin (e.g. `https://YOUR-USERNAME.github.io`) or the browser
will block every request.

```bash
cd infra && terraform init && terraform apply
cd .. && bash infra/deploy.sh YOUR_PROJECT_ID
```

Put the printed URL and your token into the app's **Settings**, then tap
**Test connection**.

---

## Where things can realistically go wrong

| Symptom | Cause | Fix |
|---|---|---|
| Changes do not appear | service worker cached the old files | it is network-first on localhost; elsewhere reload twice |
| Microphone does nothing | page is on plain HTTP | needs HTTPS — Step 4 Option B |
| No play button | no Persian voice installed | Step 5 |
| Sync: "rejected the token" | token mismatch | compare Settings against `terraform.tfvars` |
| Sync fails in browser only | CORS | `allowed_origins` must match your Pages origin exactly |
| `429` during seed generation | free-tier rate limit | it retries and falls back automatically; wait |
| Today shows 0 new | seed JSON missing | re-run the `cp` at the end of Step 2 |
