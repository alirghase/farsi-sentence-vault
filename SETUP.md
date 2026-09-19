# Setup, in order

Ordered so the long download runs while you do useful work, and so you have a
working app on your phone **before** any cloud infrastructure exists.

Checked on this machine: macOS 26.6.2, 54 GB free, Homebrew present, no Xcode,
no gcloud, no Terraform.

---

## Step 1 — Start the Xcode download NOW

It is 10–15 GB and everything else waits on it, so start it before reading on.

**Mac App Store** is the simplest route: open the App Store, search **Xcode**,
click Get. It is free.

<details>
<summary>Alternative: direct download (more control, resumable)</summary>

Go to <https://developer.apple.com/download/all/>, sign in with any free Apple
ID, search "Xcode", download the `.xip`, then double-click to unarchive and drag
`Xcode.app` into `/Applications`. Worth it if the App Store download stalls,
which it sometimes does.
</details>

**On disk space:** you have 54 GB free. Xcode plus one iOS simulator runtime is
roughly 25–40 GB. It will fit, but it is not roomy — if the installer complains,
clear space before retrying rather than part-way through.

While it downloads, go to Step 2. Come back at Step 4.

---

## Step 2 — Get a Gemini API key

1. Go to <https://aistudio.google.com/apikey>
2. Sign in, click **Create API key**
3. Copy it

Store it where the tools will find it:

```bash
export GEMINI_API_KEY='paste-your-key-here'
```

That lasts for the current terminal session only. To keep it:

```bash
mkdir -p ~/.config/farsi-vault && printf '%s' 'paste-your-key-here' > ~/.config/farsi-vault/gemini_key && chmod 600 ~/.config/farsi-vault/gemini_key
```

The tooling checks the environment variable first, then that file.

**Never paste a key into a chat, an issue, or a commit.** If you do, delete it in
AI Studio and create a new one — a leaked key is someone else's free quota, billed
against your account's limits.

### A note on models

Google retires models fairly aggressively. `gemini-2.5-flash` was withdrawn from
new API keys and now returns **404** even though it still appears in the model
listing, which is a confusing failure.

The client defaults to `gemini-3.6-flash` and falls back automatically through
`gemini-3.5-flash` and `gemini-flash-latest` on a 404 or a persistent 503, so a
future retirement degrades instead of breaking. To see what your key can reach:

```bash
curl -sS "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY&pageSize=100" | python3 -c "import sys,json;[print(m['name'].replace('models/','')) for m in json.load(sys.stdin).get('models',[]) if 'generateContent' in m.get('supportedGenerationMethods',[])]"
```

---

## Step 3 — Generate the seed bank, and actually read it

This is the content you will drill for months. It takes ~10 minutes of API calls.

```bash
cd ~/projects/farsi-sentence-vault && python3 tools/generate_seed.py --count 400
```

You should see progress like `  120/400  (+20 kept, -1 invalid, -0 dupes, 94s)`.
It saves after every batch, so if it stops you can re-run the same command and it
resumes.

Then — **the step not to skip**:

```bash
python3 tools/generate_seed.py --review
```

Read the Persian out loud. You are checking one thing: does this sound like a
friend talking, or like a newsreader? You are the only one who can judge this,
and it is the single failure the app cannot detect on its own.

- **Sounds natural** → continue.
- **Sounds stiff or bookish** (می‌روم rather than می‌رم, است rather than ـه) →
  the register rules need tightening. Open `core/prompts.py`, strengthen
  `REGISTER_RULES`, delete `tools/seed_sentences.json`, and regenerate. Tell me
  what felt wrong and I will tune it.

Once you are happy:

```bash
cp tools/seed_sentences.json FarsiVault/Resources/
```

---

## Step 4 — Finish the Xcode install

Once it has downloaded:

1. Open Xcode once and let it install additional components.
2. Point the command line at it (this one needs your password):

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

3. Accept the licence:

```bash
sudo xcodebuild -license accept
```

**Checkpoint:** `xcodebuild -version` should print a version rather than an error.
This also repairs Homebrew, which is currently refusing to install anything
because the Command Line Tools are stale.

---

## Step 5 — Generate the Xcode project

```bash
brew install xcodegen && cd ~/projects/farsi-sentence-vault && xcodegen generate
```

**Checkpoint:** `FarsiVault.xcodeproj` now exists.

```bash
open FarsiVault.xcodeproj
```

---

## Step 6 — Run the tests

Before touching a phone, confirm the logic is sound. In Xcode press **⌘U**, or:

```bash
cd ~/projects/farsi-sentence-vault && xcodebuild test -scheme FarsiVault -destination 'platform=iOS Simulator,name=iPhone 17' 2>&1 | tail -20
```

This is the first time these tests have ever executed — I could not run them
without Xcode. If anything fails, send me the output.

---

## Step 7 — Get it onto your iPhone

1. **Xcode → Settings → Accounts → +** and sign in with your Apple ID. You will
   get a team called *Your Name (Personal Team)*.
2. Select the **FarsiVault** target → **Signing & Capabilities** → set **Team**
   to your personal team.
3. Change the **Bundle Identifier** to something unique to you, e.g.
   `com.alireza.farsivault`. `com.farsivault.app` may already be taken, and the
   error Xcode gives for that is not obvious.
4. Plug your iPhone in, unlock it, tap **Trust** on the prompt.
5. Pick your iPhone from the run-destination menu at the top, then press **⌘R**.
6. First launch will fail with an untrusted-developer error. On the phone:
   **Settings → General → VPN & Device Management → your Apple ID → Trust**.
   Then launch the app again from the home screen.

**Checkpoint:** the app opens and Today shows counts like `0 due · 800 new`
(400 sentences × 2 directions). Put the phone in airplane mode and do a full
session — this is the thing the whole design exists for, and it needs no network,
no backend, and no API key.

**Remember:** on a free Apple ID this build stops launching after 7 days. Re-plug
and press ⌘R to get another week.

---

## Step 8 — Optional: use it without any backend

If you want grading before building the GCP side, open the app's **Settings**,
leave the backend URL empty, and paste your Gemini key under **Direct mode**.
Sync will then call Gemini straight from the phone.

Fine for testing. The key lives on the device and there is no server-side usage
cap, which is exactly what the backend fixes.

---

## Step 9 — The GCP backend

Only worth doing once Steps 1–7 work. Full detail in
[`infra/README.md`](infra/README.md).

**9a. Install the tools** (Homebrew works again after Step 4):

```bash
brew install --cask google-cloud-sdk && brew install hashicorp/tap/terraform
```

**9b. Create a project and attach billing:**

```bash
gcloud auth login
gcloud projects create farsi-vault-$RANDOM --name="Farsi Vault"
```

Then attach a billing account at
<https://console.cloud.google.com/billing> — GCP's always-free tier requires a
card on file. This is the part of the plan that is free-unless-misconfigured, so
do not skip the budget in 9c.

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default login
```

**9c. Fill in the variables:**

```bash
cp infra/example.tfvars infra/terraform.tfvars
openssl rand -base64 32        # use this as api_token
gcloud billing accounts list   # use this as billing_account
```

Edit `infra/terraform.tfvars` with your project ID, Gemini key, the token, the
billing account, and your email for budget alerts. It is gitignored.

**9d. Apply:**

```bash
cd infra && terraform init && terraform apply
```

**9e. Deploy the service:**

```bash
cd ~/projects/farsi-sentence-vault && bash infra/deploy.sh YOUR_PROJECT_ID
```

**Checkpoint:** the script ends by printing a URL and a health check. Put that
URL and your `api_token` into the app's Settings and tap **Test connection** —
it should say `OK — service is up`.

**9f. Confirm the nightly job:**

```bash
gcloud scheduler jobs run farsi-nightly-generate --location=europe-west2
```

Then check Firestore in the console for a `sentences` collection filling up.

---

## Where things can realistically go wrong

| Symptom | Cause | Fix |
|---|---|---|
| `xcodebuild requires Xcode` | `xcode-select` still points at CLT | Step 4 |
| Homebrew refuses to install | stale Command Line Tools | Step 4 fixes it |
| "Failed to register bundle identifier" | bundle ID already taken | Step 7.3 — make it unique |
| App dies after a week | free provisioning expired | re-plug, ⌘R |
| App opens but Today says 0 new | seed JSON not in the bundle | re-do end of Step 3, re-run `xcodegen generate` |
| No Persian audio | no Farsi voice installed | iPhone Settings → Accessibility → Spoken Content → Voices → Farsi |
| Sync says "backend rejected the token" | token mismatch | compare Settings against `infra/terraform.tfvars` |
| `429` during seed generation | free-tier rate limit | it retries automatically; just wait |
