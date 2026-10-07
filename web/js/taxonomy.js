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

// Persian labels for the transformation drills. The set itself lives in
// core/taxonomy.py, which is what generation and validation use; these are the
// four words shown on the card.
export const TRANSFORM_TITLES = {
  negate: 'منفی‌ش کن',
  toPast: 'بذارش گذشته',
  toFormal: 'به شما بگو',
  toPlural: 'جمعش کن',
};

export const transformTitle = (key) => TRANSFORM_TITLES[key] ?? key;
