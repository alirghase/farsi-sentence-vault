// UI controller. Plain DOM — no framework, no build step.

import * as db from './db.js';
import * as deck from './deck.js';
import * as backup from './backup.js';
import * as session from './session.js';
import * as SM2 from './sm2.js';
import * as speech from './speech.js';
import * as levels from './levels.js';
import { t as text, applyStrings, faDigits } from './strings.js';
import { posTitle } from './taxonomy.js';

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  queue: [],
  index: 0,
  completed: 0,
  passes: 0,
  revealed: false,
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
  // Before anything that can fail. Every string on the screen is Persian, and
  // a boot that dies early used to leave the English placeholder markup
  // looking like a finished screen with nothing in it.
  applyStrings();

  state.settings = await db.getSettings();

  // Ask the browser to keep our data. iOS can evict storage for web apps, and
  // an installed PWA with granted persistence is far less likely to lose it.
  db.requestPersistence();

  await deck.loadBundled();
  state.speechOK = await speech.isSpeechAvailable();

  watchForLostDatabase();
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

/**
 * Boot failed. Say so, rather than leaving a screen that looks finished.
 *
 * The one failure that actually happens is a schema upgrade blocked by the app
 * being open somewhere else — a Home Screen icon and a Safari tab, which is
 * the normal way to end up with two. Closing the other one and reloading is
 * the whole fix, so that is what it says.
 */
function bootFailed(error) {
  const key = { [db.BLOCKED]: 'boot.blocked', [db.STALE]: 'boot.stale' }[error?.message]
    ?? 'boot.failed';
  $('practice').hidden = true;
  $('counts').hidden = true;
  $('btn-start').hidden = true;
  $('passed-panel').hidden = true;
  const note = $('today-empty');
  note.hidden = false;
  note.textContent = text(key);
  // Nothing below is usable without the database.
  document.querySelector('.tabs').hidden = true;
}

/**
 * The database can also go away *after* boot: a newer copy of the app in
 * another tab upgrades the schema and closes this one's connection. Every
 * later call then rejects, and without this the screen simply stops responding
 * with nothing said. Rare, but a dead UI is the worst way to find out.
 */
function watchForLostDatabase() {
  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason?.message;
    if (message === db.STALE || message === db.BLOCKED) {
      event.preventDefault();
      bootFailed(event.reason);
    }
  });
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
    toast(`${text('today.nowOn')} ${next}`);
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

  $('passed-head').textContent = `${gate.level} — ${text('today.passedHead')}`;
  $('passed-note').textContent =
    `${levels.LEVEL_META[next].summary} ${text('today.passedNote')}`;
  $('btn-advance').innerHTML = `${text('today.unlock')} ${next} &rarr;`;
}

// --- practice --------------------------------------------------------------

function bindPractice() {
  $('btn-quit').addEventListener('click', endSession);
  $('btn-reveal').addEventListener('click', reveal);
  $('btn-type').addEventListener('click', toggleTyping);
  $('btn-undo').addEventListener('click', undo);
  $('btn-finish').addEventListener('click', endSession);
  $('btn-again').addEventListener('click', startSession);
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
  state.shownAt = performance.now();

  $('card-view').hidden = false;
  $('card-view').classList.remove('is-revealed');
  $('done-view').hidden = true;
  $('done-row').hidden = true;
  document.querySelector('.card-scroll').scrollTop = 0;

  $('practice-progress').textContent = `${faDigits(state.completed)} / ${faDigits(state.queue.length)}`;
  // Which way to translate is the only thing here you act on. Level, new and
  // lapse count are the scheduler describing itself, and this is a flashcard.
  $('card-badge').textContent = text(`dir.${card.direction}`);

  const prompt = $('card-prompt');
  prompt.textContent = session.promptFor(card.sentence, card.direction);
  prompt.classList.toggle('rtl', card.direction === 'faToEn');

  // Typing is remembered between cards. It used to reset on every one, so
  // drilling a whole round by typing meant tapping Type twenty times.
  const typed = $('card-typed');
  typed.value = '';
  typed.hidden = !state.settings.typingEnabled;
  typed.classList.toggle('rtl', card.direction === 'enToFa');
  typed.placeholder = text(card.direction === 'enToFa' ? 'card.typeFarsi' : 'card.typeEnglish');

  $('card-answer').hidden = true;
  $('btn-reveal').hidden = false;
  $('input-row').hidden = false;
  $('rating-row').hidden = true;
  $('btn-type').classList.toggle('on', state.settings.typingEnabled);
}

/** Type or speak, remembered until you change it back. */
async function toggleTyping() {
  if (state.revealed) return;
  const on = !state.settings.typingEnabled;
  state.settings = await db.saveSettings({ typingEnabled: on });
  const typed = $('card-typed');
  typed.hidden = !on;
  $('btn-type').classList.toggle('on', on);
  if (on) typed.focus();
}

function reveal() {
  const card = currentCard();
  if (!card || state.revealed) return;
  $('card-typed').blur();
  state.revealed = true;
  $('card-view').classList.add('is-revealed');
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
  $('card-answer').hidden = false;
  $('btn-reveal').hidden = true;
  $('input-row').hidden = true;

  renderRatings(card);

  // Hearing the sentence at the moment you check it is the cheapest
  // shadowing there is, and it is the only audio left: a Play button next to
  // an answer you are already looking at was a second way to do one thing.
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
      <p class="map-detail" id="map-detail"></p>`;

    const detail = host.querySelector('#map-detail');
    const all = [...host.querySelectorAll('.pair')];

    const select = (index) => {
      for (const pair of all) pair.classList.toggle('on', pair.dataset.u === String(index));
      const u = units[index];
      const multi = u.fa.trim().split(/\s+/).length > 1;
      detail.innerHTML =
        `<span class="map-translit">${escapeHtml(u.translit)}</span>` +
        `<span class="map-means">${escapeHtml(u.en)}</span>` +
        `<span class="map-pos">${escapeHtml(posTitle(u.pos))}</span>` +
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

// --- settings --------------------------------------------------------------

function bindSettings() {
  const slider = (id, labelId, key) => {
    $(id).addEventListener('input', (e) => { $(labelId).textContent = faDigits(e.target.value); });
    $(id).addEventListener('change', async (e) => {
      state.settings = await db.saveSettings({ [key]: Number(e.target.value) });
    });
  };
  slider('set-new', 'new-value', 'newPerDay');

  $('set-speak').addEventListener('change', async (e) => {
    state.settings = await db.saveSettings({ speakEnabled: e.target.checked });
  });

  $('btn-bank-add').addEventListener('click', addOwnSentence);
  $('bank-fa').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addOwnSentence();
  });

  $('set-level').addEventListener('change', async (e) => {
    state.settings = await db.saveSettings({ currentLevel: e.target.value });
    toast(`${text('settings.levelNow')} ${e.target.value}`);
    await renderSettings();
  });

  $('btn-export').addEventListener('click', async () => {
    const data = await backup.exportData();
    const outcome = await backup.saveFile(data);
    if (outcome === 'cancelled') return;
    await db.saveSettings({ lastBackupAt: Date.now() });
    state.settings = await db.getSettings();
    toast(`${text('settings.backupSaved')} — ${faDigits(data.reviews.length)} `
      + `${text('settings.scheduled')}، ${faDigits(data.attempts.length)} ${text('settings.reviews')}`);
    await renderSettings();
  });

  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const when = data.exportedAt
        ? faDigits(new Date(data.exportedAt).toLocaleString('fa-IR'))
        : text('settings.unknownDate');
      // eslint-disable-next-line no-alert
      if (!confirm(`${text('settings.confirmRestore')}\n${when}`)) return;
      const result = await backup.importData(data);
      state.settings = result.settings;
      toast(`${text('settings.backupRestored')} — ${faDigits(result.reviews)} `
        + `${text('settings.scheduled')}، ${faDigits(result.attempts)} ${text('settings.reviews')}`
        + (result.skipped
          ? ` (${faDigits(result.skipped)} ${text('settings.goneFromDeck')})` : ''), 4000);
      await renderSettings();
    } catch (error) {
      toast(error.message || text('settings.backupFailed'), 4000);
    }
  });
}

/**
 * Add a sentence of your own. It becomes an ordinary card: scheduled by SM-2,
 * counted by the level gate, carried in a backup, and left alone when the
 * bundled deck updates.
 */
async function addOwnSentence() {
  const status = $('bank-status');
  try {
    await deck.addCustom({
      english: $('bank-en').value,
      farsi: $('bank-fa').value,
      finglish: $('bank-tr').value,
      // The learner's own level, so it enters the rotation they are working
      // through instead of sitting behind a gate.
      difficulty: levels.LEVEL_META[state.settings.currentLevel].difficulty,
    });
    for (const id of ['bank-en', 'bank-fa', 'bank-tr']) $(id).value = '';
    status.textContent = text('bank.added');
    $('bank-en').focus();
    await renderOwnSentences();

  $('keys-group').hidden = !matchMedia('(hover: hover) and (pointer: fine)').matches;
    await refreshToday();
  } catch (error) {
    const reasons = {
      empty: 'bank.errEmpty',
      notPersian: 'bank.errPersian',
      duplicate: 'bank.errDuplicate',
    };
    status.textContent = text(reasons[error.message] ?? 'bank.errEmpty');
  }
}

async function renderOwnSentences() {
  const rows = await deck.listCustom();
  const list = $('bank-list');
  if (!rows.length) {
    list.innerHTML = `<p class="hint">${escapeHtml(text('bank.none'))}</p>`;
    return;
  }
  list.className = 'ledger';
  list.innerHTML = rows.map((row) => `
    <div class="ledger-row bank-row">
      <span class="rtl">${escapeHtml(row.farsiText)}</span>
      <button class="bank-remove" data-id="${row.id}"
              aria-label="${escapeHtml(text('bank.remove'))}">&times;</button>
    </div>`).join('');

  for (const button of list.querySelectorAll('.bank-remove')) {
    button.addEventListener('click', async () => {
      await deck.removeCustom(button.dataset.id);
      $('bank-status').textContent = text('bank.removed');
      await renderOwnSentences();
      await refreshToday();
    });
  }
}

async function renderSettings() {
  const s = state.settings;
  $('set-new').value = s.newPerDay;
  $('new-value').textContent = faDigits(s.newPerDay);
  $('set-speak').checked = s.speakEnabled;

  $('set-level').innerHTML = levels.LEVELS
    .map((l) => `<option value="${l}"${l === s.currentLevel ? ' selected' : ''}>${l} — ${escapeHtml(levels.LEVEL_META[l].summary)}</option>`)
    .join('');

  $('backup-report').textContent = s.lastBackupAt
    ? `${text('settings.lastBackup')} ${faDigits(new Date(s.lastBackupAt)
        .toLocaleDateString('fa-IR', { day: 'numeric', month: 'long', year: 'numeric' }))}`
      + ` — ${text('settings.backupReplace')}`
    : text('settings.backupHint');

  await renderOwnSentences();

  const voices = await speech.voiceReport();
  $('voice-report').textContent = voices.persian.length
    ? `${text('settings.voiceFound')} ${voices.persian.join('، ')}`
    : `${text('settings.voiceMissing')} — ${text('settings.voiceHow')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

boot().catch((error) => {
  bootFailed(error);
  throw error;
});
