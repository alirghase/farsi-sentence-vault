// The knowledge base: data/kb.json turned into cards, dealt, searched and
// linked to the deck.
//
// One file holds both the reference screen and the word and form cards, so a
// verb's table on the reference screen and the card that drills it are the
// same row and cannot disagree. Everything here is pure — no DOM, no
// IndexedDB — so the tests can run it.

const ZWNJ = '‌';

/**
 * Every card the knowledge base deals.
 *
 * A word is one card, English to Persian. A form card is one tense of one verb,
 * or one pronoun table: its six cells live on the row and a person is picked
 * each time it is dealt (see dealForm), so the scheduler tracks "the past of
 * رفتن" and the ending varies.
 *
 * farsiText on a form row is a label, never an answer: the device matches rows
 * and backups by it, so it has to be unique, and dealForm replaces it with the
 * real answer on the card in hand.
 */
export function cardsFromKb(kb) {
  if (!kb) return [];
  const persons = kb.persons ?? [];
  const tenses = new Map((kb.tenses ?? []).map((t) => [t.key, t]));
  const withPerson = (forms) => forms.map((f) => ({
    ...f, who: persons[f.p]?.fa ?? '', whoEn: persons[f.p]?.en ?? '',
  }));

  const words = (kb.topics ?? []).flatMap((topic) => topic.words.map((w) => ({
    id: w.id,
    kind: 'word',
    farsiText: w.fa,
    englishText: w.en,
    finglish: w.tr,
    literalGloss: w.note ?? '',
    alternatives: w.alt ?? [],
    difficulty: w.level,
    // Core words first among new cards, as core sentences are.
    core: w.core ? 1 : 0.5,
    pos: w.pos,
    topic: topic.id,
  })));

  const verbs = (kb.verbs ?? []).flatMap((verb) => verb.tenses
    .filter((t) => t.id)
    .map((t) => {
      const meta = tenses.get(t.key) ?? {};
      return {
        id: t.id,
        kind: 'form',
        family: 'verb',
        lemma: verb.inf,
        lemmaEn: verb.en,
        label: meta.fa ?? t.key,
        labelEn: meta.en ?? t.key,
        forms: withPerson(t.forms),
        farsiText: `${verb.inf} · ${meta.fa ?? t.key}`,
        englishText: `${verb.en} · ${meta.en ?? t.key}`,
        finglish: '',
        difficulty: Math.max(verb.level, meta.level ?? 1),
        core: verb.core ? 1 : 0.5,
      };
    }));

  const pronouns = (kb.pronouns ?? []).map((table) => ({
    id: table.cardId,
    kind: 'form',
    family: 'pronoun',
    lemma: table.lemma,
    lemmaEn: table.lemmaEn,
    label: table.label,
    labelEn: table.labelEn,
    forms: withPerson(table.forms),
    farsiText: `${table.lemma} · ${table.label}`,
    englishText: `${table.lemmaEn} · ${table.labelEn}`,
    finglish: '',
    difficulty: table.level,
    core: 1,
  }));

  return [...words, ...verbs, ...pronouns];
}

/**
 * Other ways of typing a form that are just as right: with the subject pronoun
 * in front (the answer check forgives من, ما and شما on its own, not the
 * others), and for شما the polite ـید many speakers use where Tehran says ـین.
 */
export function formAlternatives(form) {
  const out = [...(form.alt ?? [])];
  if (form.who) out.push(`${form.who} ${form.fa}`);
  if (form.p === 4 && /ین(?=\s|$)/.test(form.fa)) {
    const polite = form.fa.replace(/ین(?=\s|$)/g, 'ید');
    out.push(polite, `${form.who} ${polite}`);
  }
  return [...new Set(out)];
}

/**
 * The card in hand for a form row: one person picked, and the prompt, answer
 * and English for that person.
 *
 * The id stays the row's, so the review key — and with it the schedule — is
 * the tense's, not the person's. A miss brought back later in the round
 * brings back the same card object, so the same person: you missed that one.
 */
export function dealForm(row, pick = Math.random) {
  const forms = row.forms ?? [];
  if (!forms.length) return row;
  const form = forms[Math.min(forms.length - 1, Math.floor(pick() * forms.length))];
  const verb = row.family === 'verb';
  return {
    ...row,
    person: form.p,
    stem: verb ? `${form.who} · ${row.lemma}` : `${row.lemma} + ${form.who}`,
    stemEn: verb
      ? `${form.whoEn} · ${row.lemmaEn} → ${row.labelEn}`
      : `${row.labelEn} → ${form.en}`,
    farsiText: form.fa,
    finglish: form.tr,
    englishText: form.en,
    literalGloss: '',
    alternatives: formAlternatives(form),
  };
}

// --- search and lookup ---------------------------------------------------------

/**
 * Fold what a phone keyboard and a transliteration vary: Arabic letter forms,
 * half-spaces, case, the circumflex on â, apostrophes.
 */
export function fold(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ي|ى/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[ً-ْٰ]/g, '')
    .replace(new RegExp(ZWNJ, 'g'), '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’‘]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every Persian form of a verb, across every tense. */
export function verbForms(verb) {
  return verb.tenses.flatMap((t) => t.forms.map((f) => f.fa));
}

/**
 * Search across words, verbs (including every conjugated form, so typing
 * رفتم finds رفتن), pronoun tables and notes. Persian, English or
 * transliteration.
 */
export function search(kb, query, limit = 40) {
  const q = fold(query);
  if (!q) return { words: [], verbs: [], pronouns: [], notes: [] };
  const hit = (...fields) => fields.some((f) => fold(f).includes(q));

  const words = [];
  for (const topic of kb.topics ?? []) {
    for (const w of topic.words) {
      if (hit(w.fa, w.en, w.tr, ...(w.alt ?? []))) words.push({ ...w, topic: topic.id });
    }
  }
  // Exact matches first: "in" should find این before "inside".
  const exact = (w) => [w.fa, w.en, w.tr].some((f) => fold(f) === q);
  words.sort((a, b) => exact(b) - exact(a));

  const verbs = (kb.verbs ?? []).filter((v) =>
    hit(v.inf, v.en, v.tr) || verbForms(v).some((f) => fold(f) === q));
  const pronouns = (kb.pronouns ?? []).filter((t) =>
    hit(t.lemma, t.label, t.labelEn) || t.forms.some((f) => fold(f.fa) === q || fold(f.en).includes(q)));
  const notes = (kb.notes ?? []).filter((n) => hit(n.title, n.titleEn));
  return { words: words.slice(0, limit), verbs: verbs.slice(0, limit), pronouns, notes };
}

// Endings a word can carry in a sentence: possessives, the copula, plurals,
// the object marker. Peeled off to find the word a chip or a token is.
const ENDINGS = ['شون', 'تون', 'مون', 'هام', 'هات', 'هاش', 'ها', 'ام', 'ات', 'اش', 'ست',
  'رو', 'م', 'ت', 'ش', 'ه', 'ی', 'ا', 'و', 'ن'];

/**
 * An index from a Persian form to its entry, for the word map's "look it up".
 * Verb forms map to their verb; words and pronoun forms to themselves.
 */
export function buildIndex(kb) {
  const index = new Map();
  const add = (fa, entry) => {
    const key = fold(fa);
    if (key && !index.has(key)) index.set(key, entry);
  };
  for (const topic of kb.topics ?? []) {
    for (const w of topic.words) add(w.fa, { type: 'word', id: w.id });
  }
  for (const v of kb.verbs ?? []) {
    add(v.inf, { type: 'verb', id: v.inf });
    for (const f of verbForms(v)) add(f, { type: 'verb', id: v.inf });
  }
  for (const t of kb.pronouns ?? []) {
    for (const f of t.forms) add(f.fa, { type: 'pronoun', id: t.id });
  }
  return index;
}

/** The entry a word in a sentence belongs to, or null. */
export function lookup(index, fa) {
  const key = fold(fa).replace(/[؟?!.،,]/g, '');
  if (index.has(key)) return index.get(key);
  for (const ending of ENDINGS) {
    if (key.length > ending.length + 1 && key.endsWith(ending)) {
      const hit = index.get(key.slice(0, -ending.length));
      if (hit?.type === 'word') return hit;
    }
  }
  return null;
}

/**
 * Sentences that use an entry, from the deck on the device — your own
 * sentences included. A word matches with any ending (کتابم, کتابا); a verb
 * matches any of its forms; a phrase matches as written.
 */
export function examples(sentences, { word = null, verb = null }, limit = 5) {
  const pad = (text) => ` ${fold(text).replace(/[؟?!.،,:؛«»"]/g, ' ').replace(/\s+/g, ' ')} `;
  let test;
  if (word) {
    const base = fold(word.fa);
    const forms = new Set([base, ...ENDINGS.map((e) => base + e)]);
    test = base.includes(' ')
      ? (text) => pad(text).includes(` ${base} `)
      : (text) => pad(text).split(' ').some((t) => forms.has(t));
  } else if (verb) {
    const forms = [...new Set(verbForms(verb).map((f) => ` ${fold(f)} `))];
    test = (text) => {
      const padded = pad(text);
      return forms.some((f) => padded.includes(f));
    };
  } else {
    return [];
  }
  const out = [];
  for (const s of sentences) {
    if ((s.kind ?? 'sentence') !== 'sentence') continue;
    if (test(s.farsiText)) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
