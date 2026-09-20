// Assembles a practice session from due reviews plus unseen sentences.

import * as db from './db.js';
import * as SM2 from './sm2.js';
import { idsForLevel } from './levels.js';

// enToFa is production (what freezes), faToEn is reading, listenToEn is hearing.
// Listening is a separate direction rather than a mode because a listening card
// and a reading card of the same sentence are different skills and must
// schedule independently — which ReviewState's sentenceId::direction key
// already supports.
export const DIRECTIONS = ['enToFa', 'faToEn', 'listenToEn'];

/**
 * Share of new cards per direction. Weighted to production because producing
 * Farsi is the skill that freezes; reading and hearing are easier.
 */
export const DEFAULT_WEIGHTS = { enToFa: 0.6, faToEn: 0.2, listenToEn: 0.2 };

/** Directions usable right now. Listening needs a Persian voice on the device. */
export function availableDirections(speechAvailable) {
  return speechAvailable ? DIRECTIONS : DIRECTIONS.filter((d) => d !== 'listenToEn');
}

export function directionLabel(direction) {
  return { enToFa: 'EN → FA', faToEn: 'FA → EN', listenToEn: 'LISTEN → EN' }[direction]
    ?? direction;
}

/** True when the prompt is audio rather than text. */
export function isListening(direction) {
  return direction === 'listenToEn';
}

export function reviewKey(sentenceId, direction) {
  return `${sentenceId}::${direction}`;
}

export function promptFor(sentence, direction) {
  // Listening shows no text at all — revealing the Persian would turn it back
  // into a reading exercise.
  if (direction === 'listenToEn') return '';
  return direction === 'enToFa' ? sentence.englishText : sentence.farsiText;
}

export function answerFor(sentence, direction) {
  return direction === 'enToFa' ? sentence.farsiText : sentence.englishText;
}

/** The text spoken aloud for a listening prompt. */
export function audioFor(sentence) {
  return sentence.farsiText;
}

/**
 * The day's ledger figures.
 *
 * `fresh` is the NEW ALLOWANCE REMAINING today, not the raw count of unseen
 * cards. With 400 sentences there are 800 unseen cards, so a raw count sits
 * pinned at the batch size and never moves as you work — a number that cannot
 * change is useless on a screen whose job is accounting.
 */
export async function counts(now = Date.now(), dailyBatchSize = 100, level = null) {
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
  let unseen = 0;
  for (const s of sentences) {
    if (levelIds && !levelIds.has(s.id)) continue;
    for (const d of DIRECTIONS) {
      if (!scheduled.has(reviewKey(s.id, d))) unseen += 1;
    }
  }

  // A card that reached its first repetition today started today.
  const newToday = reviews.filter(
    (r) => r.repetitions === 1 && (r.lastReviewed ?? 0) >= dayStart,
  ).length;
  const reviewedToday = attempts.filter((a) => a.createdAt >= dayStart).length;

  const allowance = Math.max(0, dailyBatchSize - newToday);
  return {
    due,
    new: Math.min(unseen, allowance),
    unseen,
    reviewedToday,
    sentenceCount,
    total: due + Math.min(unseen, allowance),
  };
}

/**
 * A dated register of practice, newest first.
 *
 * The point of a ledger is that entries accumulate: current-state counters tell
 * you nothing about whether the habit is holding. One row per day, with the
 * accuracy you actually achieved.
 */
export async function history(days = 14) {
  const attempts = await db.getAll(db.STORE.attempts);
  const byDay = new Map();

  for (const attempt of attempts) {
    const day = new Date(attempt.createdAt);
    day.setHours(0, 0, 0, 0);
    const key = day.getTime();
    const row = byDay.get(key) ?? { date: key, reviewed: 0, again: 0 };
    row.reviewed += 1;
    if (attempt.selfRating === 'again') row.again += 1;
    byDay.set(key, row);
  }

  return [...byDay.values()]
    .sort((a, b) => b.date - a.date)
    .slice(0, days)
    .map((row) => ({
      ...row,
      accuracy: row.reviewed ? 1 - row.again / row.reviewed : 0,
    }));
}

/**
 * Consecutive days of practice, counting back from today.
 *
 * Yesterday still counts as alive: a streak that dies at midnight punishes you
 * for the session you are about to do, which is exactly backwards for the habit
 * this is meant to support.
 */
export async function streak(now = Date.now()) {
  const rows = await history(400);
  if (!rows.length) return { days: 0, practisedToday: false };

  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = startOfDay(now);
  const days = new Set(rows.map((r) => startOfDay(r.date)));

  const practisedToday = days.has(today);
  let cursor = practisedToday ? today : today - 86400000;
  if (!days.has(cursor)) return { days: 0, practisedToday };

  let count = 0;
  while (days.has(cursor)) {
    count += 1;
    cursor -= 86400000;
  }
  return { days: count, practisedToday };
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
  weights = DEFAULT_WEIGHTS,
  level = null,
  speechAvailable = false,
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
  const directions = availableDirections(speechAvailable);

  const due = [];
  const fresh = [];

  for (const sentence of sentences) {
    // A word card and a sentence card are both rows here; `kinds` lets a
    // session be restricted to one without a second store.
    if (kinds && !kinds.includes(sentence.kind ?? 'sentence')) continue;
    for (const direction of directions) {
      const key = reviewKey(sentence.id, direction);
      const existing = byKey.get(key);
      if (existing) {
        if (existing.dueDate <= now) {
          due.push({ sentence, direction, review: existing, isNew: false });
        }
      } else if (!levelIds || levelIds.has(sentence.id)) {
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

  const chosen = select(due, fresh, limit, weights, directions);
  // A session that front-loads every review and back-loads every new card feels
  // like two different activities.
  shuffle(chosen);
  return chosen;
}

/**
 * Fill the session honouring the direction weights, preferring due cards.
 *
 * Weights are normalised over the directions actually available, so removing
 * listening (no voice installed) redistributes its share rather than leaving
 * the session short.
 */
function select(due, fresh, limit, weights, directions) {
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
  const taken = new Set();

  for (const pool of [due, fresh]) {
    for (const card of pool) {
      if (chosen.length >= limit) break;
      if ((remaining[card.direction] ?? 0) <= 0) continue;
      chosen.push(card);
      taken.add(cardId(card));
      remaining[card.direction] -= 1;
    }
  }

  // If one direction ran dry, backfill rather than returning a short session.
  // Both pools are already level- and kind-filtered, so this cannot reintroduce
  // off-level material.
  if (chosen.length < limit) {
    for (const pool of [due, fresh]) {
      for (const card of pool) {
        if (chosen.length >= limit) break;
        if (taken.has(cardId(card))) continue;
        chosen.push(card);
        taken.add(cardId(card));
      }
    }
  }
  return chosen;
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

/** Record one review: persist the attempt and advance the schedule. */
export async function recordAttempt({ card, rating, typedAnswer, audioBlob }) {
  const now = Date.now();
  const quality = SM2.RATING_QUALITY[rating];
  const advanced = SM2.next(card.review, quality);

  const review = {
    ...card.review,
    ...advanced,
    lastReviewed: now,
    dueDate: SM2.dueDate(advanced, now),
  };

  const mode = audioBlob ? 'recorded' : (typedAnswer ? 'typed' : 'speakSelfRate');
  const attempt = {
    id: crypto.randomUUID(),
    sentenceId: card.sentence.id,
    direction: card.direction,
    mode,
    selfRating: rating,
    typedAnswer: typedAnswer || null,
    audioBlob: audioBlob || null,
    // Graded fields are filled in at sync time.
    transcript: null,
    aiScore: null,
    aiVerdict: null,
    aiFeedback: null,
    correctedFarsi: null,
    aiErrorTags: [],
    gradedAt: null,
    syncedAt: null,
    createdAt: now,
  };

  await Promise.all([
    db.put(db.STORE.reviews, review),
    db.put(db.STORE.attempts, attempt),
  ]);

  // Self-rated attempts carry no per-tag signal, so an "again" counts against
  // every tag the sentence exercises. Coarse, but speak-aloud is the default
  // mode and excluding it would leave the weak-spot view blind to most practice.
  await bumpTagStats(card.sentence.grammarTags ?? [], rating === 'again');

  return { attempt, review };
}

export async function bumpTagStats(tags, failed) {
  for (const tag of tags) {
    const existing = (await db.get(db.STORE.tagStats, tag)) ?? {
      tag,
      failCount: 0,
      totalCount: 0,
    };
    existing.totalCount += 1;
    if (failed) existing.failCount += 1;
    existing.lastSeen = Date.now();
    await db.put(db.STORE.tagStats, existing);
  }
}
