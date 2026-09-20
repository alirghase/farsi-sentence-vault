# Architecture

*Written 2026-09-20. Free-tier figures are as of that date and change; re-check
before relying on them.*

## The test

Every component below had to answer one question: **what breaks if it isn't
there?** Anything that only answered "it would look less impressive" was cut,
and the cuts are listed, because the list is the actual argument.

The app is a PWA on GitHub Pages with IndexedDB as the source of truth. It works
with no backend at all. That is the baseline any proposed component has to beat.

## What actually needs a server

Three things, and only three.

**1. Generation is quota-bound, not compute-bound.** The deck is built by
prompting Gemini, validating the result, and merging. The free tier allows a few
dozen requests a day, so a laptop session burns the ceiling in twenty minutes
and stops — which is exactly what happened on the last four runs, including the
one that ended at 730 of 778 sentences. Spreading generation across nightly
batches converts a hard ceiling into a slow drip. That needs something that
wakes up without me.

**2. Grading can't ship its own key.** Grading a typed answer means a Gemini
call. Today the PWA can call Gemini directly and that is fine *for one user with
their own key*. The moment a stranger uses it, a shipped key is a leaked key.
A proxy that holds the key is the only honest option.

**3. Rejected generations are the interesting data.** `core/validate.py`
already partitions a batch into accepted and rejected with a reason attached.
Right now the rejects are printed and lost. They are the failure-analysis
dataset — which prompts produce written-register forms, which produce
out-of-vocabulary tags — and they need somewhere to live.

Everything else the app does, it does better offline.

## The design

```
                        ┌──────────────────────────────┐
  GitHub Pages ────────▶│  PWA — IndexedDB, SM-2, SW   │
  (deck ships as a      │  works fully offline         │
   static JSON asset)   └──────────────┬───────────────┘
        ▲                              │ typed answer, only when online
        │ merge                        ▼
  ┌─────┴────────┐            ┌─────────────────────┐
  │  Pull request │           │ Cloud Run service   │
  │  HUMAN GATE   │           │   /v1/grade         │
  └─────┬─────────┘           │ • key in Secret Mgr │
        │ opens PR            │ • cache on (id,     │
        │                     │   normalised answer)│
  ┌─────┴──────────────┐      │ • per-caller quota  │
  │ Cloud Run JOB      │      │ • cost logged/call  │
  │  deck-builder      │      └─────────────────────┘
  │  nightly           │
  │ 1. read gap report │      ┌─────────────────────┐
  │ 2. retrieve near   │─────▶│ Firestore           │
  │    neighbours      │      │ • coverage counters │
  │ 3. generate        │      │ • quarantine + why  │
  │ 4. validate        │      │ • grade cache       │
  │ 5. quarantine bad  │      └─────────────────────┘
  │ 6. open PR w/ good │
  └────────┬───────────┘      ┌─────────────────────┐
           │                  │ Billing budget +    │
  Cloud Scheduler ───────────▶│ alert at 50/90/100% │
                              └─────────────────────┘
```

### The generation path becomes a Job, not an endpoint

This is the one change to the parked infra that matters, and it is a security
fix rather than a preference.

`infra/main.tf` currently exposes the Cloud Run service to `allUsers`, because
the iPhone can't obtain a Google identity token on a free Apple account. That
concession is reasonable *for grading*. But `/internal/generate` lives on the
same service, so the nightly generation path is also publicly reachable, and is
defended only by a shared bearer token that Cloud Scheduler sends in a plain
header — alongside an OIDC token that the public invoker setting makes
meaningless. Two auth mechanisms, one of which is a static secret in a header,
guarding the thing that can burn the entire Gemini quota.

Splitting generation into a **Cloud Run Job** removes the HTTP surface
completely. Scheduler invokes jobs through the Run Admin API with IAM. No
public endpoint, no shared secret, nothing to find by URL-guessing. The
`allUsers` concession shrinks to the one endpoint that genuinely needs it.

### The pull request is the approval gate

Today `/internal/generate` writes generated sentences straight into the store.
An agent writing unreviewed content into the thing I study from is how my Farsi
quietly acquires the model's errors.

Instead the job opens a PR against this repo. Merging is a human action; merging
triggers the existing Pages deploy. Bounded autonomy with a real gate, and the
PR diff is a readable record of what the agent proposed and what I rejected.

### Retrieval, because it saves quota

Before generating a sentence targeting an under-exposed word, retrieve the
existing sentences nearest to it and put them in the prompt as "already covered,
don't repeat these; match this register."

This is genuine RAG with a measurable purpose: `validate.dedupe()` currently
throws away near-duplicates *after* paying for them. Retrieving first moves that
check in front of the spend. When the ceiling is 20-odd requests a day, a
duplicate is not an annoyance, it's a lost day.

778 sentences of embeddings is a small file loaded into the job's memory. Exact
nearest-neighbour over a thousand vectors is a dot product. There is no vector
database here.

## What I cut, and why

| Cut | Why it doesn't earn its place |
|---|---|
| **Vertex AI model serving** | There is no model. The scheduler is SM-2 — 81 lines of deterministic arithmetic. An endpoint serving nothing is a line on a diagram, not a system. |
| **Training anything** | One user's review log is n≈1. A "difficulty predictor" fit on my own 800 reviews predicts my mood, not difficulty. |
| **Vector database** | 778 vectors. In-process nearest-neighbour is faster than a network hop to a managed index. |
| **Pub/Sub** | One publisher, one consumer, once a night. A queue between them adds a delivery-semantics problem I don't have. |
| **BigQuery** | The entire review history is a few MB. Firestore export plus local DuckDB answers every question I'd ask. Revisit only if strangers generate a real event stream. |
| **Dataflow / Composer / GKE** | A nightly batch of a few hundred rows. A cron and a container is the correct size. |
| **Load balancer + Cloud CDN** | GitHub Pages already serves the PWA globally for free. |
| **Multi-region, autoscaling, SLOs** | The app is offline-first. If the backend is down the user loses *grading*, not the app. Engineering for uptime I don't need is the opposite of the cost discipline this is meant to show. |

## Where the four areas are genuinely proven — and where they aren't

**Data engineering — proven.** A gap-driven generation pipeline with a
validation gate, a quarantine path that keeps rejects *with their failing rule*,
idempotent nightly batches, and coverage counters that decide what gets
generated next. It exists because the deck has real gaps (شما once in 549
sentences), not to have a pipeline.

**Agent systems — proven.** An agent with a typed tool contract, retrieval
grounding, a closed output vocabulary enforced by a validator, a quarantine for
failures, and a human merge gate. The bounded-autonomy story is concrete:
the agent can propose, it cannot publish.

**Cost and reliability — proven, and it's the strongest part.** The binding
constraint is a free-tier quota, so cost isn't a nice-to-have metric, it's the
thing that decides whether the system runs tomorrow. Response caching keyed on
(sentence, normalised answer), small-model routing, a per-caller daily cap, cost
logged per grade, and a billing budget that alarms at 50/90/100%. Publishable
number: **cost per graded sentence, and cache hit rate.**

**Production ML — not proven, and I'm not going to fake it.** The honest
position is that this app has no model worth serving *yet*. The one real ML
question — which card to show next, and when — is currently answered by a 1987
heuristic. The right move is to instrument now (`msToReveal` is already being
recorded) and model later, when there is enough data from enough people for a
recall-probability model to mean anything. If it ever gets there, FSRS ships
with published default parameters and can be fitted per-user on-device, which
would still need no serving infrastructure.

Saying "I chose not to build this, here's the evidence threshold that would
change my mind" is a stronger signal than a Vertex endpoint wrapping a
scikit-learn model trained on my own homework.

## Cost

The GCP side is designed to sit inside free tiers: Cloud Scheduler (3 jobs
free), Firestore's daily free quota, Secret Manager's free active versions,
Cloud Logging's monthly free allotment, and a nightly job measured in minutes of
CPU. The billing budget in `infra/main.tf` already alarms at 50/90/100% and
exists precisely because "this should cost nothing" is an assumption, not a
fact — a retry storm or a leaked token is what it's there to catch.

The real budget is the Gemini free tier. That is what the caching, the routing,
the per-caller cap and the retrieval-before-generation are all defending.

## Build order

1. **Eval harness first.** Held-out answers with ground truth, including the
   failure mode that would actually make someone quit: a *valid alternative*
   marked wrong. Runs in CI on every prompt change. Nothing below is safe to
   automate until this exists — it's also the piece closest to the work already
   proven at Lloyds, but public and on my own data.
2. **Generation as a Cloud Run Job**, with quarantine and the PR gate. Removes
   the public generation endpoint and the shared bearer secret.
3. **Retrieval before generation.** Measure duplicates-per-batch before and
   after; that delta is the whole justification.
4. **Grading proxy** — only when a stranger actually needs it. Until then the
   direct-Gemini path with the user's own key is strictly better: no server, no
   cost, no key to leak.

Step 4 is deliberately last. Building a multi-tenant grading service before a
second user exists is the same mistake as the Vertex endpoint, just less
obvious.
