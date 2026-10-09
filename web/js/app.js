// UI controller. Plain DOM — no framework, no build step.

import * as db from './db.js';
import * as deck from './deck.js';
import * as backup from './backup.js';
import * as session from './session.js';
import * as SM2 from './sm2.js';
import * as levels from './levels.js';
import { t as text, applyStrings, faDigits } from './strings.js';
import { posTitle, instruction, stemHint } from './taxonomy.js';

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  queue: [],
  index: 0,
  completed: 0,
  passes: 0,
  revealed: false,
  // A rating is async (IndexedDB); a second tap before it resolves would record
  // the same card twice and skip the next one.
  busy: false,
  // The most recent rating, for undo. One level deep on purpose: undo is for a
  // mis-tap, not for re-litigating a session.
  last: null,
  // Set per card / per visit to compose; here so the shape is all in one place.
  shownAt: 0,
  msToReveal: null,
  resumeTo: 'card',
};

// --- boot ------------------------------------------------------------------

async function boot() {
  // Before anything that can fail, so a boot that dies early does not leave the
  // English placeholder markup looking like a finished screen.
  applyStrings();

  state.settings = await db.getSettings();

  // Ask the browser to keep our data. iOS can evict storage for web apps, and
  // an installed PWA with granted persistence is far less likely to lose it.
  db.requestPersistence();

  await deck.loadBundled();

  watchForLostDatabase();
  bindPractice();
  bindKeys();
  bindSettings();

  // An installed app is resumed, not reopened, so the end-of-round panel
  // recounts when you come back — the only place a stale count would show.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('done-view').hidden) renderDone();
  });

  // Straight onto a card. There is no home screen to pass through.
  await startSession();
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
  $('screen-settings').hidden = true;
  $('screen-compose').hidden = true;
  $('practice').hidden = false;
  $('card-view').hidden = true;
  $('done-view').hidden = false;
  $('practice-progress').textContent = '';
  $('btn-undo').hidden = true;
  $('done-view').querySelector('h2').textContent = text(key);
  $('done-summary').textContent = '';
  $('done-next').textContent = '';

  $('btn-reveal').hidden = true;
  $('rating-row').hidden = true;
  $('done-row').hidden = false;
  $('btn-settings').hidden = true;

  // Every one of these causes is something that can stop being true a moment
  // later — the other copy gets closed, the upgrade finishes. Leaving the only
  // way forward as "know to reload a page inside a Home Screen app" is not
  // much of a way forward.
  const retry = $('btn-again');
  retry.hidden = false;
  retry.textContent = text('boot.retry');
  retry.onclick = () => location.reload();
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

/** Settings is a detour off the end of a round, not a destination. */
async function showSettings() {
  $('practice').hidden = true;
  $('screen-settings').hidden = false;
  await renderSettings();
}

async function hideSettings() {
  $('screen-settings').hidden = true;
  $('practice').hidden = false;
  await renderDone();
}

/** Writing a sentence down, from wherever you are: the thought arrives mid-round. */
async function showCompose() {
  state.resumeTo = $('done-view').hidden ? 'card' : 'done';
  $('practice').hidden = true;
  $('screen-compose').hidden = false;
  await renderOwnSentences();
  $('bank-status').textContent = '';
  $('bank-en').focus();
}

async function hideCompose() {
  $('screen-compose').hidden = true;
  $('practice').hidden = false;
  // A sentence you just wrote is drillable now, not tomorrow — it is exempt
  // from the daily cap — so the round takes it straight away.
  if (state.resumeTo === 'done') await renderDone();
  else if (state.index >= state.queue.length) await renderCard();
}

function toast(message, ms = 2600) {
  const element = $('toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { element.hidden = true; }, ms);
}

const todayCounts = () => session.counts(
  Date.now(), session.NEW_PER_DAY, state.settings.currentLevel,
);

/** Move up a level when the gate is cleared — between rounds, saying so once. */
async function advanceLevelIfPassed() {
  const gate = await levels.progress(state.settings.currentLevel);
  const next = levels.nextLevel(gate.level);
  if (!gate.passed || !next) return;
  state.settings = await db.saveSettings({
    currentLevel: next,
    levelsPassed: [...state.settings.levelsPassed, gate.level],
  });
  toast(`${gate.level} — ${text('today.passedHead')} · ${text('today.nowOn')} ${next}`, 5000);
}

// --- practice --------------------------------------------------------------

function bindPractice() {
  $('btn-reveal').addEventListener('click', reveal);
  $('btn-undo').addEventListener('click', undo);
  $('btn-again').addEventListener('click', startSession);
  $('btn-settings').addEventListener('click', showSettings);
  $('btn-settings-back').addEventListener('click', hideSettings);
  $('btn-compose').addEventListener('click', showCompose);
  $('btn-compose-close').addEventListener('click', hideCompose);
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

    if (key === 'u' || key === 'backspace') return state.last && act(undo);
    if (done) {
      if ((key === ' ' || key === 'enter') && !$('btn-again').hidden) return act(startSession);
      return undefined;
    }
    if (!state.revealed) {
      if (key === ' ' || key === 'enter') return act(reveal);
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
  await advanceLevelIfPassed();

  const counts = await todayCounts();
  const queue = await session.build({
    limit: session.NEW_PER_DAY,
    maxNew: counts.allowance,
    weights: session.DEFAULT_WEIGHTS,
    level: state.settings.currentLevel,
  });

  Object.assign(state, { queue, index: 0, completed: 0, passes: 0, last: null, busy: false });
  $('practice').hidden = false;
  $('screen-settings').hidden = true;
  $('screen-compose').hidden = true;
  // An empty queue is not the end: renderCard tops it up with cards you already
  // know. The done panel is only for a device with nothing on it at all.
  await renderCard();
}

const currentCard = () => state.queue[state.index];

/** How many cards to fetch each time the round needs topping up. */
const EXTRA_BATCH = 20;

/**
 * Keep the round going.
 *
 * The day's plan — due reviews plus the new-card allowance — runs out. Practice
 * should not, so when the queue is spent it is refilled with cards you already
 * know. Only a device with nothing on it at all reaches the end.
 */
async function topUp() {
  const dealt = new Set(state.queue.map(session.cardId));
  let more = await session.extraCards(EXTRA_BATCH, { exclude: dealt });
  if (!more.length && dealt.size) {
    // Everything known has been dealt once this round. Go round again.
    state.queue = state.queue.slice(state.index);
    state.index = 0;
    more = await session.extraCards(EXTRA_BATCH, {
      exclude: new Set(state.queue.map(session.cardId)),
    });
  }
  if (more.length) state.queue.push(...more);
  return more.length > 0;
}

async function renderCard() {
  $('btn-undo').hidden = !state.last;
  if (state.index >= state.queue.length) {
    // Finishing the plan is the moment a cleared level takes effect: it is the
    // only point in an endless round where nothing is half-answered.
    await advanceLevelIfPassed();
    if (!(await topUp())) return renderDone();
  }
  const card = currentCard();
  if (!card) return renderDone();

  state.revealed = false;
  state.shownAt = performance.now();

  $('card-view').hidden = false;
  $('card-view').classList.remove('is-revealed');
  $('done-view').hidden = true;
  $('done-row').hidden = true;
  document.querySelector('.card-scroll').scrollTop = 0;

  // A count, not a fraction: the round has no end to be a fraction of.
  $('practice-progress').textContent = state.completed ? faDigits(state.completed) : '';
  // On a translation card the badge says which way. On a drill it says what to
  // do, which is the whole exercise — the stem alone is not a question.
  const drill = session.isDrill(card.direction);
  $('card-badge').textContent = drill
    ? instruction(card.sentence)
    : text(`dir.${card.direction}`);
  $('card-badge').classList.toggle('is-instruction', drill);

  const prompt = $('card-prompt');
  prompt.textContent = session.promptFor(card.sentence, card.direction);
  prompt.classList.toggle('rtl', drill || card.direction === 'faToEn');

  // What the stem means, so a drill is the grammar and not a vocabulary test —
  // behind a tap when immersive, so the Persian is what you work from.
  peek($('card-stem-en'), drill ? stemHint(card.sentence) : '', 'card.meaning');

  // Typing is the whole app now, so the box is simply always there. It used
  // to be behind a button that reset on every card.
  const typed = $('card-typed');
  typed.value = '';
  typed.hidden = false;
  const wantsFarsi = card.direction !== 'faToEn';
  typed.classList.toggle('rtl', wantsFarsi);
  typed.placeholder = text(
    card.direction === 'reply' ? 'card.typeReply'
      : wantsFarsi ? 'card.typeFarsi' : 'card.typeEnglish',
  );

  $('card-answer').hidden = true;
  $('btn-reveal').hidden = false;
  $('rating-row').hidden = true;
}

/** Show the answer, and what you typed beside it. */
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
  answer.classList.toggle('rtl', card.direction !== 'faToEn');

  renderTypedEcho(card);
  // The echo above the answer now shows what was typed; leaving the box open
  // invites editing an answer after seeing the key.
  $('card-typed').hidden = true;
  peek($('answer-finglish'), card.sentence.finglish ?? '', 'card.pronunciation');
  renderBreakdown(card.sentence);
  // A drill's answer is a sentence you were never shown in English, so say
  // what it means.
  if (session.isDrill(card.direction)) {
    peek($('answer-gloss'), card.sentence.englishText, 'card.meaning');
  }
  $('card-answer').hidden = false;
  $('btn-reveal').hidden = true;

  renderRatings(card);
}

/**
 * Put `full` in `element`, or — when immersive — a small label that turns into
 * it on a tap and back on the next. English and transliteration are crutches;
 * they stay one tap away rather than gone, because sometimes you need one.
 */
function peek(element, full, labelKey) {
  element.hidden = !full;
  element.onclick = null;
  element.classList.remove('is-peek');
  if (!full) {
    element.textContent = '';
    return;
  }
  if (!state.settings.immersive) {
    element.textContent = full;
    return;
  }
  const label = text(labelKey);
  const show = (open) => {
    element.textContent = open ? full : label;
    element.classList.toggle('is-peek', !open);
  };
  show(false);
  element.onclick = () => show(element.textContent === label);
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
  // A reply has many right answers, so a miss is not struck through.
  echo.classList.toggle('is-open', card.direction === 'reply');
  echo.classList.toggle('rtl', card.direction !== 'faToEn');
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

  // Sentences without a word map fall back to the flat gloss.
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

    state.index += 1;
    await renderCard();
  } finally {
    state.busy = false;
  }
}

/** Take back the last rating: schedule, attempt and queue position. */
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
    await renderCard();
    toast(text('card.undone'), 1400);
  } finally {
    state.busy = false;
  }
}

async function renderDone() {
  state.revealed = false;
  $('card-view').hidden = true;
  $('done-view').hidden = false;
  $('btn-undo').hidden = true;
  $('btn-reveal').hidden = true;
  $('rating-row').hidden = true;
  $('done-row').hidden = false;
  $('btn-settings').hidden = false;
  $('practice-progress').textContent = '';
  $('done-view').querySelector('h2').textContent = text('card.done');

  // Distinct cards, not ratings: a card missed twice then passed is one card.
  const cards = new Set(state.queue.map(session.cardId)).size;
  $('done-summary').textContent = state.completed
    ? `${faDigits(cards)} ${text('card.practised')} · ${faDigits(state.passes)}/${faDigits(state.completed)} ${text('today.right')}`
    : '';

  const counts = await todayCounts();
  const more = counts.total > 0;
  const again = $('btn-again');
  again.hidden = !more;
  again.onclick = startSession;
  again.innerHTML = `${escapeHtml(text('card.again'))} &rarr;`;
  $('done-next').textContent = more
    ? `${faDigits(counts.due)} ${text('today.due')} · ${faDigits(counts.new)} ${text('today.new')}`
    : text('card.allDone');
}

// --- settings --------------------------------------------------------------

function bindSettings() {
  $('btn-bank-add').addEventListener('click', addOwnSentence);
  $('bank-fa').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addOwnSentence();
  });

  $('set-immersive').addEventListener('change', async (e) => {
    state.settings = await db.saveSettings({ immersive: e.target.checked });
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
    });
  }
}

async function renderSettings() {
  const s = state.settings;
  $('set-immersive').checked = s.immersive;
  $('set-level').innerHTML = levels.LEVELS
    .map((l) => `<option value="${l}"${l === s.currentLevel ? ' selected' : ''}>${l} — ${escapeHtml(levels.LEVEL_META[l].summary)}</option>`)
    .join('');

  $('backup-report').textContent = s.lastBackupAt
    ? `${text('settings.lastBackup')} ${faDigits(new Date(s.lastBackupAt)
        .toLocaleDateString('fa-IR', { day: 'numeric', month: 'long', year: 'numeric' }))}`
      + ` — ${text('settings.backupReplace')}`
    : text('settings.backupHint');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

boot().catch((error) => {
  bootFailed(error);
  throw error;
});
