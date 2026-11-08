// The English of a Persian word, one hover (or tap) away.
//
// The screen stays Persian; a word you do not know shows its meaning only
// while you point at it. The meanings come from what the app already has: the
// word map of the sentence on screen when there is one, then the word maps of
// the whole deck (the gloss a word is given most often), then the knowledge
// base — every word, every conjugated form, every pronoun form.
//
// Pure, like kb.js: no DOM, so the tests can run it.

import { fold, ENDINGS } from './kb.js';

// The longest phrase looked up as one unit: بلند می‌شه, یه کم, چی کار.
const MAX_WORDS = 4;

// Split into words and the gaps between them, keeping both, so the text can be
// put back together exactly. Punctuation is a gap: a phrase does not run
// across a comma.
const PIECES = /[^\s؟?!.،,:;؛«»"()·+]+|[\s؟?!.،,:;؛«»"()·+]+/g;
const isWord = (piece) => !/^[\s؟?!.،,:;؛«»"()·+]+$/.test(piece);

/**
 * Every Persian word and phrase the app can gloss, keyed by its folded form.
 * `sentences` are deck rows (with `breakdown`); `kb` is data/kb.json.
 */
export function buildGlossary(sentences, kb = null) {
  const votes = new Map();
  for (const s of sentences ?? []) {
    for (const unit of s.breakdown ?? []) {
      const key = fold(unit.fa);
      if (!key || !unit.en) continue;
      if (!votes.has(key)) votes.set(key, new Map());
      const forKey = votes.get(key);
      forKey.set(unit.en, (forKey.get(unit.en) ?? 0) + 1);
    }
  }
  const glossary = new Map();
  for (const [key, counts] of votes) {
    const [en] = [...counts].sort((a, b) => b[1] - a[1])[0];
    glossary.set(key, en);
  }
  // The knowledge base fills what no word map covers. Its glosses are
  // dictionary ones and its conjugations exact ("we went"), so they are a
  // good fallback, not a better first choice than the deck's own word maps.
  const add = (fa, en) => {
    const key = fold(fa);
    if (key && en && !glossary.has(key)) glossary.set(key, en);
  };
  for (const topic of kb?.topics ?? []) {
    for (const w of topic.words) add(w.fa, w.en);
  }
  for (const verb of kb?.verbs ?? []) {
    add(verb.inf, verb.en);
    for (const tense of verb.tenses) for (const f of tense.forms) add(f.fa, f.en);
  }
  for (const table of kb?.pronouns ?? []) {
    for (const f of table.forms) add(f.fa, f.en);
  }
  return glossary;
}

/** The gloss of one word, peeling an ending (کتابام → کتاب) if it has to. */
function wordGloss(glossary, word) {
  const key = fold(word);
  if (glossary.has(key)) return glossary.get(key);
  for (const ending of ENDINGS) {
    if (key.length > ending.length + 1 && key.endsWith(ending)) {
      const base = glossary.get(key.slice(0, -ending.length));
      if (base) return base;
    }
  }
  return null;
}

/**
 * Persian text cut into pieces, each a word or phrase with its English (`en`)
 * or a gap without. Joined back together, the pieces are the text.
 *
 * `units` is the word map of this exact text, when it has one: its own split
 * and its own glosses beat anything guessed from the rest of the deck.
 */
export function segment(text, glossary, units = null) {
  const source = String(text ?? '');
  const own = units?.length ? fromUnits(source, units) : null;
  if (own) return own;
  const pieces = source.match(PIECES) ?? [];
  const out = [];
  for (let i = 0; i < pieces.length;) {
    if (!isWord(pieces[i])) {
      out.push({ text: pieces[i] });
      i += 1;
      continue;
    }
    // Longest phrase first: a phrase is words separated only by spaces.
    let taken = null;
    for (let n = MAX_WORDS; n >= 2 && !taken; n--) {
      const end = i + 2 * (n - 1);
      if (end >= pieces.length) continue;
      const span = pieces.slice(i, end + 1);
      if (span.some((p, k) => (k % 2 ? !/^\s+$/.test(p) : !isWord(p)))) continue;
      const en = glossary.get(fold(span.join(' ')));
      if (en) taken = { text: span.join(''), en, length: span.length };
    }
    if (taken) {
      out.push({ text: taken.text, en: taken.en });
      i += taken.length;
    } else {
      const en = wordGloss(glossary, pieces[i]);
      out.push(en ? { text: pieces[i], en } : { text: pieces[i] });
      i += 1;
    }
  }
  return out;
}

/**
 * The text cut along its own word map, each unit glossed as the map says; null
 * when the map is not of these exact letters, or leaves a word out.
 */
function fromUnits(text, units) {
  const out = [];
  let rest = text;
  const gap = (piece) => {
    if (!piece) return true;
    if (isWord(piece) || /[^\s؟?!.،,:;؛«»"()·+]/.test(piece)) return false;
    out.push({ text: piece });
    return true;
  };
  for (const unit of units) {
    const fa = unit.fa.trim();
    const at = rest.indexOf(fa);
    if (!fa || at < 0 || !gap(rest.slice(0, at))) return null;
    out.push({ text: fa, en: unit.en });
    rest = rest.slice(at + fa.length);
  }
  return gap(rest) ? out : null;
}
