# Farsi Sentence Vault

**Live: <https://alirghase.github.io/farsi-sentence-vault/>** — open on a phone,
Share → Add to Home Screen.

Translation drilling for someone who knows the words but freezes when they have
to produce a sentence. Prompt → type it → check → wrong or right. Hundreds of
reps a week, offline, on a commute.

Behind the cards is a knowledge base — 600 words and phrases by topic, 105
verbs conjugated in every tense, the pronoun and ending tables, and grammar
notes — that the app drills as word and form cards and shows as a searchable
reference (**مرجع**).

The problem is retrieval under pressure, not vocabulary — so the rating is one
tap, a miss comes straight back, and the whole loop runs with no network.

## Using it

Opening the app puts you on a card. There is no home screen and no tab bar,
because there is nowhere else to be.

1. **A prompt appears**, with a box under it. Type your answer.
2. **جواب (check)** shows the answer, the transliteration and a word map — each
   Persian word over its English gloss; tap a word for its part of speech. A ✓
   appears if what you typed matches the answer or a listed alternative. What a
   phone keyboard or a speaker varies does not count against you: half-spaces,
   Arabic letter forms, a subject pronoun added or dropped (*من یه قهوه می‌خوام*),
   *این رو* / *اینو*, *را* / *رو*, *چایی* / *چای*, *یه کم* / *یکم*.
3. **غلط (wrong)** or **درست (right)**. Wrong comes back later in the same round.
   Right shows how many days until you see it again. **برگرد** undoes a mis-tap.

**Don't know a word?** Hover over any Persian word — a prompt, an answer, an
example on the reference screen — or tap it on a phone, and its English shows
in a small tip. Nothing English is on screen until you ask. The meaning comes
from the sentence's own word map, then the word maps of the whole deck, then the
knowledge base, so conjugated forms (*رفتیم* → *we went*) and phrases (*یه کم*)
are covered too.

On a keyboard: <kbd>Enter</kbd> checks, <kbd>1</kbd> wrong, <kbd>2</kbd> right,
<kbd>U</kbd> undo.

### The six kinds of card

| Kind | What you do |
|---|---|
| **Translation** (40% of a round) | English → Persian, or Persian → English. Each direction is scheduled separately |
| **Transformation** | Change a sentence you know by a rule: *منفی‌ش کن* (negate), *بذارش گذشته* (past), *به شما بگو*, *جمعش کن* (plural) |
| **Swap** | Keep the frame, change one piece: *با «ما» بگو* turns *یه قهوه می‌خوام* into *یه قهوه می‌خوایم*. The piece is a pronoun (subject, possessive or object), a verb or modal, or a phrase (question word, time word, how a request opens) |
| **Reply** | Something is said to you in Persian and you answer in Persian. Nothing on the front is English. Many replies are right, so a model answer and a few others are shown and the verdict is yours |
| **Word** | One word or phrase from the knowledge base, English → Persian |
| **Form** | One tense of one verb, or one pronoun table: *من · رفتن* under **گذشته** wants *رفتم*. A different person is dealt each time, but the card is scheduled as the tense, so the ending is what you learn |

Transformations and swaps together are 15% of a round, replies 10%, words 20%
and forms 15%. **What to practise** in Settings narrows a round to sentences,
words, or verbs and pronouns only; the other cards keep their schedule until
you come back. A
transformation is only dealt once you have met its sentence: it changes something
you know, so on day one the drills are swaps.

**Immersion** (Settings, on by default): the English meaning of a drill and the
transliteration under each answer stay behind a small tap — **معنی**, **تلفظ** —
instead of next to the Persian.

### The round, and what it never does

**The round does not end.** Due reviews come first, then new sentences from your
level, then cards you already know, the ones you find hardest first.

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

**مرجع** (in the header) is the knowledge base to read: words by topic, every
verb's table in every tense with transliteration and English, the pronoun
tables, and the grammar notes. Search takes Persian, English or
transliteration, and any conjugated form finds its verb (*رفتم* → *رفتن*).
Each page shows sentences from the deck that use it, and **تمرینش کن** starts a
round of just that page's cards. Tapping a word in a card's word map links to
its page.

**+** on the card writes a sentence of your own, drillable at once. **تنظیمات**
(next to **+**) holds immersion, what to practise, your level, and **Save a backup** —
do that now and then: iOS can clear a web app's storage and nothing else holds a
copy. Restoring maps through the Persian text, so it works on a new device.

## Repository

```
web/    the app: static PWA, ES modules, no build step, no node_modules
        data/  seed_sentences.json (the deck), transforms.json (transformation
               and swap drills), replies.json, kb.json (generated from kb/)
kb/     the knowledge base: words.json, verbs.json (two stems per verb),
        pronouns.json, notes/*.md
core/   the checks a sentence must pass, the conjugation engine (kb.py), and
        where the deck lives
tools/  adding content and checking it
        handwritten/          batches of sentences, each with a word map
        handwritten/drills/   the sources of the swaps and the replies
```

Run it locally: `python3 -m http.server 8000 --directory web`.

### Adding content

Sentences — write a batch into `tools/handwritten/` (see any existing file for
the shape; every sentence carries its word map), then:

Add `"first": true` to a batch to put its sentences at the front of the queue of
new cards, whatever their level — for the things you most want to be able to
say now.

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

The knowledge base — add rows to `kb/words.json`, a verb's two stems to
`kb/verbs.json` (irregular forms as overrides), a table to `kb/pronouns.json`
or a note to `kb/notes/`, then:

```bash
python3 tools/build_kb.py --show رفتن   # read a verb's generated tables
python3 tools/test_kb.py                # pinned forms still hold
python3 tools/build_kb.py --write       # validate and regenerate web/data/kb.json
```

Every tense is generated from two stems, so one rule change moves ninety verbs;
`tools/test_kb.py` pins hand-checked forms so that shows up as a failure.

`python3 tools/coverage.py` is the worklist for growing the deck: it lists
knowledge-base verbs with no example sentence and words met in fewer than three
cards. The `expand` skill (`.claude/skills/expand/`) is the procedure for one
reviewed batch, ending in a PR.

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
python3 tools/test_kb.py             # pinned conjugations
python3 tools/build_kb.py --check    # kb.json matches kb/
python3 tools/coverage.py            # core and knowledge-base words and verbs in fewer than 3 cards
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
