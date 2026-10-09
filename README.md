# Farsi Sentence Vault

**Live: <https://alirghase.github.io/farsi-sentence-vault/>** — open on a phone,
Share → Add to Home Screen.

Translation drilling for someone who knows the words but freezes when they have
to produce a sentence. Prompt → type it → check → wrong or right. Hundreds of
reps a week, offline, on a commute.

The problem is retrieval under pressure, not vocabulary — so the rating is one
tap, a miss comes straight back, and the whole loop runs with no network.

## Using it

Opening the app puts you on a card. There is no home screen and no tab bar,
because there is nowhere else to be.

1. **A prompt appears**, with a box under it. Type your answer.
2. **جواب (check)** shows the answer, the transliteration and a word map — each
   Persian word over its English gloss; tap a word for its part of speech. A ✓
   appears if what you typed matches the answer or a listed alternative.
3. **غلط (wrong)** or **درست (right)**. Wrong comes back later in the same round.
   Right shows how many days until you see it again. **برگرد** undoes a mis-tap.

On a keyboard: <kbd>Enter</kbd> checks, <kbd>1</kbd> wrong, <kbd>2</kbd> right,
<kbd>U</kbd> undo.

### The four kinds of card

| Kind | What you do |
|---|---|
| **Translation** (60% of a round) | English → Persian, or Persian → English. Each direction is scheduled separately |
| **Transformation** | Change a sentence you know by a rule: *منفی‌ش کن* (negate), *بذارش گذشته* (past), *به شما بگو*, *جمعش کن* (plural) |
| **Swap** | Keep the frame, change one piece: *با «ما» بگو* turns *یه قهوه می‌خوام* into *یه قهوه می‌خوایم*. The piece is a pronoun (subject, possessive or object), a verb or modal, or a phrase (question word, time word, how a request opens) |
| **Reply** | Something is said to you in Persian and you answer in Persian. Nothing on the front is English. Many replies are right, so a model answer and a few others are shown and the verdict is yours |

Transformations and swaps together are a quarter of a round, replies 15%.

**Immersion** (Settings, on by default): the English meaning of a drill and the
transliteration under each answer stay behind a small tap — **معنی**, **تلفظ** —
instead of next to the Persian.

### The round, and what it never does

**The round does not end.** Due reviews come first, then new sentences from your
level, then cards you already know, least recently practised first.

Those extra cards record that you practised and nothing else. Drilling a card
five times tonight says nothing about whether you will know it in a fortnight,
so letting it move a due date would feed the scheduler the one input it must not
have.

**New cards come commonest first.** Each sentence carries the share of it made
of core words — the ~300 everyday words and 48 verbs listed in `core/syllabus.py`
that most speech is made of — and new cards are introduced highest share first,
so *نمی‌دونم* and *یه قهوه می‌خوام* arrive before a sentence about a dripping tap.

**40 new cards a day** (`NEW_PER_DAY` in `web/js/session.js`) caps introduction,
not practice: every new card becomes several reviews over the next fortnight.
Sentences you add yourself are exempt.

**Scheduling** is SM-2: a fail is a lapse and returns the card this round; a pass
follows 1, 6, 15, 38, 95, 238 days.

**Levels** run A1 → C1. New cards come from your current level only; due reviews
come from every level. The gate runs unwatched between rounds and moves you up
when three things hold: 60 distinct cards seen, 85% accuracy over the last 40
reviews, and 30 cards past a 7-day interval.

**+** on the card writes a sentence of your own, drillable at once. **تنظیمات**
(from the end of a round) holds immersion, your level, and **Save a backup** —
do that now and then: iOS can clear a web app's storage and nothing else holds a
copy. Restoring maps through the Persian text, so it works on a new device.

## Repository

```
web/    the app: static PWA, ES modules, no build step, no node_modules
        data/  seed_sentences.json (the deck), transforms.json (transformation
               and swap drills), replies.json
core/   the checks a sentence must pass, and where the deck lives
tools/  adding content and checking it
        handwritten/          batches of sentences, each with a word map
        handwritten/drills/   the sources of the swaps and the replies
```

Run it locally: `python3 -m http.server 8000 --directory web`.

### Adding content

Sentences — write a batch into `tools/handwritten/` (see any existing file for
the shape; every sentence carries its word map), then:

```bash
python3 tools/check_handwritten.py   # does the word map cover every word?
python3 tools/merge_handwritten.py   # validates, skips duplicates, adds
git diff --stat web/data             # the diff is the review
```

Swaps and replies — add a frame to `tools/handwritten/drills/swaps*.json`, or an
exchange to `replies*.json`, then:

```bash
python3 tools/build_swaps.py --write
python3 tools/build_replies.py --write
```

A frame is the versions of one sentence written out; the builder refuses one
with a bookish form, a repeated version or a shared cue. In both files `~`
stands for the half-space (ZWNJ), so they can be read and diffed.

Everything is hand-written and goes through `core/validate.py` — spoken Tehrani
(*می‌رم*, not *می‌روم*), a closed set of tags and situations, a word map that
rebuilds its sentence. The 238 transformation drills were machine-written and
read line by line before they went in.

### Checks

```bash
node tools/check_js.mjs              # modules import, calls resolve, every $('id') and string key exists
node --test tools/test_js.mjs        # scheduler, session selection, answer matching, every shipped drill
python3 tools/check_deck.py          # card-level mistakes: word maps that do not rebuild their
                                     # sentence, two cards answering one prompt, colliding ids
python3 tools/coverage.py            # core verbs and core words met in fewer than 3 cards
python3 tools/tenses.py              # which tenses the deck actually contains
python3 tools/vocabulary.py          # what is met once and never again
```

Deploys happen on push to `master`: `.github/workflows/pages.yml` runs the
checks and publishes `web/`.

## Things that will bite you

- **Apple has no Persian dictation**, and no free on-device Persian speech
  recognition on iOS, so the app checks typing rather than speech. Text-to-speech
  was there and is gone: it needed a Farsi voice installed by hand.
- **A sentence can pass every check and still be wrong.** `ما هوای بهار رو
  نمی‌دونیم` parses, validates, and is not something anyone says. Nothing here can
  see that; a native speaker can.
- **iOS can evict web-app storage.** Install to the Home Screen rather than
  leaving it a tab, and save a backup from Settings now and then.
- **Deleting a function by matching braces has eaten its neighbour three times.**
  `check_js.mjs` resolves every cross-module call so it fails in CI, not on a
  button press.

## History

The parked Cloud Run backend, its Terraform and design notes are in git history:

```bash
git checkout a64e723 -- backend infra docs
```
