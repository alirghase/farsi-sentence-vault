// CEFR progression.
//
// New cards are drawn only from your current level; due reviews come from every
// level you have touched, so passing A1 does not mean quietly forgetting it.
//
// A level is passed on three counts, not one. Accuracy alone can be cleared by
// cramming — high scores on cards seen an hour ago measure short-term memory,
// not learning. Retention is the count that makes a pass mean something.

import * as db from './db.js';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

export const LEVEL_META = {
  A1: { difficulty: 1, summary: 'One clause, present tense, everyday words.' },
  A2: { difficulty: 2, summary: 'Past and future, simple compound verbs.' },
  B1: { difficulty: 3, summary: 'Subordinate clauses and the subjunctive.' },
  B2: { difficulty: 4, summary: 'Conditionals, reported speech, register.' },
  C1: { difficulty: 5, summary: 'Idiom, abstraction, taarof.' },
};

/** The gate. Every threshold is visible in the UI so nothing is a mystery. */
export const GATE = {
  distinctCards: 60,        // breadth: you have met enough of the level
  accuracyWindow: 40,       // how many recent reviews accuracy is measured over
  accuracyTarget: 0.85,     // and the bar it must clear
  retainedCards: 30,        // depth: cards that actually stuck
  retentionDays: 7,         // the interval that counts as "stuck"
};

export function levelForDifficulty(difficulty) {
  return LEVELS[Math.min(Math.max(difficulty, 1), LEVELS.length) - 1];
}

export function nextLevel(level) {
  const i = LEVELS.indexOf(level);
  return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}

/**
 * Progress toward passing `level`.
 *
 * Returns the three counts with their targets so the UI can render bars rather
 * than a single opaque verdict.
 */
export async function progress(level) {
  const [sentences, reviews, attempts] = await Promise.all([
    db.getAll(db.STORE.sentences),
    db.getAll(db.STORE.reviews),
    db.getAll(db.STORE.attempts),
  ]);

  const atLevel = new Set(
    sentences
      .filter((s) => levelForDifficulty(s.difficulty) === level)
      .map((s) => s.id),
  );
  const totalCards = atLevel.size * 2;

  // Breadth: distinct (sentence, direction) pairs actually practised.
  const practised = reviews.filter(
    (r) => atLevel.has(r.sentenceId) && r.repetitions > 0,
  );
  const seen = practised.length;

  // Depth: cards whose interval says they stuck.
  const retained = practised.filter((r) => r.intervalDays >= GATE.retentionDays).length;

  // Accuracy over the most recent reviews at this level. An AI grade, when
  // there is one, outranks the self-rating that preceded it.
  const recent = attempts
    .filter((a) => atLevel.has(a.sentenceId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, GATE.accuracyWindow);

  const correct = recent.filter((a) => {
    if (a.aiVerdict) return ['correct', 'minor'].includes(a.aiVerdict);
    return a.selfRating === 'pass';
  }).length;
  const rate = recent.length ? correct / recent.length : 0;

  // Breadth cannot exceed what exists: a level with 40 cards can never reach a
  // 60-card target, which would lock you in permanently.
  const coverageNeed = Math.min(GATE.distinctCards, totalCards);
  const retentionNeed = Math.min(GATE.retainedCards, totalCards);

  const coverage = { value: seen, need: coverageNeed };
  const accuracy = { value: recent.length >= GATE.accuracyWindow ? rate : 0,
                     need: GATE.accuracyTarget, samples: recent.length };
  const retention = { value: retained, need: retentionNeed };

  return {
    level,
    totalCards,
    coverage,
    accuracy,
    retention,
    passed:
      coverage.value >= coverage.need &&
      recent.length >= GATE.accuracyWindow &&
      rate >= GATE.accuracyTarget &&
      retention.value >= retention.need,
  };
}


/** Sentence ids belonging to a level, for the session builder. */
export function idsForLevel(sentences, level) {
  return new Set(
    sentences
      .filter((s) => levelForDifficulty(s.difficulty) === level)
      .map((s) => s.id),
  );
}
