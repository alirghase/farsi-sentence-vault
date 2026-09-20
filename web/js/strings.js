// Interface text.
//
// The chrome is Persian so the words you read hundreds of times a week are
// themselves repetitions. Numbers stay in Latin digits: the ledger screens are
// meant to be read at a glance, and decoding ۳۸۱ to learn how many sentences
// you hold works against that.
//
// One module rather than Persian scattered through the markup, so the whole
// interface vocabulary can be reviewed — and corrected by a native speaker — in
// one place.

export const STRINGS = {
  // Tabs and screen titles
  'tab.today': 'امروز',
  'tab.progress': 'پیشرفت',
  'tab.settings': 'تنظیمات',

  // Today
  'today.due': 'مرور',
  'today.new': 'جدید',
  'today.target': 'هدف امروز',
  'today.held': 'جمله‌ها',
  'today.level': 'سطح',
  'today.streak': 'پیاپی',
  'today.start': 'شروع',
  'today.nothing': 'چیزی نمونده',
  'today.empty': 'هنوز جمله‌ای نیست.',
  'today.day': 'روز',
  'today.session': 'جلسه',
  'today.cards': 'کارت',
  'today.right': 'درست',

  // Practice
  'card.exit': 'خروج',
  'card.reveal': 'جواب',
  'card.type': 'تایپ',
  'card.play': 'پخش',
  'card.alsoCorrect': 'این هم درسته',
  'card.tapWord': 'روی هر کلمه بزن',
  'card.unit': 'این کلمه‌ها با هم یک واحدن',
  'card.done': 'تموم شد',
  'card.practised': 'کارت تمرین شد',

  // Progress
  'progress.weakSpots': 'نقاط ضعف',
  'progress.feature': 'ویژگی',
  'progress.wrong': 'غلط',
  'progress.rate': 'نسبت',
  'progress.seen': 'کارت‌های دیده‌شده',
  'progress.accuracy': 'دقت',
  'progress.retained': 'کارت‌های مونده',
  'progress.empty': 'تمرین کن تا ضعف‌هات اینجا بیاد.',

  // Settings
  'settings.practice': 'تمرین',
  'settings.audio': 'صدا',
  'settings.level': 'سطح',
  'settings.dailyTarget': 'هدف روزانه',
  'settings.sound': 'صدا موقع رد شدن',
  'settings.currentLevel': 'سطح فعلی',

  // Results
};

/**
 * Western digits to Persian ones (۰۱۲۳۴۵۶۷۸۹).
 *
 * Applied to every figure in the app. Scanning ۷۷۸ is slower than 778 until the
 * numerals become automatic — which is the point: reading Persian digits is a
 * skill most heritage speakers never pick up, and the ledger is a low-stakes
 * place to acquire it.
 */
export function faDigits(value) {
  return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

export function t(key) {
  return STRINGS[key] ?? key;
}

/**
 * Replace the text of anything carrying data-t with its Persian.
 *
 * Deliberately no dir attribute. An isolated Persian word renders correctly
 * inside a left-to-right box — the bidi algorithm handles the word itself —
 * whereas dir="auto" flips the whole row and puts the figures on the left,
 * inverting the ledger's shared right edge.
 */
export function applyStrings(root = document) {
  for (const element of root.querySelectorAll('[data-t]')) {
    const value = STRINGS[element.dataset.t];
    if (value) element.textContent = value;
  }
}
