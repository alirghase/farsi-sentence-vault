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

Free, HTTPS, permanent, and already set up for this repo. Two things are worth
knowing because they are easy to get wrong:

- **GitHub Pages does not work on private repos on the free plan.** The API
  refuses with *"Your current plan does not support GitHub Pages for this
  repository."* The repo is public for this reason.
- **Branch-based Pages can only serve `/` or `/docs`**, never an arbitrary
  folder. The app lives in `web/`, so deployment goes through
  `.github/workflows/pages.yml` instead. That workflow also gates every deploy
  on the module check, the JS/Python vocabulary check, and a non-empty seed bank.

Deploying is therefore just:

```bash
git add -A && git commit -m "..." && git push
```

Live at <https://alirghase.github.io/farsi-sentence-vault/>.

**On the phone:** open that URL in Safari → Share → **Add to Home Screen**.
Launch it from the Home Screen icon, not from the Safari tab — that is what
gives you the standalone window and durable storage.

**Checkpoint:** put the phone in airplane mode and complete a full session. No
network, no backend, no API key. That is the whole point of the design.

---

## Step 5 — Persian audio (optional)

The app reads reference sentences aloud if a Persian voice is installed.
On the phone: **Settings → Accessibility → Spoken Content → Voices → Farsi**,
download one, then reopen the app. Settings will confirm the voice was found.

If no voice is available the play button simply does not appear. Nothing breaks.

---

## Parked: the GCP backend

`backend/` and `infra/` hold a Cloud Run service and its Terraform, built and
validated but never deployed — the billing account needed reopening and the
route was dropped in favour of keeping the app self-contained.

Nothing in the app depends on them. Left in the repository because the work is
done and the decision may be revisited; `infra/README.md` has the detail if it
ever is.

---

## Where things can realistically go wrong

| Symptom | Cause | Fix |
|---|---|---|
| Changes do not appear | service worker cached the old files | it is network-first on localhost; elsewhere reload twice |
| Microphone does nothing | page is on plain HTTP | needs HTTPS — Step 4 Option B |
| No play button | no Persian voice installed | Step 5 |
| `429` during seed generation | free-tier rate limit | it retries and falls back automatically; wait |
| Today shows 0 new | seed JSON missing | re-run the `cp` at the end of Step 2 |
