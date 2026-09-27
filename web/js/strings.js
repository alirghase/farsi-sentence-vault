// Interface text.
//
// The chrome is Persian so the words you read hundreds of times a week are
// themselves repetitions. Figures go through faDigits below for the same
// reason.
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
  'card.again': 'یه دور دیگه',
  'card.allDone': 'برای امروز همه‌ش تموم شد.',
  'card.undo': 'برگرد',
  'card.undone': 'لغو شد',

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
  'settings.backup': 'پشتیبان',

  // Settings — practice
  'settings.newPerDay': 'کارت جدید در روز',
  'settings.newPerDayHint': 'هر کارت جدید هفته‌ها مرور می‌سازه، پس این بیشتر بارِ فرداست تا امروز. فقط وقتی ببرش بالا که مرورها دارن تموم می‌شن.',
  'settings.perRound': 'کارت در هر دور',
  'settings.perRoundHint': 'هر دور یعنی یه بار زدنِ شروع. وقتی تموم شد می‌تونی همون‌جا دوباره بری.',
  'settings.dailyTargetHint': 'چند کارت در روز یعنی تموم. هدفی که بیشتر روزها بهش می‌رسی عادت می‌سازه؛ هدفی که ازش جا می‌مونی عادت رو خراب می‌کنه.',
  'settings.levelHint': 'کارت جدید فقط از این سطح میاد؛ مرور از همه‌جا. معمولاً وقتی از دروازهٔ پیشرفت رد بشی خودش جلو می‌ره — دستی عوضش کن اگه نمی‌خوای صبر کنی، یا می‌خوای برگردی عقب.',

  // Settings — audio
  'settings.speak': 'خوندن جواب با صدا',
  'settings.voiceChecking': 'دنبال صدای فارسی…',
  'settings.voiceFound': 'صدای فارسی هست:',
  'settings.voiceMissing': 'صدای فارسی روی این دستگاه نیست',
  'settings.voiceHow': 'از Settings → Accessibility → Spoken Content → Voices → Farsi اضافه‌ش کن، بعد برنامه رو دوباره باز کن.',

  // Settings — backup
  'settings.exportBackup': 'ذخیرهٔ پشتیبان',
  'settings.importBackup': 'بازگردانی…',
  'settings.backupHint': 'برنامهٔ مرور و تاریخچه‌ات فقط توی همین مرورگره، و iOS می‌تونه پاکش کنه. هر از گاهی یه پشتیبان توی Files ذخیره کن؛ بازگردانی چیزی رو که اینجاست جایگزین می‌کنه.',
  'settings.backupSaved': 'پشتیبان ذخیره شد',
  'settings.backupRestored': 'بازگردانی شد',
  'settings.backupFailed': 'این فایل خونده نشد.',
  'settings.scheduled': 'کارت زمان‌بندی‌شده',
  'settings.reviews': 'مرور',

  // Settings — keyboard and privacy
  'settings.keyboard': 'صفحه‌کلید',
  'settings.keyboardHint': 'فاصله جواب · ۱ غلط · ۲ درست · T تایپ · P پخش · U برگرد · Esc خروج. موقع تایپ، Enter جواب رو نشون می‌ده.',
  'settings.privacy': 'چی از این دستگاه بیرون می‌ره',
  'settings.privacyHint': 'هیچی. نه سروری هست نه حسابی. هر جمله، هر نمره و کل برنامهٔ مرور توی همین مرورگر می‌مونه، و پشتیبان فقط جایی می‌ره که خودت می‌فرستیش.',
  'settings.levelNow': 'کارت‌های جدید حالا از این سطح میان:',

  // Card
  'card.typeFarsi': 'بنویس…',
  'card.typeEnglish': 'انگلیسی‌شو بنویس…',

  // Today and progress
  'today.unlock': 'باز کردن',
  'progress.passed': 'قبول شدی — سطح بعدی رو از امروز باز کن.',
  'progress.gateHint': 'هر سه تا باید برسن. دیده‌شده: کارت‌های متمایز این سطح. دقت: مرورهای اخیر همین‌جا. مونده: کارت‌هایی که حالا چند روز فاصله دارن — همونی که نمی‌ذاره سطحی رو با حفظ‌کردن رد کنی.',
  'progress.tagNote': 'هر ویژگی‌ای که توی یه جملهٔ غلط بوده شمرده می‌شه، پس این رو جای تجمع خطا بخون، نه تشخیص قطعی.',
  'progress.tagNeed': 'نسبت‌ها وقتی میان که یه ویژگی چند بار اومده باشه.',


  // Card badge and directions
  'dir.enToFa': 'انگلیسی ← فارسی',
  'dir.faToEn': 'فارسی ← انگلیسی',
  'card.newBadge': 'جدید',
  'card.lapse': 'لغزش',

  // Level panel
  'today.passedHead': 'رد شدی',
  'today.passedNote': 'سطح‌های قبلی سر وقت خودشون برمی‌گردن.',
  'today.nowOn': 'حالا روی سطح',

  // Backup detail
  'settings.lastBackup': 'آخرین پشتیبان',
  'settings.backupReplace': 'بازگردانی چیزی رو که روی این دستگاهه جایگزین می‌کنه.',
  'settings.unknownDate': 'تاریخ نامشخص',
  'settings.confirmRestore': 'پیشرفت این دستگاه با پشتیبانِ این تاریخ جایگزین بشه؟',
  'settings.notBackup': 'این فایل پشتیبانِ این برنامه نیست.',
  'settings.newerBackup': 'این پشتیبان مال نسخهٔ جدیدتریه.',
  'settings.goneFromDeck': 'دیگه توی بسته نیستن',


  // Your own sentences
  'bank.title': 'جمله‌های خودم',
  'bank.english': 'انگلیسی',
  'bank.farsi': 'فارسی',
  'bank.finglish': 'تلفظ (اختیاری)',
  'bank.add': 'اضافه کن',
  'bank.hint': 'هر جمله‌ای که اضافه کنی مثل بقیه وارد مرور می‌شه، با به‌روز شدن بسته پاک نمی‌شه و توی پشتیبان هم میاد.',
  'bank.none': 'هنوز جمله‌ای اضافه نکردی.',
  'bank.count': 'جملهٔ خودت',
  'bank.added': 'اضافه شد',
  'bank.removed': 'پاک شد',
  'bank.remove': 'پاک کردن',
  'bank.errEmpty': 'هر دو طرف رو بنویس.',
  'bank.errPersian': 'طرف فارسی باید فارسی باشه.',
  'bank.errDuplicate': 'این جمله از قبل هست.',

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
