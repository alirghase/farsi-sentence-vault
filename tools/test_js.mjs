// Unit tests for the pure parts of the web client: the scheduler, session
// selection, and answer matching. These are the places where a bug stays
// invisible for weeks — a card scheduled a month late looks exactly like a
// card you know.
//
//   node --test tools/test_js.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as SM2 from '../web/js/sm2.js';
import { select, introducedSince, eligibleAsNew } from '../web/js/session.js';

const pass = (s) => SM2.next(s, SM2.RATING_QUALITY.pass);
const fail = (s) => SM2.next(s, SM2.RATING_QUALITY.fail);

test('passes follow 1, 6, then interval x ease', () => {
  let s = SM2.newState();
  s = pass(s); assert.equal(s.intervalDays, 1);
  s = pass(s); assert.equal(s.intervalDays, 6);
  s = pass(s);
  assert.ok(s.intervalDays >= 14 && s.intervalDays <= 16, `got ${s.intervalDays}`);
});

test('a fail resets repetitions, counts a lapse, and lowers ease', () => {
  let s = pass(pass(pass(SM2.newState())));
  const ease = s.easeFactor;
  s = fail(s);
  assert.equal(s.repetitions, 0);
  assert.equal(s.intervalDays, 1);
  assert.equal(s.lapses, 1);
  assert.ok(s.easeFactor < ease);
});

// The in-session re-queue bug: rating the second showing of a failed card from
// its pre-fail state pushed a 15-day card out to ~38 days.
test('fail then pass in one session lands at 1 day, not further out', () => {
  const mature = pass(pass(pass(SM2.newState())));
  const afterFail = fail(mature);
  const afterPass = pass(afterFail);
  assert.equal(afterPass.intervalDays, 1);
  assert.equal(afterPass.lapses, 1);
});

test('ease never drops below the floor', () => {
  let s = SM2.newState();
  for (let i = 0; i < 30; i++) s = fail(s);
  assert.equal(s.easeFactor, SM2.MINIMUM_EASE);
});

test('intervals are capped', () => {
  let s = SM2.newState();
  for (let i = 0; i < 40; i++) s = pass(s);
  assert.equal(s.intervalDays, SM2.MAX_INTERVAL_DAYS);
});

// --- session selection ---

let seq = 0;
const card = (sentenceId, direction, isNew) => ({
  sentence: { id: sentenceId },
  direction,
  isNew,
  review: { key: `${sentenceId}::${direction}`, ...SM2.newState(), n: seq++ },
});
const weights = { enToFa: 0.7, faToEn: 0.3 };

test('never more new cards than the allowance, even when backfilling', () => {
  const due = [card('a', 'enToFa', false)];
  const fresh = Array.from({ length: 30 }, (_, i) => card(`n${i}`, i % 2 ? 'faToEn' : 'enToFa', true));
  const chosen = select(due, fresh, 20, weights, undefined, 5);
  assert.equal(chosen.filter((c) => c.isNew).length, 5);
  assert.equal(chosen.length, 6);
});

// counts() and build() each decided what may be introduced, and the copies had
// already drifted — build() honoured `kinds`, counts() did not, so Today would
// promise new cards a session then refuse to serve them. One rule now, pinned
// here so the copies cannot come back.
test('eligibility is the same rule for the counter and the builder', () => {
  const atLevel = new Set(['a']);
  const sentence = { id: 'a', kind: 'sentence' };
  const other = { id: 'b', kind: 'sentence' };
  const word = { id: 'a', kind: 'word' };

  assert.equal(eligibleAsNew(sentence, atLevel), true);
  assert.equal(eligibleAsNew(other, atLevel), false, 'outside the level');
  assert.equal(eligibleAsNew(other, null), true, 'no level gate means no filter');
  assert.equal(eligibleAsNew(word, atLevel, ['sentence']), false, 'wrong kind');
  assert.equal(eligibleAsNew(sentence, atLevel, ['sentence']), true);
  assert.equal(eligibleAsNew({ id: 'a' }, atLevel, ['sentence']), true,
    'a row with no kind counts as a sentence');
});

test('both directions of one sentence never share a session', () => {
  const fresh = [];
  for (let i = 0; i < 10; i++) {
    fresh.push(card(`s${i}`, 'enToFa', true), card(`s${i}`, 'faToEn', true));
  }
  const chosen = select([], fresh, 20, weights);
  const ids = chosen.map((c) => c.sentence.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(chosen.length, 10);
});

test('due cards come before new ones', () => {
  const due = Array.from({ length: 5 }, (_, i) => card(`d${i}`, 'enToFa', false));
  const fresh = Array.from({ length: 5 }, (_, i) => card(`n${i}`, 'enToFa', true));
  const chosen = select(due, fresh, 5, { enToFa: 1, faToEn: 0 });
  assert.ok(chosen.every((c) => !c.isNew));
});

test('a direction that runs dry is backfilled from the other', () => {
  const fresh = Array.from({ length: 10 }, (_, i) => card(`n${i}`, 'enToFa', true));
  const chosen = select([], fresh, 10, weights);
  assert.equal(chosen.length, 10);
});

test('introducedSince prefers introducedAt and falls back for old rows', () => {
  const day = 1_000_000;
  const reviews = [
    { introducedAt: day + 5, repetitions: 0 },            // new today, failed
    { introducedAt: day - 5, repetitions: 1, lastReviewed: day + 5 },  // relearned
    { repetitions: 1, lastReviewed: day + 5 },            // old row, counted
    { repetitions: 3, lastReviewed: day + 5 },            // old row, not new
  ];
  assert.equal(introducedSince(reviews, day), 2);
});

