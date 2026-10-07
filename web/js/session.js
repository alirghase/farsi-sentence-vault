// Assembles a practice session from due reviews plus unseen sentences.

import * as db from './db.js';
import * as SM2 from './sm2.js';
import { idsForLevel } from './levels.js';

// enToFa is production — the skill that freezes. faToEn is reading.
// A sentence schedules independently per direction, which ReviewState's
// sentenceId::direction key already supports.
export const DIRECTIONS = ['enToFa', 'faToEn'];

/**
 * Share of new cards per direction. Weighted to production because producing
 * Farsi is the skill that freezes; reading is easier.
 */
export const DEFAULT_WEIGHTS = { enToFa: 0.7, faToEn: 0.3 };

/**
 * How many NEW sentences may be introduced in a day.
 *
 * Not a limit on practice — the round is endless, see extraCards. This is the
 * rate at which unseen material enters, and it is capped because every new card
 * becomes several reviews over the following fortnight. Take three hundred
 * tonight and next week is unplayable; the cap is what keeps tomorrow finite.
 *
 * A number in the source rather than a setting: there is no screen to put a
 * slider on, and one number that is the same on every device is easier to
 * reason about than a stored one that silently differs from the default.
 */
export const NEW_PER_DAY = 40;

/**
 * Whether an unseen sentence may be introduced as a new card.
 *
 * One rule, used by both counts() and build(). They each had their own copy and
 * the copies already disagreed: build() honoured `kinds` and counts() ignored
 * it, so Today would promise new cards a session then refused to serve. Nothing
 * passes `kinds` today, which is why it never showed.
 */
/**
 * A sentence you wrote yourself.
 *
 * These are exempt from the daily new-card cap. The cap exists so you cannot
 * bury yourself under unfamiliar material; a sentence you just typed in is
 * neither unfamiliar nor accidental, and telling someone who added one to come
 * back tomorrow is the opposite of why the bank exists.
 */
export const isOwn = (sentence) => sentence.source === 'custom';

export function eligibleAsNew(sentence, levelIds, kinds = null) {
  if (kinds && !kinds.includes(sentence.kind ?? 'sentence')) return false;
  return !levelIds || levelIds.has(sentence.id);
}

export function reviewKey(sentenceId, direction) {
  return `${sentenceId}::${direction}`;
}

export function promptFor(sentence, direction) {
  return direction === 'enToFa' ? sentence.englishText : sentence.farsiText;
}

export function answerFor(sentence, direction) {
  return direction === 'enToFa' ? sentence.farsiText : sentence.englishText;
}

/**
 * The day's ledger figures.
 *
 * `fresh` is the NEW ALLOWANCE REMAINING today, not the raw count of unseen
 * cards. With 400 sentences there are 800 unseen cards, so a raw count sits
 * pinned at the batch size and never moves as you work — a number that cannot
 * change is useless on a screen whose job is accounting.
 */
export async function counts(now = Date.now(), newPerDay = NEW_PER_DAY, level = null, kinds = null) {
  const [sentences, reviews, attempts] = await Promise.all([
    db.getAll(db.STORE.sentences),
    db.getAll(db.STORE.reviews),
    db.getAll(db.STORE.attempts),
  ]);
  const sentenceCount = sentences.length;
  const levelIds = level ? idsForLevel(sentences, level) : null;

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();

  const due = reviews.filter((r) => r.dueDate <= now).length;

  // Unseen counts only what is actually reachable at the current level.
  const scheduled = new Set(reviews.map((r) => r.key));
  let unseenSeed = 0;
  let unseenOwn = 0;
  for (const s of sentences) {
    if (!eligibleAsNew(s, levelIds, kinds)) continue;
    for (const d of DIRECTIONS) {
      if (scheduled.has(reviewKey(s.id, d))) continue;
      if (isOwn(s)) unseenOwn += 1; else unseenSeed += 1;
    }
  }
  const unseen = unseenSeed + unseenOwn;

  const newToday = introducedSince(reviews, dayStart);
  const reviewedToday = attempts.filter((a) => a.createdAt >= dayStart).length;

  // The cap governs bundled cards only; your own are always available.
  const allowance = Math.max(0, newPerDay - newToday);
  const introducible = unseenOwn + Math.min(unseenSeed, allowance);
  return {
    due,
    new: introducible,
    unseen,
    newToday,
    allowance,
    reviewedToday,
    sentenceCount,
    total: due + introducible,
  };
}

/**
 * Cards first seen since `since`.
 *
 * Reviews carry `introducedAt` from the first rating on. Rows written before
 * that field existed fall back to "reached its first repetition since", which
 * miscounts a relearned card as new and a failed new card as not — close
 * enough for old rows, and it stops mattering after a day.
 */
export function introducedSince(reviews, since) {
  return reviews.filter((r) => (r.introducedAt
    ?? (r.repetitions === 1 ? r.lastReviewed ?? 0 : 0)) >= since).length;
}

/**
 * Build a session.
 *
 * Review states are created lazily: materialising two rows for every sentence
 * up front would mean 800 rows for a 400-sentence bank the learner has not
 * touched yet.
 */
export async function build({
  limit,
  maxNew = limit,
  weights = DEFAULT_WEIGHTS,
  level = null,
  kinds = null,
  now = Date.now(),
}) {
  const [sentences, reviews] = await Promise.all([
    db.getAll(db.STORE.sentences),
    db.getAll(db.STORE.reviews),
  ]);
  if (!sentences.length) return [];

  const byKey = new Map(reviews.map((r) => [r.key, r]));
  // New cards are restricted to the current level; due reviews are not, so
  // earlier levels keep resurfacing on their own schedule.
  const levelIds = level ? idsForLevel(sentences, level) : null;
  const directions = DIRECTIONS;

  const due = [];
  const fresh = [];

  for (const sentence of sentences) {
    // A word card and a sentence card are both rows here; `kinds` lets a
    // session be restricted to one without a second store.
    // `kinds` restricts the whole session, due cards included — eligibleAsNew
    // below only governs what may be introduced.
    if (kinds && !kinds.includes(sentence.kind ?? 'sentence')) continue;
    for (const direction of directions) {
      const key = reviewKey(sentence.id, direction);
      const existing = byKey.get(key);
      if (existing) {
        if (existing.dueDate <= now) {
          due.push({ sentence, direction, review: existing, isNew: false });
        }
      } else if (eligibleAsNew(sentence, levelIds, kinds)) {
        // New cards are gated to the current level. Due reviews above are not,
        // so levels already passed keep resurfacing on their own schedule.
        fresh.push({
          sentence,
          direction,
          review: { key, sentenceId: sentence.id, direction, ...SM2.newState(), dueDate: now },
          isNew: true,
        });
      }
    }
  }

  due.sort((a, b) => a.review.dueDate - b.review.dueDate);
  shuffle(fresh);
  // A sentence you added yourself goes to the front of the new pile. You wrote
  // it down because you wanted it; waiting for it to surface by chance among
  // several hundred bundled cards is the same as it never arriving. Once it has
  // been seen it is an ordinary review and gets no further favour.
  fresh.sort((a, b) => (b.sentence.source === 'custom') - (a.sentence.source === 'custom'));

  const chosen = select(due, fresh, limit, weights, directions, maxNew);
  // A session that front-loads every review and back-loads every new card feels
  // like two different activities.
  shuffle(chosen);
  return chosen;
}

/**
 * Fill the session honouring the direction weights, preferring due cards.
 *
 * Weights are normalised over the directions given, so a zeroed direction
 * redistributes its share rather than leaving the session short.
 *
 * Two hard limits hold through the backfill as well as the main pass:
 * - at most `maxNew` unseen cards, so the day's new-card allowance is real
 *   rather than something a lopsided due pile can leak past;
 * - one card per sentence. The two directions of a sentence are each other's
 *   answer, so meeting both in one sitting turns the second into reading back
 *   what you saw a minute ago.
 */
export function select(due, fresh, limit, weights, directions = DIRECTIONS, maxNew = limit) {
  const total = directions.reduce((sum, d) => sum + (weights[d] ?? 0), 0) || 1;

  const remaining = {};
  let allocated = 0;
  directions.forEach((d, i) => {
    const share = i === directions.length - 1
      ? limit - allocated                       // last one absorbs the rounding
      : Math.round((limit * (weights[d] ?? 0)) / total);
    remaining[d] = Math.max(0, share);
    allocated += remaining[d];
  });

  const chosen = [];
  const sentences = new Set();
  let newTaken = 0;

  const take = (card) => {
    if (sentences.has(card.sentence.id)) return false;
    // maxNew is the day's budget for bundled cards. Your own sentences are
    // spent from nobody's budget — see isOwn.
    const budgeted = card.isNew && !isOwn(card.sentence);
    if (budgeted && newTaken >= maxNew) return false;
    chosen.push(card);
    sentences.add(card.sentence.id);
    if (budgeted) newTaken += 1;
    return true;
  };

  for (const pool of [due, fresh]) {
    for (const card of pool) {
      if (chosen.length >= limit) break;
      if ((remaining[card.direction] ?? 0) <= 0) continue;
      if (take(card)) remaining[card.direction] -= 1;
    }
  }

  // If one direction ran dry, backfill rather than returning a short session.
  // Both pools are already level- and kind-filtered, so this cannot reintroduce
  // off-level material.
  for (const pool of [due, fresh]) {
    for (const card of pool) {
      if (chosen.length >= limit) break;
      take(card);
    }
  }
  return chosen;
}

/**
 * Cards for drilling past the day's plan.
 *
 * The scheduled queue is finite on purpose: due reviews plus a capped number of
 * new sentences. Practice is not. Once the plan runs out the round keeps going
 * with cards you have already met, least-recently-practised first.
 *
 * These deliberately do NOT touch the schedule — see `extra` in recordAttempt.
 * `exclude` is the set of cardIds already dealt this round, so a top-up works
 * through everything you know before coming round again.
 */
export async function extraCards(limit, { exclude = new Set(), now = Date.now() } = {}) {
  const [sentences, reviews] = await Promise.all([
    db.getAll(db.STORE.sentences),
    db.getAll(db.STORE.reviews),
  ]);
  const byId = new Map(sentences.map((s) => [s.id, s]));

  const pool = reviews
    .filter((r) => byId.has(r.sentenceId))
    .filter((r) => !exclude.has(`${r.sentenceId}::${r.direction}`))
    .sort((a, b) => (a.lastReviewed ?? 0) - (b.lastReviewed ?? 0));

  return pool.slice(0, limit).map((review) => ({
    sentence: byId.get(review.sentenceId),
    direction: review.direction,
    review,
    isNew: false,
    // The flag the rest of the app reads to leave the schedule alone.
    extra: true,
  }));
}

export function cardId(card) {
  return reviewKey(card.sentence.id, card.direction);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * How long an answer should take, in ms.
 *
 * Scales with length and level: "fast" for a nine-word B1 sentence is not fast
 * for a three-word A1 one, and a fixed target would punish the harder material
 * for being harder.
 */
export function targetMs(sentence, direction) {
  const words = (sentence.farsiText ?? '').trim().split(/\s+/).length;
  const base = 4000 + words * 500;
  // Producing Farsi is slower than reading it; hearing needs the audio to play.
  const multiplier = direction === 'enToFa' ? 1.15 : 1;
  return Math.round(base * multiplier);
}

/**
 * Record one review: persist the attempt and advance the schedule.
 *
 * Returns what `undoAttempt` needs to put everything back: the review as it was
 * before (null for a card never rated until now) and the attempt written.
 */
export async function recordAttempt({ card, rating, typedAnswer = null, msToReveal = null }) {
  const now = Date.now();
  const quality = SM2.RATING_QUALITY[rating];
  const advanced = SM2.next(card.review, quality);
  const previous = await db.get(db.STORE.reviews, card.review.key);

  const review = {
    ...card.review,
    ...advanced,
    introducedAt: card.review.introducedAt ?? previous?.introducedAt ?? now,
    lastReviewed: now,
    dueDate: SM2.dueDate(advanced, now),
  };

  const attempt = {
    id: crypto.randomUUID(),
    sentenceId: card.sentence.id,
    direction: card.direction,
    mode: typedAnswer ? 'typed' : 'speakSelfRate',
    selfRating: rating,
    typedAnswer: typedAnswer || null,
    // Speed is the gap the app previously could not see at all.
    msToReveal,
    targetMs: targetMs(card.sentence, card.direction),
    createdAt: now,
  };

  // Extra practice records that it happened and nothing else.
  //
  // Massed repetition carries no information about how long you will remember
  // something — you saw it a minute ago — so letting it move a due date would
  // feed the scheduler the one input it must not have. The card you drilled
  // five times tonight is still due when it was due.
  const writes = [db.put(db.STORE.attempts, attempt)];
  if (!card.extra) writes.push(db.put(db.STORE.reviews, review));
  await Promise.all(writes);

  return { attempt, review: card.extra ? card.review : review, previous: previous ?? null };
}

/**
 * Reverse a `recordAttempt`: restore the schedule and drop the attempt. A
 * mis-tap on a one-tap binary rating is common on a phone, and without this
 * it silently resets a card that was fine.
 */
export async function undoAttempt({ card, attempt, previous }) {
  const writes = [db.remove(db.STORE.attempts, attempt.id)];
  // An extra-practice attempt never wrote a review, so there is none to put
  // back — and removing one here would delete a real schedule.
  if (!card.extra) {
    writes.push(previous
      ? db.put(db.STORE.reviews, previous)
      : db.remove(db.STORE.reviews, card.review.key));
  }
  await Promise.all(writes);
}


/**
 * Does a typed answer match the reference, or one of the listed alternatives?
 *
 * Deliberately forgiving about what a phone keyboard varies and strict about
 * everything else. Arabic ي/ك for Persian ی/ک, short-vowel marks, punctuation,
 * and whether می‌ was joined with a half-space, a space or nothing are all
 * noise. A different word is not. The verdict is still yours to give: this
 * only says whether what you wrote is one of the answers on the card.
 */
export function matchesAnswer(typed, sentence, direction) {
  const candidates = direction === 'enToFa'
    ? [sentence.farsiText, ...(sentence.alternatives ?? [])]
    : [sentence.englishText];
  const mine = normaliseAnswer(typed, direction);
  if (!mine) return false;
  return candidates.some((c) => normaliseAnswer(c, direction) === mine);
}

export function normaliseAnswer(value, direction) {
  let s = String(value ?? '').toLowerCase();
  if (direction === 'enToFa') {
    s = s
      .replace(/ي/g, 'ی').replace(/ى/g, 'ی').replace(/ك/g, 'ک')
      .replace(/[\u064B-\u0652\u0670]/g, '')       // harakat
      .replace(/[\u200C\u200D\s]+/g, '');           // ZWNJ, ZWJ, spaces
  } else {
    // Apostrophes go entirely: "dont" and "don't" are the same answer typed
    // on a phone.
    s = s.replace(/['’‘]/g, '').replace(/\s+/g, ' ');
  }
  return s.replace(/[.,!?؟،؛:;«»"“”()\-–—]/g, '').trim();
}
