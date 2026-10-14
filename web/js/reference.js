// The reference screen (مرجع): the knowledge base to read, search and drill.
//
// A stack of views — the contents, a topic, a verb, a pronoun table, a note —
// over one search box. Every view that holds cards ends in «تمرینش کن», which
// hands the card ids to the practice screen for a round of just those; the
// tables here and the cards it drills are the same rows of data/kb.json.

import * as db from './db.js';
import { loadKb } from './deck.js';
import { search, buildIndex, examples } from './kb.js';
import { levelForDifficulty } from './levels.js';
import { posTitle } from './taxonomy.js';
import { t as text, faDigits } from './strings.js';

const $ = (id) => document.getElementById(id);

const ref = {
  kb: null,
  index: null,
  wordsById: null,
  // The deck on the device, for examples. Read when the screen opens, so a
  // sentence you just wrote is one of them.
  sentences: [],
  stack: [],
  onPractise: null,
  onClose: null,
  glossed: null,
};

export function bind({ onPractise, onClose, glossed }) {
  ref.onPractise = onPractise;
  ref.onClose = onClose;
  // Example sentences get the same hover glosses as a card.
  ref.glossed = glossed;
  $('btn-kb-back').addEventListener('click', back);
  $('kb-q').addEventListener('input', () => render());
  $('kb-body').addEventListener('click', (event) => {
    const go = event.target.closest('[data-go]');
    if (go) {
      const [type, ...id] = go.dataset.go.split(':');
      push({ type, id: id.join(':') });
      return;
    }
    const practise = event.target.closest('[data-practise]');
    if (practise) ref.onPractise?.(practise.dataset.practise.split(','));
  });
}

/** The knowledge base and its lookup index, loaded once. */
export async function ready() {
  if (!ref.kb) {
    ref.kb = await loadKb();
    if (!ref.kb) return null;
    ref.index = buildIndex(ref.kb);
    ref.wordsById = new Map(ref.kb.topics.flatMap((topic) =>
      topic.words.map((w) => [w.id, { ...w, topic: topic.id }])));
  }
  return ref.kb;
}

/** The lookup index, for the word map; null until the knowledge base is in. */
export const index = () => ref.index;

/**
 * Open the screen at the contents, or straight at one entry ({type, id}, as
 * lookup() returns them) — which is how a word on a card gets here.
 */
export async function open(target = null) {
  $('screen-kb').hidden = false;
  $('kb-q').value = '';
  ref.stack = [{ type: 'home' }];
  if (target) ref.stack.push(target);
  if (!(await ready())) {
    $('kb-body').innerHTML = `<p class="hint kb-pad">${esc(text('kb.notLoaded'))}</p>`;
    return;
  }
  ref.sentences = await db.getAll(db.STORE.sentences);
  render();
}

export function close() {
  $('screen-kb').hidden = true;
}

function push(view) {
  $('kb-q').value = '';
  ref.stack.push(view);
  render();
}

function back() {
  if ($('kb-q').value) {
    $('kb-q').value = '';
    render();
  } else if (ref.stack.length > 1) {
    ref.stack.pop();
    render();
  } else {
    close();
    ref.onClose?.();
  }
}

function render() {
  if (!ref.kb) return;
  const query = $('kb-q').value.trim();
  const view = ref.stack[ref.stack.length - 1];
  const html = query ? renderSearch(query) : (VIEWS[view.type] ?? VIEWS.home)(view.id);
  $('kb-body').innerHTML = html;
  $('kb-body').scrollTop = 0;
  $('kb-title').textContent = query || view.type === 'home' ? text('tab.kb') : titleOf(view);
}

function titleOf(view) {
  const kb = ref.kb;
  switch (view.type) {
    case 'topic': return kb.topics.find((t) => t.id === view.id)?.fa ?? '';
    case 'word': return ref.wordsById.get(view.id)?.fa ?? '';
    case 'verbs': return text('kb.verbs');
    case 'verb': return view.id;
    case 'pronouns': return text('kb.pronouns');
    case 'pronoun': return kb.pronouns.find((t) => t.id === view.id)?.label ?? '';
    case 'notes': return text('kb.notes');
    case 'note': return kb.notes.find((n) => n.id === view.id)?.title ?? '';
    case 'topics': return text('kb.words');
    default: return text('tab.kb');
  }
}

// --- views -----------------------------------------------------------------

const VIEWS = {
  home() {
    const kb = ref.kb;
    const words = kb.topics.reduce((n, t) => n + t.words.length, 0);
    return ledger([
      row('topics:', text('kb.words'), faDigits(words)),
      row('verbs:', text('kb.verbs'), faDigits(kb.verbs.length)),
      row('pronouns:', text('kb.pronouns'), faDigits(kb.pronouns.length)),
      row('notes:', text('kb.notes'), faDigits(kb.notes.length)),
    ]);
  },

  topics() {
    return ledger(ref.kb.topics.map((t) =>
      row(`topic:${t.id}`, t.fa, faDigits(t.words.length), t.en)));
  },

  topic(id) {
    const topic = ref.kb.topics.find((t) => t.id === id);
    if (!topic) return '';
    return head(topic.en, topic.words.map((w) => w.id)) + wordList(topic.words);
  },

  word(id) {
    const w = ref.wordsById.get(id);
    if (!w) return '';
    const facts = [
      `<p class="kb-big rtl">${esc(w.fa)}</p>`,
      `<p class="kb-tr">${esc(w.tr)}</p>`,
      `<p class="kb-en">${esc(w.en)}</p>`,
      `<p class="hint">${esc(posTitle(w.pos))} · ${levelForDifficulty(w.level)}${w.core ? ` · ${esc(text('kb.core'))}` : ''}</p>`,
      w.note ? `<p class="kb-note">${esc(w.note)}</p>` : '',
      w.alt?.length ? `<p class="hint">${esc(text('kb.alsoSaid'))}: <span class="rtl">${w.alt.map(esc).join('، ')}</span></p>` : '',
    ].join('');
    return `<div class="kb-pad">${facts}${practise([w.id])}</div>`
      + exampleList(examples(ref.sentences, { word: w }));
  },

  verbs() {
    // Core verbs first: the ones nearly every sentence needs.
    const verbs = [...ref.kb.verbs].sort((a, b) => (b.core - a.core) || (a.level - b.level));
    return ledger(verbs.map((v) =>
      row(`verb:${v.inf}`, v.inf, levelForDifficulty(v.level), v.en)));
  },

  verb(inf) {
    const kb = ref.kb;
    const verb = kb.verbs.find((v) => v.inf === inf);
    if (!verb) return '';
    const labels = new Map(kb.tenses.map((t) => [t.key, t]));
    const stems = verb.compound
      ? `${esc(text('kb.compound'))}: ${esc(verb.compound.nominal)} + <a data-go="verb:${esc(verb.compound.light)}">${esc(verb.compound.light)}</a>`
      : `${esc(text('kb.pastStem'))} <b>${esc(verb.stems.past)}</b> · ${esc(text('kb.presStem'))} <b>${esc(verb.stems.pres)}</b>`;
    const ids = verb.tenses.filter((t) => t.id).map((t) => t.id);
    const tables = verb.tenses.map((tense) => {
      const meta = labels.get(tense.key) ?? {};
      return `<h3 class="kb-h">${esc(meta.fa ?? tense.key)} <small>${esc(meta.en ?? '')}</small></h3>`
        + formTable(tense.forms);
    }).join('');
    return `<div class="kb-pad">
        <p class="kb-tr">${esc(verb.tr)} · <span class="kb-en">${esc(verb.en)}</span></p>
        <p class="hint">${stems} · ${levelForDifficulty(verb.level)}</p>
        ${practise(ids)}
      </div>`
      + exampleList(examples(ref.sentences, { verb }))
      + `<div class="kb-pad">${tables}</div>`;
  },

  pronouns() {
    return ledger(ref.kb.pronouns.map((p) =>
      row(`pronoun:${p.id}`, p.label, levelForDifficulty(p.level), p.labelEn)));
  },

  pronoun(id) {
    const table = ref.kb.pronouns.find((p) => p.id === id);
    if (!table) return '';
    return `<div class="kb-pad">
        <p class="kb-en">${esc(table.labelEn)}</p>
        <p class="hint">${esc(table.lemma)} · ${esc(table.lemmaEn)}</p>
        ${practise([table.cardId])}
        ${formTable(table.forms)}
      </div>`;
  },

  notes() {
    return ledger(ref.kb.notes.map((n) => row(`note:${n.id}`, n.title, '', n.titleEn)));
  },

  note(id) {
    const note = ref.kb.notes.find((n) => n.id === id);
    // Rendered from kb/notes at build time, every character escaped there.
    return note ? `<p class="kb-pad kb-en">${esc(note.titleEn)}</p><div class="kb-pad kb-prose">${note.html}</div>` : '';
  },
};

function renderSearch(query) {
  const found = search(ref.kb, query);
  const parts = [];
  if (found.words.length) {
    parts.push(section(text('kb.words'), wordList(found.words)));
  }
  if (found.verbs.length) {
    parts.push(section(text('kb.verbs'), ledger(found.verbs.map((v) =>
      row(`verb:${v.inf}`, v.inf, levelForDifficulty(v.level), v.en)))));
  }
  if (found.pronouns.length) {
    parts.push(section(text('kb.pronouns'), ledger(found.pronouns.map((p) =>
      row(`pronoun:${p.id}`, p.label, '', p.labelEn)))));
  }
  if (found.notes.length) {
    parts.push(section(text('kb.notes'), ledger(found.notes.map((n) =>
      row(`note:${n.id}`, n.title, '', n.titleEn)))));
  }
  return parts.join('') || `<p class="hint kb-pad">${esc(text('kb.nothing'))}</p>`;
}

// --- pieces ----------------------------------------------------------------

function ledger(rows) {
  return `<div class="ledger kb-ledger">${rows.join('')}</div>`;
}

/** One row: Persian on the reading edge, English beneath, a figure opposite. */
function row(go, fa, figure, en = '') {
  return `<button class="ledger-row kb-row" data-go="${esc(go)}">
      <span><span class="kb-fa">${esc(fa)}</span>${en ? `<span class="kb-sub">${esc(en)}</span>` : ''}</span>
      <b>${esc(figure)}</b>
    </button>`;
}

function wordList(words) {
  return ledger(words.map((w) => `<button class="ledger-row kb-row" data-go="word:${esc(w.id)}">
      <span><span class="kb-fa">${esc(w.fa)}</span><span class="kb-sub kb-mono">${esc(w.tr)}</span></span>
      <em class="kb-gloss">${esc(w.en)}</em>
    </button>`));
}

function formTable(forms) {
  const persons = ref.kb.persons;
  return `<table class="kb-table"><tbody>${forms.map((f) => `<tr>
      <td class="kb-who">${esc(persons[f.p]?.fa ?? '')}</td>
      <td class="kb-form">${esc(f.fa)}</td>
      <td class="kb-cell-en"><span class="kb-mono">${esc(f.tr)}</span><span>${esc(f.en)}</span></td>
    </tr>`).join('')}</tbody></table>`;
}

function exampleList(sentences) {
  const body = sentences.length
    ? sentences.map((s) => `<div class="kb-example">
        <p class="rtl kb-ex-fa">${ref.glossed ? ref.glossed(s.farsiText) : esc(s.farsiText)}</p>
        <p class="kb-sub">${esc(s.englishText)}</p>
      </div>`).join('')
    : `<p class="hint">${esc(text('kb.noExamples'))}</p>`;
  return `<div class="kb-pad kb-examples">${section(text('kb.examples'), body)}</div>`;
}

function section(title, body) {
  return `<h2 class="kb-section">${esc(title)}</h2>${body}`;
}

function head(en, ids) {
  return `<div class="kb-pad"><p class="kb-en">${esc(en)}</p>${practise(ids)}</div>`;
}

function practise(ids) {
  return ids.length
    ? `<button class="kb-practise" data-practise="${esc(ids.join(','))}">${esc(text('kb.practise'))} &larr;</button>`
    : '';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
