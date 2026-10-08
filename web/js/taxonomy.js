// Persian names for the parts of speech shown under a tapped word.
//
// The error-tag and situation vocabularies used to be mirrored here from
// core/taxonomy.py, guarded by tools/check_mirror.py. The app no longer
// displays either — the weak-spots view that ranked tags is gone — so the
// copies were deleted along with the guard. Python keeps the authoritative
// set, where generation and validation actually use it.

export const POS_TITLES = {
  'noun': 'اسم',
  'verb': 'فعل',
  'compound verb': 'فعل مرکب',
  'adjective': 'صفت',
  'adverb': 'قید',
  'pronoun': 'ضمیر',
  'attached pronoun': 'ضمیر متصل',
  'preposition': 'حرف اضافه',
  'conjunction': 'حرف ربط',
  'particle': 'نشانه',
  'number': 'عدد',
  'question word': 'کلمهٔ پرسشی',
  'expression': 'اصطلاح',
};

export function posTitle(pos) {
  return POS_TITLES[pos] ?? pos;
}

// What a drill card asks you to do, in Persian. A transformation has a fixed
// instruction; a swap carries its own cue ("say it with ما"), because the cue
// is the whole exercise. The sets themselves live in core/taxonomy.py.
export const TRANSFORM_TITLES = {
  negate: 'منفی‌ش کن',
  toPast: 'بذارش گذشته',
  toFormal: 'به شما بگو',
  toPlural: 'جمعش کن',
};

/** The Persian line over a drill card. */
export function instruction(sentence) {
  return sentence.cue
    ? `با «${sentence.cue}» بگو`
    : TRANSFORM_TITLES[sentence.transform] ?? sentence.transform;
}

/**
 * The English under a drill's sentence: what the stem means, and on a swap what
 * the cue means, so the exercise is the grammar rather than a vocabulary test.
 */
export function stemHint(sentence) {
  const meaning = sentence.stemEn ?? '';
  return sentence.cueEn ? `${meaning}  →  ${sentence.cueEn}` : meaning;
}
