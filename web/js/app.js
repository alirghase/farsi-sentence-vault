// UI controller. Plain DOM — no framework, no build step.

import * as db from './db.js';
import * as session from './session.js';
import * as SM2 from './sm2.js';
import * as speech from './speech.js';
import * as levels from './levels.js';
import * as sound from './sound.js';
import { t as text, applyStrings, faDigits } from './strings.js';
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

  applyStrings();

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
}


async function refreshToday() {
  const level = state.settings.currentLevel;
  const counts = await session.counts(Date.now(), state.settings.dailyBatchSize, level);
  const gate = await levels.progress(level);

  $('level-now').textContent = level;
  renderPassPanel(gate);

  $('count-due').textContent = faDigits(counts.due);
  $('count-new').textContent = faDigits(counts.new);

  for (const [id, value] of [['count-due', counts.due], ['count-new', counts.new]]) {
    $(id).classList.toggle('is-zero', value === 0);
  }

  const empty = counts.sentenceCount === 0;
  $('today-empty').hidden = !empty;
  $('counts').hidden = empty;

  const startable = counts.total > 0;
  $('btn-start').disabled = !startable;
  $('btn-start').innerHTML = startable
    ? `${text('today.start')} &rarr;`
    : text('today.nothing');

}

/**
 * The figures Today used to carry. None of them changes what you do next, so
 * none of them belongs on the screen whose only job is to start a session.
 */
async function renderProgressStats() {
  const counts = await session.counts(
    Date.now(), state.settings.dailyBatchSize, state.settings.currentLevel,
  );

  const streak = await session.streak();
  $('streak').textContent = `${faDigits(streak.days)} ${text('today.day')}`;
  $('streak').classList.toggle('is-zero', streak.days === 0);

  const target = state.settings.dailyTarget;
  $('target-progress').textContent = `${faDigits(counts.reviewedToday)} / ${faDigits(target)}`;
  $('target-progress').classList.toggle('is-hit', counts.reviewedToday >= target);

  $('count-held').textContent = faDigits(counts.sentenceCount);

  await renderRegister();
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
      ? text('tab.today')
      : new Date(row.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `<div class="ledger-row">
      <span>${when}</span>
      <b class="col-n">${faDigits(row.reviewed)}</b>
      <b class="col-pct">${faDigits(Math.round(row.accuracy * 100))}٪</b>
    </div>`;
  }).join('');
}



// --- practice --------------------------------------------------------------

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

function bindPractice() {
  $('btn-quit').addEventListener('click', endSession);
  $('btn-reveal').addEventListener('click', reveal);
  $('btn-type').addEventListener('click', toggleTyping);
  $('btn-speak').addEventListener('click', () => {
    speech.speak(currentCard().sentence.farsiText);
  });
}

async function startSession() {
  const counts = await session.counts(
    Date.now(), state.settings.dailyBatchSize, state.settings.currentLevel,
  );
  const limit = Math.min(state.settings.dailyBatchSize, Math.max(counts.total, 1));
  state.queue = await session.build({
    limit,
    weights: session.DEFAULT_WEIGHTS,
    level: state.settings.currentLevel,
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
  state.shownAt = performance.now();

  $('practice-progress').textContent = `${faDigits(state.completed)} / ${faDigits(state.total)}`;
  $('card-badge').textContent =
    `${session.directionLabel(card.direction)} · L${card.sentence.difficulty}` +
    (card.review.lapses > 0 ? ` · ${card.review.lapses} lapse${card.review.lapses === 1 ? '' : 's'}` : '');

  const prompt = $('card-prompt');
  prompt.textContent = session.promptFor(card.sentence, card.direction);
  prompt.classList.toggle('rtl', card.direction === 'faToEn');

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
}

function toggleTyping() {
  state.typedOpen = !state.typedOpen;
  const typed = $('card-typed');
  typed.hidden = !state.typedOpen;
  $('btn-type').classList.toggle('on', state.typedOpen);
  if (state.typedOpen) typed.focus();
}

async function reveal() {
  const card = currentCard();
  $('card-typed').blur();
  state.revealed = true;
  // Still recorded, but nothing is shown and nothing gates on it. It is the
  // one measurement a better scheduler would need later.
  state.msToReveal = Math.round(performance.now() - state.shownAt);

  const answer = $('answer-text');
  answer.textContent = session.answerFor(card.sentence, card.direction);
  answer.classList.toggle('rtl', card.direction === 'enToFa');

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
    // One chip per unit, never per word. A unit is the thing that maps: a
    // compound verb like پیدا کنم is one idea and one chip, and so is a gloss
    // of several English words. Splitting on spaces broke the pairing — the
    // two rows ended up with different chip counts and stopped lining up.
    const chip = (label, unitIndex, extra) =>
      `<button class="chip ${extra}" data-u="${unitIndex}">${escapeHtml(label.trim())}</button>`;

    const farsi = units.map((u, i) => chip(u.fa, i, 'chip-fa')).join('');
    const english = units.map((u, i) => chip(u.en, i, 'chip-en')).join('');

    host.innerHTML = `
      <div class="map-row rtl" id="map-fa">${farsi}</div>
      <div class="map-row" id="map-en">${english}</div>
      <p class="map-detail" id="map-detail">${escapeHtml(text('card.tapWord'))}</p>`;

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
        (multi ? `<span class="map-note">${escapeHtml(text('card.unit'))}</span>` : '');
    };

    const hoverable = matchMedia('(hover: hover)').matches;
    for (const chip of all) {
      chip.addEventListener('click', () => select(Number(chip.dataset.u)));
      // On a touchscreen hover fires as part of the tap, so binding it there
      // would just duplicate the click.
      if (hoverable) {
        chip.addEventListener('mouseenter', () => select(Number(chip.dataset.u)));
      }
    }
  } else {
    host.innerHTML = '';
  }

  $('answer-alts').hidden = alts.length === 0;
  $('answer-alts').innerHTML = alts.length
    ? `<p class="alts-head">${escapeHtml(text('card.alsoCorrect'))}</p>` +
      alts.map((a) => `<p class="alt rtl">${escapeHtml(a)}</p>`).join('')
    : '';
}

function renderRatings(card) {
  const row = $('rating-row');
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
}

async function rate(rating) {
  const card = currentCard();
  const typed = $('card-typed').value.trim();

  await session.recordAttempt({
    card,
    rating,
    typedAnswer: typed || null,
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
  state.index += 1;
  renderCard();
}

function renderDone() {
  document.querySelector('.card-scroll').innerHTML =
    `<div class="done-panel"><h2>${escapeHtml(text('card.done'))}</h2>
     <p class="note">${state.completed} ${escapeHtml(text('card.practised'))}</p></div>`;
  document.querySelector('.controls').innerHTML =
    `<button id="btn-finish" style="text-align:right;font-size:19px;font-weight:600;padding:8px 0">${escapeHtml(text('card.exit'))} &rarr;</button>`;
  $('btn-finish').addEventListener('click', endSession);
}

async function endSession() {
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

  const rows = [
    [text('progress.seen'), gate.coverage.value, gate.coverage.need,
     `${faDigits(gate.coverage.value)} / ${faDigits(gate.coverage.need)}`],
    [text('progress.accuracy'), accuracyBar[0], accuracyBar[1],
     enoughSamples
       ? `${faDigits(Math.round(gate.accuracy.value * 100))}٪ / ${faDigits(Math.round(gate.accuracy.need * 100))}٪`
       : `${faDigits(gate.accuracy.samples)} / ${faDigits(levels.GATE.accuracyWindow)}`],
    [text('progress.retained'), gate.retention.value, gate.retention.need,
     `${faDigits(gate.retention.value)} / ${faDigits(gate.retention.need)}`],
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
      : 'All three must be met. Retention is the one that matters: it stops a level being passed by cramming.'}</p>`;
}

async function renderWeakSpots() {
  await renderProgressStats();
  await renderGates();
  const stats = await db.getAll(db.STORE.tagStats);
  const list = $('weak-list');

  const seen = stats.filter((s) => s.totalCount > 0);
  if (!seen.length) {
    list.innerHTML = `<p class="empty">${escapeHtml(text('progress.empty'))}</p>`;
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
      <b class="col-n">${faDigits(stat.failCount)}/${faDigits(stat.totalCount)}</b>
      <b class="col-pct">${dim ? `${faDigits(stat.totalCount)}&times;` : `${faDigits(pct)}٪`}</b>
    </div>`;
  };

  let html = '<div class="ledger">'
    + `<div class="ledger-row is-head"><span>${escapeHtml(text('progress.feature'))}</span>`
    + `<b class="col-n">${escapeHtml(text('progress.wrong'))}</b><b class="col-pct">${escapeHtml(text('progress.rate'))}</b></div>`
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


// --- settings --------------------------------------------------------------

function bindSettings() {
  $('set-target').addEventListener('input', async (e) => {
    $('target-value').textContent = e.target.value;
    state.settings = await db.saveSettings({ dailyTarget: Number(e.target.value) });
  });

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

}

async function renderSettings() {
  const s = state.settings;
  $('set-target').value = s.dailyTarget;
  $('target-value').textContent = s.dailyTarget;
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
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

boot();
