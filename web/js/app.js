// UI controller. Plain DOM — no framework, no build step.

import * as db from './db.js';
import * as api from './api.js';
import * as session from './session.js';
import * as SM2 from './sm2.js';
import * as speech from './speech.js';
import * as levels from './levels.js';
import * as sound from './sound.js';
import { ERROR_TAGS, tagTitle } from './taxonomy.js';

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  queue: [],
  index: 0,
  completed: 0,
  total: 0,
  revealed: false,
  typedOpen: false,
  audioBlob: null,
  recorder: new speech.Recorder(),
  speechOK: false,
};

// --- boot ------------------------------------------------------------------

async function boot() {
  state.settings = await db.getSettings();

  // Ask the browser to keep our data. iOS can evict storage for web apps, and
  // an installed PWA with granted persistence is far less likely to lose it.
  db.requestPersistence();

  await loadSeedIfNeeded();
  state.speechOK = await speech.isSpeechAvailable();
  sound.setEnabled(state.settings.soundEnabled !== false);

  bindTabs();
  bindToday();
  bindPractice();
  bindSettings();

  await refreshToday();
  registerServiceWorker();
}

/**
 * Load the bundled deck, and merge in anything added since.
 *
 * Seeding only when the store was empty meant an existing learner never
 * received new sentences: the deck grew from 400 to 730 and their device kept
 * showing 400, silently, forever. Matching on farsiText rather than id because
 * ids are minted per device.
 */
async function loadSeedIfNeeded() {
  try {
    const response = await fetch('data/seed_sentences.json');
    if (!response.ok) return;
    const bundle = await response.json();
    const incoming = bundle.sentences ?? [];
    if (!incoming.length) return;

    const existing = await db.getAll(db.STORE.sentences);
    const seen = new Set(existing.map((s) => s.farsiText));

    const fresh = incoming
      .filter((s) => !seen.has(s.farsiText))
      .map((s) => ({
        id: crypto.randomUUID(),
        ...s,
        kind: s.kind ?? 'sentence',
        source: 'seed',
        createdAt: Date.now(),
      }));

    if (fresh.length) await db.putMany(db.STORE.sentences, fresh);

    // Annotations (breakdown, alternatives) are added to sentences that already
    // exist on device, so merge those onto the rows we already hold.
    const byText = new Map(incoming.map((s) => [s.farsiText, s]));
    const updated = [];
    for (const row of existing) {
      const source = byText.get(row.farsiText);
      if (!source?.breakdown || row.breakdown) continue;
      updated.push({ ...row, breakdown: source.breakdown, alternatives: source.alternatives ?? [] });
    }
    if (updated.length) await db.putMany(db.STORE.sentences, updated);
  } catch {
    // Not fatal — the Today screen surfaces an empty deck and Sync can fill it.
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Offline caching is an enhancement; the app still runs without it.
  });
}

// --- navigation ------------------------------------------------------------

function bindTabs() {
  for (const button of document.querySelectorAll('.tabs button')) {
    button.addEventListener('click', () => showScreen(button.dataset.screen));
  }
}

async function showScreen(name) {
  for (const section of document.querySelectorAll('.screen')) {
    section.classList.toggle('is-active', section.id === `screen-${name}`);
  }
  for (const button of document.querySelectorAll('.tabs button')) {
    button.classList.toggle('is-active', button.dataset.screen === name);
  }
  if (name === 'today') await refreshToday();
  if (name === 'weak') await renderWeakSpots();
  if (name === 'results') await renderResults();
  if (name === 'settings') await renderSettings();
}

function toast(message, ms = 2600) {
  const element = $('toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { element.hidden = true; }, ms);
}

// --- today -----------------------------------------------------------------

function bindToday() {
  $('btn-start').addEventListener('click', startSession);
  $('btn-advance').addEventListener('click', async () => {
    const next = levels.nextLevel(state.settings.currentLevel);
    if (!next) return;
    state.settings = await db.saveSettings({
      currentLevel: next,
      levelsPassed: [...state.settings.levelsPassed, state.settings.currentLevel],
    });
    toast(`Now on ${next}.`);
    await refreshToday();
  });
  $('btn-sync').addEventListener('click', doSync);
}

async function refreshToday() {
  const level = state.settings.currentLevel;
  const counts = await session.counts(Date.now(), state.settings.dailyBatchSize, level);
  const gate = await levels.progress(level);

  $('level-now').textContent = level;
  renderPassPanel(gate);

  const streak = await session.streak();
  $('streak').textContent = streak.days === 1 ? '1 day' : `${streak.days} days`;
  $('streak').classList.toggle('is-zero', streak.days === 0);

  const target = state.settings.dailyTarget;
  $('target-progress').textContent = `${counts.reviewedToday} / ${target}`;
  $('target-progress').classList.toggle('is-hit', counts.reviewedToday >= target);

  $('count-due').textContent = counts.due;
  $('count-new').textContent = counts.new;
  $('count-held').textContent = counts.sentenceCount;
  $('last-sync').textContent = state.settings.lastSyncAt
    ? relativeTime(state.settings.lastSyncAt)
    : 'never';

  for (const [id, value] of [['count-due', counts.due], ['count-new', counts.new]]) {
    $(id).classList.toggle('is-zero', value === 0);
  }

  const empty = counts.sentenceCount === 0;
  $('today-empty').hidden = !empty;
  $('counts').hidden = empty;

  const startable = counts.total > 0;
  $('btn-start').disabled = !startable;
  $('btn-start').innerHTML = startable ? 'Start &rarr;' : 'Nothing due';

  await renderRegister();

  const pending = (await api.pendingAttempts(1000)).length;
  const status = $('sync-status');
  if (!status.dataset.busy) {
    status.className = 'sync-status';
    status.textContent = pending
      ? `${pending} attempt${pending === 1 ? '' : 's'} waiting to be graded`
      : '';
  }
}

/** The accumulating half of the ledger: one row per day of practice. */
async function renderRegister() {
  const rows = await session.history(14);
  $('register').hidden = rows.length === 0;
  if (!rows.length) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  $('register-rows').innerHTML = rows.map((row) => {
    const when = row.date === today.getTime()
      ? 'Today'
      : new Date(row.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `<div class="ledger-row">
      <span>${when}</span>
      <b class="col-n">${row.reviewed}</b>
      <b class="col-pct">${Math.round(row.accuracy * 100)}%</b>
    </div>`;
  }).join('');
}

/** The moment a level is cleared. Advancing is a deliberate tap, not automatic. */
function renderPassPanel(gate) {
  const panel = $('passed-panel');
  const next = levels.nextLevel(gate.level);
  panel.hidden = !gate.passed || !next;
  if (panel.hidden) return;

  $('passed-head').textContent = `${gate.level} passed.`;
  $('passed-note').textContent =
    `${levels.LEVEL_META[next].summary} Earlier levels keep coming back on schedule.`;
  $('btn-advance').innerHTML = `Unlock ${next} &rarr;`;
}

function relativeTime(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

async function doSync(restore = false) {
  const status = $('sync-status');
  const button = $('btn-sync');
  status.dataset.busy = '1';
  button.disabled = true;

  const setStatus = (text, kind = '') => {
    status.className = `sync-status ${kind}`.trim();
    status.textContent = text;
  };

  try {
    const pending = await api.pendingAttempts();
    setStatus(pending.length ? `Grading ${pending.length}…` : 'Fetching sentences…');

    const reviews = await api.changedReviews(state.settings.lastSyncAt);
    const result = await api.sync({
      attempts: pending,
      reviews,
      wantSentences: state.settings.dailyBatchSize,
      since: state.settings.lastSyncAt,
      settings: state.settings,
      restore,
    });

    const { graded, added, restored } = await api.applyResult(result, pending);
    state.settings = await db.getSettings();

    const parts = [];
    if (graded) parts.push(`${graded} graded`);
    if (added) parts.push(`${added} new`);
    if (restored) parts.push(`${restored} schedules restored`);
    if (reviews.length) parts.push(`${reviews.length} backed up`);
    setStatus(parts.join(' · ') || 'Nothing to sync.');

    for (const warning of result.warnings ?? []) toast(warning, 5000);
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    delete status.dataset.busy;
    button.disabled = false;
    await refreshToday();
  }
}

// --- practice --------------------------------------------------------------

function bindPractice() {
  $('btn-quit').addEventListener('click', endSession);
  $('btn-reveal').addEventListener('click', reveal);
  $('btn-type').addEventListener('click', toggleTyping);
  $('btn-record').addEventListener('click', toggleRecording);
  $('btn-speak').addEventListener('click', () => {
    speech.speak(currentCard().sentence.farsiText);
  });
  $('btn-listen').addEventListener('click', () => {
    speech.speak(session.audioFor(currentCard().sentence));
  });
}

async function startSession() {
  const counts = await session.counts(
    Date.now(), state.settings.dailyBatchSize, state.settings.currentLevel,
  );
  const limit = Math.min(state.settings.dailyBatchSize, Math.max(counts.total, 1));
  state.queue = await session.build({
    limit,
    weights: state.settings.directionWeights,
    level: state.settings.currentLevel,
    speechAvailable: state.speechOK,
  });
  if (!state.queue.length) return;

  state.index = 0;
  state.completed = 0;
  state.total = state.queue.length;
  $('practice').hidden = false;
  renderCard();
}

const currentCard = () => state.queue[state.index];

function renderCard() {
  const card = currentCard();
  if (!card) return renderDone();

  state.revealed = false;
  state.typedOpen = false;
  state.audioBlob = null;
  state.shownAt = performance.now();
  startPace(card);

  $('practice-progress').textContent = `${state.completed} / ${state.total}`;
  $('card-badge').textContent =
    `${session.directionLabel(card.direction)} · L${card.sentence.difficulty}` +
    (card.review.lapses > 0 ? ` · ${card.review.lapses} lapse${card.review.lapses === 1 ? '' : 's'}` : '');

  const listening = session.isListening(card.direction);
  const prompt = $('card-prompt');
  prompt.textContent = session.promptFor(card.sentence, card.direction);
  prompt.classList.toggle('rtl', card.direction === 'faToEn');
  prompt.hidden = listening;

  // A listening card must show no Persian text — revealing it would turn the
  // exercise back into reading.
  $('btn-listen').hidden = !listening;
  $('listen-hint').hidden = !listening;
  if (listening) speech.speak(session.audioFor(card.sentence));

  const typed = $('card-typed');
  typed.value = '';
  typed.hidden = true;
  typed.classList.toggle('rtl', card.direction === 'enToFa');
  typed.placeholder = card.direction === 'enToFa' ? 'بنویس…' : 'Type the English…';

  $('card-answer').hidden = true;
  $('btn-reveal').hidden = false;
  $('input-row').hidden = false;
  $('rating-row').hidden = true;
  $('btn-type').classList.remove('on');
  $('btn-record').classList.remove('rec', 'on');
  $('btn-record').textContent = 'Record';
  $('btn-record').hidden = !speech.Recorder.isSupported();
}

/**
 * A line that depletes over the card's target time.
 *
 * It never blocks and never auto-fails: an app that snatches the card away
 * teaches anxiety, not fluency. Running out simply marks the attempt slow.
 */
function startPace(card) {
  const fill = $('pace-fill');
  const target = session.targetMs(card.sentence, card.direction);

  fill.style.transition = 'none';
  fill.style.width = '100%';
  fill.classList.remove('over');

  // Force a reflow so the reset applies before the animation starts.
  void fill.offsetWidth;

  fill.style.transition = `width ${target}ms linear`;
  fill.style.width = '0%';

  clearTimeout(startPace._timer);
  startPace._timer = setTimeout(() => {
    if (!state.revealed) fill.classList.add('over');
  }, target);
}

function stopPace() {
  clearTimeout(startPace._timer);
  const fill = $('pace-fill');
  fill.style.transition = 'none';
  fill.style.width = '0%';
}

function toggleTyping() {
  state.typedOpen = !state.typedOpen;
  const typed = $('card-typed');
  typed.hidden = !state.typedOpen;
  $('btn-type').classList.toggle('on', state.typedOpen);
  if (state.typedOpen) typed.focus();
}

async function toggleRecording() {
  const button = $('btn-record');
  try {
    if (state.recorder.isRecording) {
      state.audioBlob = await state.recorder.stop();
      button.classList.remove('rec');
      button.classList.toggle('on', !!state.audioBlob);
      button.textContent = state.audioBlob ? 'Re-record' : 'Record';
    } else {
      await state.recorder.start();
      button.classList.add('rec');
      button.textContent = 'Stop';
    }
  } catch (error) {
    toast(`Microphone unavailable: ${error.message}`);
    button.classList.remove('rec');
    button.textContent = 'Record';
  }
}

async function reveal() {
  const card = currentCard();
  if (state.recorder.isRecording) await toggleRecording();
  $('card-typed').blur();
  state.revealed = true;
  state.msToReveal = Math.round(performance.now() - state.shownAt);
  stopPace();

  const answer = $('answer-text');
  answer.textContent = session.answerFor(card.sentence, card.direction);
  answer.classList.toggle('rtl', card.direction === 'enToFa');

  // After a listening card is answered, show the Persian that was spoken —
  // hearing it without ever seeing it leaves the spelling unlearned.
  const heard = $('card-prompt');
  if (session.isListening(card.direction)) {
    heard.textContent = card.sentence.farsiText;
    heard.classList.add('rtl');
    heard.hidden = false;
  }

  $('answer-finglish').textContent = card.sentence.finglish ?? '';
  renderBreakdown(card.sentence);
  const tags = (card.sentence.grammarTags ?? []).map(tagTitle);
  $('answer-tags').className = 'taglist';
  $('answer-tags').textContent = tags.join(' · ');

  $('btn-speak').hidden = !state.speechOK;
  $('card-answer').hidden = false;
  $('btn-reveal').hidden = true;
  $('input-row').hidden = true;

  renderRatings(card);
}

/**
 * An interactive map between the Persian and the English.
 *
 * Every word is its own chip, so you can see which Persian word carries which
 * English. Tapping either side highlights its counterpart — the mapping works
 * in both directions because word order differs between the two languages and
 * position alone tells you nothing.
 *
 * Words that belong to one unit highlight together, which is the honest
 * treatment of compound verbs: "بلند می‌شه" is literally "tall becomes" but
 * means "gets up", so the two words map jointly to one English idea rather than
 * one-to-one. The detail line names what the group actually means.
 */
function renderBreakdown(sentence) {
  const units = sentence.breakdown ?? [];
  const alts = sentence.alternatives ?? [];

  // Sentences not yet annotated fall back to the old flat gloss.
  $('answer-gloss').textContent = units.length ? '' : (sentence.literalGloss ?? '');
  $('answer-gloss').hidden = units.length > 0;

  const host = $('answer-breakdown');
  host.hidden = units.length === 0;

  if (units.length) {
    const chips = (text, unitIndex, extra = '') => text
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `<button class="chip ${extra}" data-u="${unitIndex}">${escapeHtml(w)}</button>`)
      .join('');

    const farsi = units.map((u, i) => chips(u.fa, i, 'chip-fa')).join('');
    const english = units.map((u, i) => chips(u.en, i, 'chip-en')).join('');

    host.innerHTML = `
      <div class="map-row rtl" id="map-fa">${farsi}</div>
      <div class="map-row" id="map-en">${english}</div>
      <p class="map-detail" id="map-detail">Tap any word to see what it maps to.</p>`;

    const detail = host.querySelector('#map-detail');
    const all = [...host.querySelectorAll('.chip')];

    const select = (index) => {
      for (const chip of all) chip.classList.toggle('on', chip.dataset.u === String(index));
      const u = units[index];
      const multi = u.fa.trim().split(/\s+/).length > 1;
      detail.innerHTML =
        `<span class="map-translit">${escapeHtml(u.translit)}</span>` +
        `<span class="map-means">${escapeHtml(u.en)}</span>` +
        `<span class="map-pos">${escapeHtml(u.pos)}</span>` +
        (multi ? '<span class="map-note">these words work as one unit</span>' : '');
    };

    for (const chip of all) {
      chip.addEventListener('click', () => select(Number(chip.dataset.u)));
    }
  } else {
    host.innerHTML = '';
  }

  $('answer-alts').hidden = alts.length === 0;
  $('answer-alts').innerHTML = alts.length
    ? '<p class="alts-head">Also correct</p>' +
      alts.map((a) => `<p class="alt rtl">${escapeHtml(a)}</p>`).join('')
    : '';
}

/**
 * Western digits to Persian ones (۰۱۲۳۴۵۶۷۸۹).
 *
 * Used only where a number sits inside Persian text. Counters elsewhere stay in
 * Latin digits so the ledger columns remain scannable at a glance.
 */
function faDigits(value) {
  return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

function renderRatings(card) {
  const row = $('rating-row');
  const target = session.targetMs(card.sentence, card.direction);
  const withinTarget = (state.msToReveal ?? 0) <= target;
  const seconds = ((state.msToReveal ?? 0) / 1000).toFixed(1);

  const passDays = SM2.previewInterval(card.review, 'pass');

  // Persian labels: غلط (wrong) and درست (correct). Two short words you would
  // actually think in Persian, rather than an English verdict on Persian work.
  row.innerHTML = `
    <button data-r="fail" class="verdict">
      <span class="verdict-word">غلط</span>
      <small>حالا</small>
    </button>
    <button data-r="pass" class="verdict">
      <span class="verdict-word">درست</span>
      <small>${faDigits(passDays)} روز</small>
    </button>`;

  for (const button of row.querySelectorAll('button')) {
    button.addEventListener('click', () => rate(button.dataset.r), { once: true });
  }
  row.hidden = false;

  // The time is shown after the fact, not as a verdict — it informs the rating
  // rather than making it.
  $('answer-time').textContent = `${seconds}s`;
  $('answer-time').classList.toggle('slow', !withinTarget);
  $('answer-time').hidden = false;
}

async function rate(rating) {
  const card = currentCard();
  const typed = $('card-typed').value.trim();

  await session.recordAttempt({
    card,
    rating,
    typedAnswer: typed || null,
    audioBlob: state.audioBlob,
    msToReveal: state.msToReveal,
  });

  state.completed += 1;
  // "Again" means it comes back this session, not tomorrow — the point is
  // repetition under pressure, and a day's gap wastes the miss.
  if (rating === 'fail') state.queue.push(card);

  // A distinct tone for a miss, so you register it without reading anything.
  if (state.index + 1 >= state.queue.length) sound.complete();
  else if (rating === 'fail') sound.again();
  else sound.next();

  speech.stopSpeaking();
  $('answer-time').hidden = true;
  state.index += 1;
  renderCard();
}

function renderDone() {
  $('card-scroll');
  document.querySelector('.card-scroll').innerHTML =
    `<div class="done-panel"><h2>Session complete</h2>
     <p class="note">${state.completed} card${state.completed === 1 ? '' : 's'} practised</p></div>`;
  $('controls');
  document.querySelector('.controls').innerHTML =
    '<button id="btn-finish" style="text-align:right;font-size:19px;font-weight:600;padding:8px 0">Done &rarr;</button>';
  $('btn-finish').addEventListener('click', endSession);
}

async function endSession() {
  stopPace();
  if (state.recorder.isRecording) await state.recorder.stop();
  speech.stopSpeaking();
  $('practice').hidden = true;
  // The done screen replaced the card markup; a reload restores it cleanly.
  if (!document.querySelector('#card-prompt')) location.reload();
  await refreshToday();
}

// --- weak spots ------------------------------------------------------------

const MIN_EVIDENCE = 3;

/** The three counts that gate the current level, as bars you can watch fill. */
async function renderGates() {
  const gate = await levels.progress(state.settings.currentLevel);
  const pct = (v, n) => Math.min(100, Math.round((v / n) * 100));

  // Before there are enough reviews to judge accuracy, the bar tracks progress
  // toward having a sample — otherwise it reads 0% while the label says
  // "12 of 40 reviews", which are two different measurements.
  const enoughSamples = gate.accuracy.samples >= levels.GATE.accuracyWindow;
  const accuracyBar = enoughSamples
    ? [Math.round(gate.accuracy.value * 100), Math.round(gate.accuracy.need * 100)]
    : [gate.accuracy.samples, levels.GATE.accuracyWindow];

  const enoughPace = gate.pace.samples >= levels.GATE.accuracyWindow;
  const paceBar = enoughPace
    ? [Math.round(gate.pace.value * 100), Math.round(gate.pace.need * 100)]
    : [gate.pace.samples, levels.GATE.accuracyWindow];

  const rows = [
    ['Cards seen', gate.coverage.value, gate.coverage.need,
     `${gate.coverage.value} of ${gate.coverage.need}`],
    ['Accuracy', accuracyBar[0], accuracyBar[1],
     enoughSamples
       ? `${Math.round(gate.accuracy.value * 100)}% of ${Math.round(gate.accuracy.need * 100)}%`
       : `${gate.accuracy.samples} of ${levels.GATE.accuracyWindow} reviews`],
    ['Cards retained', gate.retention.value, gate.retention.need,
     `${gate.retention.value} of ${gate.retention.need} past ${levels.GATE.retentionDays}d`],
    ['Answered in time', paceBar[0], paceBar[1],
     gate.pace.samples < levels.GATE.accuracyWindow
       ? `${gate.pace.samples} of ${levels.GATE.accuracyWindow} timed`
       : `${Math.round(gate.pace.value * 100)}% of ${Math.round(gate.pace.need * 100)}%`
         + (gate.pace.medianMs ? ` · median ${(gate.pace.medianMs / 1000).toFixed(1)}s` : '')],
  ];

  $('gate-block').innerHTML = `
    <div class="ledger">
      <div class="ledger-row is-head">
        <span>${gate.level} &middot; ${escapeHtml(levels.LEVEL_META[gate.level].summary)}</span>
      </div>
      ${rows.map(([label, value, need, detail]) => `
        <div class="gate-row">
          <div class="entry-top"><b>${label}</b><span class="entry-figure">${detail}</span></div>
          <div class="gate-bar"><i style="width:${pct(value, need)}%"></i></div>
        </div>`).join('')}
    </div>
    <p class="section-note">${gate.passed
      ? 'Passed &mdash; unlock the next level from Today.'
      : 'All four must be met. Retention stops a level being crammed; pace stops you passing it while still needing ten seconds a sentence.'}</p>`;
}

async function renderWeakSpots() {
  await renderGates();
  const stats = await db.getAll(db.STORE.tagStats);
  const list = $('weak-list');

  const seen = stats.filter((s) => s.totalCount > 0);
  if (!seen.length) {
    list.innerHTML = '<p class="empty">Practise, and the grammar features you miss are tallied here.</p>';
    return;
  }

  // Ranked by failure rate, not raw count: a tag you meet constantly and
  // sometimes fail is a smaller problem than one you fail nearly every time.
  const ranked = seen
    .filter((s) => s.totalCount >= MIN_EVIDENCE && s.failCount > 0)
    .sort((a, b) => b.failCount / b.totalCount - a.failCount / a.totalCount);
  const emerging = seen.filter((s) => s.totalCount < MIN_EVIDENCE)
    .sort((a, b) => b.totalCount - a.totalCount);

  const row = (stat, dim) => {
    const rate = stat.totalCount ? stat.failCount / stat.totalCount : 0;
    const pct = Math.round(rate * 100);
    return `<div class="ledger-row tag-row${dim ? ' is-dim' : ''}">
      <span>${escapeHtml(tagTitle(stat.tag))}</span>
      <b class="col-n">${stat.failCount}/${stat.totalCount}</b>
      <b class="col-pct">${dim ? `${stat.totalCount}&times;` : `${pct}%`}</b>
    </div>`;
  };

  let html = '<div class="ledger">'
    + '<div class="ledger-row is-head"><span>Feature</span>'
    + '<b class="col-n">Wrong</b><b class="col-pct">Rate</b></div>'
    + ranked.map((s) => row(s, false)).join('')
    + emerging.map((s) => row(s, true)).join('')
    + '</div>';

  if (ranked.length) {
    html += '<p class="section-note">The worst few are sent with the next sync and weight what gets generated.</p>';
  }
  if (emerging.length && !ranked.length) {
    html += `<p class="section-note">Rates appear once a feature has come up ${MIN_EVIDENCE} times.</p>`;
  }
  list.innerHTML = html;
}

function rateColour(rate) {
  if (rate < 0.25) return 'var(--green)';
  if (rate < 0.5) return 'var(--amber)';
  return 'var(--red)';
}

// --- results ---------------------------------------------------------------

async function renderResults() {
  const [attempts, sentences] = await Promise.all([
    db.getAll(db.STORE.attempts),
    db.getAll(db.STORE.sentences),
  ]);
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const graded = attempts.filter((a) => a.gradedAt).sort((a, b) => b.createdAt - a.createdAt);
  const list = $('results-list');

  if (!graded.length) {
    list.innerHTML = '<p class="empty">Type or record an answer, then sync to have it graded.</p>';
    return;
  }

  list.innerHTML = graded.slice(0, 100).map((a) => {
    const sentence = byId.get(a.sentenceId);
    // Only a real failure earns colour; the rest are figures in a column.
    const colour = ['major', 'wrong'].includes(a.aiVerdict)
      ? 'var(--alarm)' : 'var(--ink)';
    const said = a.transcript || a.typedAnswer;
    return `<div class="entry">
      <div class="entry-top">
        <b>${sentence ? escapeHtml(sentence.englishText) : '&mdash;'}</b>
        <span class="entry-figure" style="color:${colour}">${a.aiScore ?? '--'}</span>
      </div>
      ${said ? `<p class="note rtl" style="margin-top:8px">${escapeHtml(said)}</p>` : ''}
      ${a.correctedFarsi && a.correctedFarsi !== said
        ? `<p class="note rtl" style="margin-top:4px;color:var(--ink)">${escapeHtml(a.correctedFarsi)}</p>` : ''}
      ${a.aiFeedback ? `<p class="note-faint">${escapeHtml(a.aiFeedback)}</p>` : ''}
      ${(a.aiErrorTags ?? []).length
        ? `<p class="taglist bad">${(a.aiErrorTags).map((t) => escapeHtml(tagTitle(t))).join(' \u00b7 ')}</p>` : ''}
    </div>`;
  }).join('');
}

// --- settings --------------------------------------------------------------

function bindSettings() {
  $('set-url').addEventListener('change', async (e) => {
    state.settings = await db.saveSettings({ backendURL: e.target.value.trim() });
  });
  $('set-token').addEventListener('change', async (e) => {
    state.settings = await db.saveSettings({ apiToken: e.target.value.trim() });
  });
  $('set-batch').addEventListener('input', async (e) => {
    $('batch-value').textContent = e.target.value;
    state.settings = await db.saveSettings({ dailyBatchSize: Number(e.target.value) });
  });
  $('set-target').addEventListener('input', async (e) => {
    $('target-value').textContent = e.target.value;
    state.settings = await db.saveSettings({ dailyTarget: Number(e.target.value) });
  });

  // The three weights are normalised at selection time, so they need not sum to
  // 100 — the labels show raw values and the builder handles the proportions.
  for (const [id, key] of [['w-prod', 'enToFa'], ['w-read', 'faToEn'], ['w-listen', 'listenToEn']]) {
    $(id).addEventListener('input', async (e) => {
      $(`${id}-value`).textContent = `${e.target.value}%`;
      state.settings = await db.saveSettings({
        directionWeights: { ...state.settings.directionWeights, [key]: Number(e.target.value) / 100 },
      });
    });
  }
  $('set-speak').addEventListener('change', async (e) => {
    state.settings = await db.saveSettings({ speakEnabled: e.target.checked });
  });
  $('set-sound').addEventListener('change', async (e) => {
    state.settings = await db.saveSettings({ soundEnabled: e.target.checked });
    sound.setEnabled(e.target.checked);
    if (e.target.checked) sound.next();   // so you hear what you just enabled
  });

  $('set-level').addEventListener('change', async (e) => {
    state.settings = await db.saveSettings({ currentLevel: e.target.value });
    toast(`New cards now come from ${e.target.value}.`);
    await renderSettings();
  });

  $('btn-restore').addEventListener('click', async () => {
    const out = $('restore-result');
    out.textContent = 'Restoring…';
    await doSync(true);
    const settings = await db.getSettings();
    out.textContent = settings.lastSyncAt
      ? 'Done — see the Sync line on Today for what came back.'
      : 'Could not reach the backend.';
    await renderSettings();
  });

  $('btn-health').addEventListener('click', async () => {
    const result = $('health-result');
    result.textContent = 'Checking…';
    try {
      const body = await api.health(state.settings.backendURL);
      result.textContent = `OK — service is up (${body.tags} tags).`;
      result.style.color = 'var(--green)';
    } catch (error) {
      result.textContent = error.message;
      result.style.color = 'var(--red)';
    }
  });
}

async function renderSettings() {
  const s = state.settings;
  $('set-url').value = s.backendURL;
  $('set-token').value = s.apiToken;
  $('set-batch').value = s.dailyBatchSize;
  $('batch-value').textContent = s.dailyBatchSize;
  $('set-target').value = s.dailyTarget;
  $('target-value').textContent = s.dailyTarget;
  const w = s.directionWeights;
  for (const [id, key] of [['w-prod', 'enToFa'], ['w-read', 'faToEn'], ['w-listen', 'listenToEn']]) {
    $(id).value = Math.round((w[key] ?? 0) * 100);
    $(`${id}-value`).textContent = `${Math.round((w[key] ?? 0) * 100)}%`;
  }
  // Hide the listening weight entirely when the device has no Persian voice —
  // a slider that changes nothing is worse than no slider.
  $('listen-weight-row').hidden = !state.speechOK;
  $('weights-hint').textContent = state.speechOK
    ? 'Producing Farsi is the skill that freezes; recognising it is easier.'
    : 'Hearing is unavailable: no Persian voice is installed on this device.';
  $('set-speak').checked = s.speakEnabled;
  $('set-sound').checked = s.soundEnabled !== false;

  $('set-level').innerHTML = levels.LEVELS
    .map((l) => `<option value="${l}"${l === s.currentLevel ? ' selected' : ''}>${l} — ${escapeHtml(levels.LEVEL_META[l].summary)}</option>`)
    .join('');

  const voices = await speech.voiceReport();
  $('voice-report').textContent = voices.persian.length
    ? `Persian voice available: ${voices.persian.join(', ')}`
    : `No Persian voice on this device (${voices.total} voices found). ` +
      'Add one in iOS Settings → Accessibility → Spoken Content → Voices → Farsi, then reopen this app.';

  const [sentences, attempts] = await Promise.all([
    db.count(db.STORE.sentences),
    db.getAll(db.STORE.attempts),
  ]);
  const estimate = await db.estimateUsage();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;

  const enoughPace = gate.pace.samples >= levels.GATE.accuracyWindow;
  const paceBar = enoughPace
    ? [Math.round(gate.pace.value * 100), Math.round(gate.pace.need * 100)]
    : [gate.pace.samples, levels.GATE.accuracyWindow];

  const rows = [
    ['Sentences', sentences],
    ['Attempts', attempts.length],
    ['Waiting to sync', attempts.filter((a) => !a.syncedAt).length],
    ['Storage used', estimate ? formatBytes(estimate.usage) : 'n/a'],
    ['Eviction protected', persisted ? 'Yes' : 'No'],
  ];
  $('storage-info').className = 'ledger';
  $('storage-info').innerHTML = rows
    .map(([k, v]) => `<div class="ledger-row"><span>${k}</span><b>${v}</b></div>`)
    .join('');
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

boot();
