// Unit tests for the pure parts of the web client: the scheduler, session
// selection, and answer matching. These are the places where a bug stays
// invisible for weeks — a card scheduled a month late looks exactly like a
// card you know.
//
//   node --test tools/test_js.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import * as SM2 from '../web/js/sm2.js';
import { instruction, stemHint } from '../web/js/taxonomy.js';
import { select, matchesAnswer, introducedSince, eligibleAsNew, unseenSentences, isOwn, NEW_PER_DAY,
         directionsFor, promptFor, answerFor, expectsFarsi, isDrill, targetMs,
         newCardOrder } from '../web/js/session.js';

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
// already drifted. One rule now, pinned here so the copies cannot come back.
test('eligibility is the same rule for the counter and the builder', () => {
  const atLevel = new Set(['a']);
  const sentence = { id: 'a' };
  const other = { id: 'b' };

  assert.equal(eligibleAsNew(sentence, atLevel), true);
  assert.equal(eligibleAsNew(other, atLevel), false, 'outside the level');
  assert.equal(eligibleAsNew(other, null), true, 'no level gate means no filter');
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

// --- answer matching ---

test('Persian matching ignores half-spaces, Arabic letter forms and punctuation', () => {
  const sentence = { farsiText: 'یه قهوه سرد می‌خوام.', alternatives: ['یه قهوه‌ی سرد می‌خوام.'] };
  assert.ok(matchesAnswer('یه قهوه سرد میخوام', sentence, 'enToFa'));
  assert.ok(matchesAnswer('يه قهوه سرد مي خوام', sentence, 'enToFa'));
  assert.ok(matchesAnswer('یه قهوه‌ی سرد می‌خوام', sentence, 'enToFa'));
  assert.ok(!matchesAnswer('یه چای سرد می‌خوام', sentence, 'enToFa'));
  assert.ok(!matchesAnswer('', sentence, 'enToFa'));
});

test('English matching ignores case and punctuation but not words', () => {
  const sentence = { englishText: "I don't know." };
  assert.ok(matchesAnswer('i dont know', sentence, 'faToEn'));
  assert.ok(matchesAnswer("I don’t know", sentence, 'faToEn'));
  assert.ok(!matchesAnswer('I know', sentence, 'faToEn'));
});

// --- your own sentences are not rationed ---

test('the daily new-card cap spends only on bundled sentences', () => {
  const card = (id, source) => ({
    sentence: { id, source }, direction: 'enToFa', isNew: true, review: {},
  });
  const fresh = [
    card('own-1', 'custom'), card('own-2', 'custom'),
    card('seed-1', 'seed'), card('seed-2', 'seed'), card('seed-3', 'seed'),
  ];
  // Budget of one bundled card, in a round with room for everything.
  const chosen = select([], fresh, 10, { enToFa: 1, faToEn: 0 }, ['enToFa'], 1);
  const ids = chosen.map((c) => c.sentence.id);

  assert.ok(ids.includes('own-1') && ids.includes('own-2'),
    'a sentence you wrote is never held back for tomorrow');
  assert.equal(ids.filter((id) => id.startsWith('seed')).length, 1,
    'bundled cards still stop at the cap');
});

test('isOwn is the one place "mine" is decided', () => {
  assert.ok(isOwn({ source: 'custom' }));
  assert.ok(!isOwn({ source: 'seed' }));
  assert.ok(!isOwn({}));
});

// --- practice past the day's plan ---

test('the new-card rate is a cap on introduction, not on practice', () => {
  // The round is endless; this number only governs how fast unseen material
  // enters, because each new card becomes several reviews later.
  assert.ok(Number.isInteger(NEW_PER_DAY) && NEW_PER_DAY > 0);
  const fresh = Array.from({ length: NEW_PER_DAY + 25 }, (_, i) => ({
    sentence: { id: `seed-${i}`, source: 'seed' }, direction: 'enToFa', isNew: true, review: {},
  }));
  const chosen = select([], fresh, 500, { enToFa: 1, faToEn: 0 }, ['enToFa'], NEW_PER_DAY);
  assert.equal(chosen.length, NEW_PER_DAY,
    'a round cannot introduce more than the day allows, however long it runs');
});

// --- transformation drills ---

const drill = {
  kind: 'transform', transform: 'negate',
  stem: 'فردا می‌رم خونه.', stemEn: "I'm going home tomorrow.",
  farsiText: 'فردا نمی‌رم خونه.', englishText: "I'm not going home tomorrow.",
  alternatives: [],
};

test('a transformation card is one direction, a translation card is two', () => {
  assert.deepEqual(directionsFor(drill), ['transform']);
  assert.deepEqual(directionsFor({ farsiText: 'x' }), ['enToFa', 'faToEn']);
});

test('a transformation asks for the stem and wants the changed sentence', () => {
  // The prompt is the sentence you know; the instruction is on the badge.
  assert.equal(promptFor(drill, 'transform'), drill.stem);
  assert.equal(answerFor(drill, 'transform'), drill.farsiText);
  // Answering the stem back is the commonest way to get it wrong, and must not
  // be accepted.
  assert.ok(matchesAnswer('فردا نمیرم خونه', drill, 'transform'));
  assert.ok(!matchesAnswer(drill.stem, drill, 'transform'));
});

test('two of the three directions are answered in Persian', () => {
  assert.ok(expectsFarsi('enToFa'));
  assert.ok(expectsFarsi('transform'));
  assert.ok(!expectsFarsi('faToEn'));
});

// --- swap drills ---

const swap = {
  kind: 'transform', transform: 'pronoun', cue: 'ما', cueEn: 'we',
  stem: 'یه قهوه می‌خوام.', stemEn: 'I want a coffee.',
  farsiText: 'یه قهوه می‌خوایم.', englishText: 'We want a coffee.',
  alternatives: ['ما یه قهوه می‌خوایم.'],
};

test('a swap names its cue on the badge and glosses it under the stem', () => {
  assert.equal(instruction(swap), 'با «ما» بگو');
  assert.equal(stemHint(swap), 'I want a coffee.  →  we');
  // A transformation has no cue: a fixed instruction, and just the stem meaning.
  assert.equal(instruction(drill), 'منفی‌ش کن');
  assert.equal(stemHint(drill), "I'm going home tomorrow.");
});

test('a swap accepts the answer with or without the pronoun, but not the stem', () => {
  assert.ok(matchesAnswer('یه قهوه می‌خوایم', swap, 'transform'));
  assert.ok(matchesAnswer('ما یه قهوه میخوایم.', swap, 'transform'));
  assert.ok(!matchesAnswer(swap.stem, swap, 'transform'));
});

test('every shipped drill can be asked and answered', () => {
  const { transforms } = JSON.parse(readFileSync(
    new URL('../web/data/transforms.json', import.meta.url), 'utf8'));
  assert.ok(transforms.length > 400);
  for (const row of transforms) {
    assert.ok(row.stem && row.stemEn && row.farsiText && row.englishText, row.id);
    assert.ok(instruction(row), row.id);
    assert.ok(matchesAnswer(row.farsiText, row, 'transform'), row.id);
    assert.ok(!matchesAnswer(row.stem, row, 'transform'), `${row.id}: the stem is the answer`);
  }
});

// --- replies ---

const reply = {
  kind: 'reply', stem: 'چای میل دارین؟', stemEn: 'Would you like some tea?',
  farsiText: 'بله، ممنون.', englishText: 'Yes, thank you.',
  alternatives: ['نه، زحمت نکشین.'],
};

test('a reply is one direction, prompted by what was said to you', () => {
  assert.deepEqual(directionsFor(reply), ['reply']);
  assert.ok(isDrill('reply') && isDrill('transform') && !isDrill('enToFa'));
  assert.equal(promptFor(reply, 'reply'), reply.stem);
  assert.equal(answerFor(reply, 'reply'), reply.farsiText);
  assert.ok(expectsFarsi('reply'));
});

test('a reply accepts the model answer or a listed alternative, and not an echo', () => {
  assert.ok(matchesAnswer('بله ممنون', reply, 'reply'));
  assert.ok(matchesAnswer('نه زحمت نکشین', reply, 'reply'));
  assert.ok(!matchesAnswer(reply.stem, reply, 'reply'));
});

test('finding a sentence of your own is given longer than changing one', () => {
  assert.ok(targetMs(reply, 'reply') > targetMs(reply, 'transform'));
});

test('every shipped reply can be asked and answered', () => {
  const { replies } = JSON.parse(readFileSync(
    new URL('../web/data/replies.json', import.meta.url), 'utf8'));
  assert.ok(replies.length > 50);
  for (const row of replies) {
    assert.equal(row.kind, 'reply');
    assert.ok(matchesAnswer(row.farsiText, row, 'reply'), row.id);
    assert.equal(instruction(row), 'جواب بده');
  }
});

// --- order of new cards ---

test('new cards: your own first, then the most common words, ties left shuffled', () => {
  const card = (id, extra) => ({ sentence: { id, source: 'seed', ...extra } });
  const cards = [
    card('rare', { core: 0.25 }), card('common-a', { core: 1 }), card('drill'),
    card('mine', { source: 'custom' }), card('common-b', { core: 1 }),
  ];
  assert.deepEqual(cards.sort(newCardOrder).map((c) => c.sentence.id),
    ['mine', 'common-a', 'common-b', 'rare', 'drill']);
});

test('a transformation waits until its stem sentence has been seen', () => {
  const stem = { id: 's1' };
  const other = { id: 's2' };
  const drill = { id: 't1', kind: 'transform', stemId: 's1' };
  const swap = { id: 't2', kind: 'transform', stemId: 'a-frame' };
  let unseen = unseenSentences([stem, other], []);
  assert.equal(eligibleAsNew(drill, null, unseen), false, 'stem never met');
  assert.equal(eligibleAsNew(swap, null, unseen), true, 'a swap has no stem sentence to wait for');
  unseen = unseenSentences([stem, other], [{ sentenceId: 's1', direction: 'enToFa' }]);
  assert.equal(eligibleAsNew(drill, null, unseen), true, 'stem met once, in either direction');
});
