// UI controller. Plain DOM — no framework, no build step.

import * as db from './db.js';
import * as deck from './deck.js';
import * as backup from './backup.js';
import * as session from './session.js';
import * as SM2 from './sm2.js';
import * as speech from './speech.js';
import * as levels from './levels.js';
import * as sound from './sound.js';
import { t as text, applyStrings, faDigits } from './strings.js';
import { tagTitle } from './taxonomy.js';

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  queue: [],
  index: 0,
  completed: 0,
  passes: 0,
  revealed: false,
  typedOpen: false,
  speechOK: false,
  // A rating is async (IndexedDB), and a second tap landing before it resolves
  // used to record the same card twice and skip the next one.
  busy: false,
  // The most recent rating, for undo. One level deep on purpose: undo is for a
  // mis-tap, not for re-litigating a session.
  last: null,
};

// --- boot ------------------------------------------------------------------

async function boot() {
  state.settings = await db.getSettings();

  // Ask the browser to keep our data. iOS can evict storage for web apps, and
  // an installed PWA with granted persistence is far less likely to lose it.
  db.requestPersistence();

  await deck.loadBundled();
  state.speechOK = await speech.isSpeechAvailable();
  sound.setEnabled(state.settings.soundEnabled !== false);

  applyStrings();

  bindTabs();
  bindToday();
  bindPractice();
  bindKeys();
  bindSettings();

  // An installed app is resumed, not reopened, so without this the counts on
  // Today are yesterday's the next morning.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('practice').hidden) refreshActive();
  });

  await refreshToday();
  registerServiceWorker();
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

function refreshActive() {
  const active = document.querySelector('.tabs button.is-active')?.dataset.screen ?? 'today';
  return showScreen(active);
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

const todayCounts = () => session.counts(
  Date.now(), state.settings.newPerDay, state.settings.currentLevel,
);

async function refreshToday() {
  const level = state.settings.currentLevel;
  const counts = await todayCounts();
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

/**
 * The figures Today used to carry. None of them changes what you do next, so
 * none of them belongs on the screen whose only job is to start a session.
 */
async function renderProgressStats() {
  const counts = await todayCounts();

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

function bindPractice() {
  $('btn-quit').addEventListener('click', endSession);
  $('btn-reveal').addEventListener('click', reveal);
  $('btn-type').addEventListener('click', toggleTyping);
  $('btn-undo').addEventListener('click', undo);
  $('btn-finish').addEventListener('click', endSession);
  $('btn-again').addEventListener('click', startSession);
  $('btn-speak').addEventListener('click', () => {
    const card = currentCard() ?? state.last?.card;
    if (card) speech.speak(card.sentence.farsiText);
  });
  $('rating-row').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-r]');
    if (button) rate(button.dataset.r);
  });
  $('card-typed').addEventListener('keydown', (event) => {
    // Enter submits; Shift+Enter is still a newline for anyone who wants one.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      reveal();
    }
  });
}

/**
 * Keyboard control, for practising at a desk. Every key maps onto a button
 * that already exists, so there is no behaviour here the phone lacks.
 */
function bindKeys() {
  document.addEventListener('keydown', (event) => {
    if ($('practice').hidden || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target === $('card-typed')) {
      if (event.key === 'Escape') $('card-typed').blur();
      return;
    }

    const done = !$('done-view').hidden;
    const key = event.key.toLowerCase();
    const act = (fn) => { event.preventDefault(); fn(); };

    if (key === 'escape') return act(endSession);
    if (key === 'u' || key === 'backspace') return state.last && act(undo);
    if (done) {
      if (key === ' ' || key === 'enter') {
        return act(() => (!$('btn-again').hidden ? startSession() : endSession()));
      }
      return undefined;
    }
    if (!state.revealed) {
      if (key === ' ' || key === 'enter') return act(reveal);
      if (key === 't') return act(toggleTyping);
      return undefined;
    }
    if (key === '1' || key === 'f' || key === 'arrowleft') return act(() => rate('fail'));
    if (key === '2' || key === 'j' || key === 'arrowright' || key === ' ' || key === 'enter') {
      return act(() => rate('pass'));
    }
    if (key === 'p' && state.speechOK) return act(() => $('btn-speak').click());
    return undefined;
  });
}

async function startSession() {
  const counts = await todayCounts();
  const queue = await session.build({
    limit: state.settings.sessionSize,
    maxNew: counts.allowance,
    weights: session.DEFAULT_WEIGHTS,
    level: state.settings.currentLevel,
  });
  if (!queue.length) {
    toast(text('today.nothing'));
    return;
  }

  Object.assign(state, { queue, index: 0, completed: 0, passes: 0, last: null, busy: false });
  $('practice').hidden = false;
  renderCard();
}

const currentCard = () => state.queue[state.index];

function renderCard() {
  const card = currentCard();
  $('btn-undo').hidden = !state.last;
  if (!card) return renderDone();

  state.revealed = false;
  state.typedOpen = false;
  state.shownAt = performance.now();

  $('card-view').hidden = false;
  $('done-view').hidden = true;
  $('done-row').hidden = true;
  document.querySelector('.card-scroll').scrollTop = 0;

  $('practice-progress').textContent = `${faDigits(state.completed)} / ${faDigits(state.queue.length)}`;
  $('card-badge').textContent =
    `${session.directionLabel(card.direction)} · ${levels.levelForDifficulty(card.sentence.difficulty)}` +
    (card.isNew ? ' · new' : '') +
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
  if (state.revealed) return;
  state.typedOpen = !state.typedOpen;
  const typed = $('card-typed');
  typed.hidden = !state.typedOpen;
  $('btn-type').classList.toggle('on', state.typedOpen);
  if (state.typedOpen) typed.focus();
}

function reveal() {
  const card = currentCard();
  if (!card || state.revealed) return;
  $('card-typed').blur();
  state.revealed = true;
  // Still recorded, but nothing is shown and nothing gates on it. It is the
  // one measurement a better scheduler would need later.
  state.msToReveal = Math.round(performance.now() - state.shownAt);

  const answer = $('answer-text');
  answer.textContent = session.answerFor(card.sentence, card.direction);
  answer.classList.toggle('rtl', card.direction === 'enToFa');

  renderTypedEcho(card);
  // The echo above the answer now shows what was typed; leaving the box open
  // invites editing an answer after seeing the key.
  $('card-typed').hidden = true;
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

  // The setting existed and did nothing. Hearing the sentence at the moment
  // you check it is the cheapest shadowing there is.
  if (state.speechOK && state.settings.speakEnabled) speech.speak(card.sentence.farsiText);
}

/**
 * What you typed, next to the answer. A match is marked, a miss is only shown:
 * the verdict stays yours, because a correct paraphrase will not match.
 */
function renderTypedEcho(card) {
  const echo = $('typed-echo');
  const typed = $('card-typed').value.trim();
  echo.hidden = !typed;
  if (!typed) return;

  const match = session.matchesAnswer(typed, card.sentence, card.direction);
  echo.className = `typed-echo${match ? ' is-match' : ''}`;
  echo.classList.toggle('rtl', card.direction === 'enToFa');
  echo.textContent = match ? `${typed}  ✓` : typed;
}

/**
 * An interlinear map between the Persian and the English.
 *
 * Each unit is one column: the Persian on top, its gloss directly beneath. The
 * columns run right to left, as the sentence does, so the Persian reads in its
 * real order and every gloss sits exactly under the word it glosses — the way
 * interlinear glosses of any right-to-left language are set. Two free-flowing
 * rows could not do both: laid out left to right the Persian read backwards,
 * and laid out right to left the pairs stopped lining up.
 *
 * Words that belong to one unit stay one column, which is the honest treatment
 * of compound verbs: "بلند می‌شه" is literally "tall becomes" but means "gets
 * up". Tapping a column shows its transliteration and part of speech.
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
    const columns = units.map((u, i) => `
      <button class="pair" data-u="${i}">
        <span class="pair-fa">${escapeHtml(u.fa.trim())}</span>
        <span class="pair-en">${escapeHtml(u.en.trim())}</span>
      </button>`).join('');

    host.innerHTML = `
      <div class="map-row">${columns}</div>
      <p class="map-detail" id="map-detail">${escapeHtml(text('card.tapWord'))}</p>`;

    const detail = host.querySelector('#map-detail');
    const all = [...host.querySelectorAll('.pair')];

    const select = (index) => {
      for (const pair of all) pair.classList.toggle('on', pair.dataset.u === String(index));
      const u = units[index];
      const multi = u.fa.trim().split(/\s+/).length > 1;
      detail.innerHTML =
        `<span class="map-translit">${escapeHtml(u.translit)}</span>` +
        `<span class="map-means">${escapeHtml(u.en)}</span>` +
        `<span class="map-pos">${escapeHtml(u.pos)}</span>` +
        (multi ? `<span class="map-note">${escapeHtml(text('card.unit'))}</span>` : '');
    };

    const hoverable = matchMedia('(hover: hover)').matches;
    for (const pair of all) {
      pair.addEventListener('click', () => select(Number(pair.dataset.u)));
      // On a touchscreen hover fires as part of the tap, so binding it there
      // would just duplicate the click.
      if (hoverable) {
        pair.addEventListener('mouseenter', () => select(Number(pair.dataset.u)));
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
  row.hidden = false;
}

async function rate(rating) {
  const card = currentCard();
  if (!card || !state.revealed || state.busy) return;
  state.busy = true;

  try {
    const typed = $('card-typed').value.trim();
    const before = card.review;
    const wasNew = card.isNew;
    const result = await session.recordAttempt({
      card,
      rating,
      typedAnswer: typed || null,
      msToReveal: state.msToReveal,
    });

    // The card object carries its schedule through the session. Leaving the
    // pre-rating state on it meant a card failed and then passed on its second
    // showing was scheduled from where it stood *before* the fail — a 15-day
    // card jumped to ~38 days and lost the lapse.
    card.review = result.review;
    card.isNew = false;

    state.completed += 1;
    if (rating === 'pass') state.passes += 1;
    // A miss comes back this session, not tomorrow — the point is repetition
    // under pressure, and a day's gap wastes the miss.
    const requeued = rating === 'fail';
    if (requeued) state.queue.push(card);

    state.last = { card, before, wasNew, rating, requeued, ...result };

    // A distinct tone for a miss, so you register it without reading anything.
    if (state.index + 1 >= state.queue.length) sound.complete();
    else if (requeued) sound.again();
    else sound.next();

    speech.stopSpeaking();
    state.index += 1;
    renderCard();
  } finally {
    state.busy = false;
  }
}

/** Take back the last rating: schedule, attempt, tag counts and queue position. */
async function undo() {
  const last = state.last;
  if (!last || state.busy) return;
  state.busy = true;
  try {
    await session.undoAttempt(last);
    last.card.review = last.before;
    last.card.isNew = last.wasNew;
    if (last.requeued) state.queue.pop();
    state.index -= 1;
    state.completed -= 1;
    if (last.rating === 'pass') state.passes -= 1;
    state.last = null;
    renderCard();
    toast(text('card.undone'), 1400);
  } finally {
    state.busy = false;
  }
}

async function renderDone() {
  state.revealed = false;
  $('card-view').hidden = true;
  $('done-view').hidden = false;
  $('input-row').hidden = true;
  $('btn-reveal').hidden = true;
  $('rating-row').hidden = true;
  $('done-row').hidden = false;
  $('practice-progress').textContent = `${faDigits(state.completed)} / ${faDigits(state.queue.length)}`;

  // Distinct cards, not ratings: a card missed twice then passed is one card.
  const cards = new Set(state.queue.map(session.cardId)).size;
  $('done-summary').textContent =
    `${faDigits(cards)} ${text('card.practised')} · ${faDigits(state.passes)}/${faDigits(state.completed)} ${text('today.right')}`;

  const counts = await todayCounts();
  const more = counts.total > 0;
  $('btn-again').hidden = !more;
  $('btn-again').innerHTML = `${escapeHtml(text('card.again'))} &rarr;`;
  $('done-next').textContent = more
    ? `${faDigits(counts.due)} ${text('today.due')} · ${faDigits(counts.new)} ${text('today.new')}`
    : text('card.allDone');
}

async function endSession() {
  speech.stopSpeaking();
  $('practice').hidden = true;
  state.queue = [];
  state.last = null;
  await refreshActive();
}

// --- weak spots ------------------------------------------------------------

const MIN_EVIDENCE = 3;

/** The three counts that gate the current level, as bars you can watch fill. */
async function renderGates() {
  const gate = await levels.progress(state.settings.currentLevel);
  const pct = (v, n) => (n > 0 ? Math.min(100, Math.round((v / n) * 100)) : 0);

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
      : `All three must be met. Seen: distinct cards at this level. Accuracy: the last ${levels.GATE.accuracyWindow} reviews here. Retained: cards now ${levels.GATE.retentionDays}+ days apart &mdash; the one that stops a level being passed by cramming.`}</p>`;
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

  html += ranked.length
    ? '<p class="section-note">Every feature a missed sentence exercises is counted against, so read this as where misses cluster, not as a diagnosis.</p>'
    : `<p class="section-note">Rates appear once a feature has come up ${MIN_EVIDENCE} times.</p>`;
  list.innerHTML = html;
}

// --- settings --------------------------------------------------------------

function bindSettings() {
  const slider = (id, labelId, key) => {
    $(id).addEventListener('input', (e) => { $(labelId).textContent = e.target.value; });
    $(id).addEventListener('change', async (e) => {
      state.settings = await db.saveSettings({ [key]: Number(e.target.value) });
    });
  };
  slider('set-new', 'new-value', 'newPerDay');
  slider('set-round', 'round-value', 'sessionSize');
  slider('set-target', 'target-value', 'dailyTarget');

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

  $('btn-export').addEventListener('click', async () => {
    const data = await backup.exportData();
    const outcome = await backup.saveFile(data);
    if (outcome === 'cancelled') return;
    await db.saveSettings({ lastBackupAt: Date.now() });
    state.settings = await db.getSettings();
    toast(`Backup saved: ${data.reviews.length} scheduled cards, ${data.attempts.length} reviews.`);
    await renderSettings();
  });

  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'an unknown date';
      // eslint-disable-next-line no-alert
      if (!confirm(`Replace this device's progress with the backup from ${when}?`)) return;
      const result = await backup.importData(data);
      state.settings = result.settings;
      sound.setEnabled(state.settings.soundEnabled !== false);
      toast(`Restored ${result.reviews} scheduled cards and ${result.attempts} reviews` +
        (result.skipped ? ` (${result.skipped} no longer in the deck).` : '.'), 4000);
      await renderSettings();
    } catch (error) {
      toast(error.message || 'That file could not be read.', 4000);
    }
  });
}

async function renderSettings() {
  const s = state.settings;
  $('set-new').value = s.newPerDay;
  $('new-value').textContent = s.newPerDay;
  $('set-round').value = s.sessionSize;
  $('round-value').textContent = s.sessionSize;
  $('set-target').value = s.dailyTarget;
  $('target-value').textContent = s.dailyTarget;
  $('set-speak').checked = s.speakEnabled;
  $('set-sound').checked = s.soundEnabled !== false;

  $('set-level').innerHTML = levels.LEVELS
    .map((l) => `<option value="${l}"${l === s.currentLevel ? ' selected' : ''}>${l} — ${escapeHtml(levels.LEVEL_META[l].summary)}</option>`)
    .join('');

  $('backup-report').textContent = s.lastBackupAt
    ? `Last backup ${new Date(s.lastBackupAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}. Restoring replaces what is on this device.`
    : 'Your schedule and history exist only in this browser, and iOS can clear a web app\'s storage. Save a backup to Files now and then; restoring replaces what is on this device.';

  $('keys-group').hidden = !matchMedia('(hover: hover) and (pointer: fine)').matches;

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
