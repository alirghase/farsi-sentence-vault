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
  // The card
  'card.reveal': 'جواب',
  'card.typeFarsi': 'بنویس…',
  'card.typeEnglish': 'انگلیسی‌شو بنویس…',
  'card.alsoCorrect': 'این هم درسته',
  'card.unit': 'این کلمه‌ها با هم یک واحدن',
  'card.undo': 'برگرد',
  'card.undone': 'لغو شد',
  'dir.enToFa': 'انگلیسی ← فارسی',
  'dir.faToEn': 'فارسی ← انگلیسی',
  'dir.word': 'کلمه',

  // End of a round
  'card.done': 'تموم شد',
  'card.practised': 'کارت تمرین شد',
  'card.again': 'یه دور دیگه',
  'card.allDone': 'برای امروز همه‌ش تموم شد.',
  'today.due': 'مرور',
  'today.new': 'جدید',
  'today.right': 'درست',
  'today.passedHead': 'رد شدی',
  'today.nowOn': 'حالا روی سطح',

  // Boot failure
  'boot.blocked': 'برنامه یه جای دیگه هم بازه. همهٔ نسخه‌ها رو ببند و دوباره باز کن.',
  'boot.retry': 'دوباره امتحان کن',
  'boot.stale': 'یه نسخهٔ تازه‌تر باز شده. این صفحه رو دوباره باز کن.',
  'boot.failed': 'برنامه بالا نیومد. یه بار ببند و دوباره باز کن.',

  // Settings
  'tab.settings': 'تنظیمات',
  'settings.level': 'سطح',
  'settings.focus': 'تمرین',
  'settings.focusLabel': 'چی تمرین کنم',
  'settings.focusHint': 'همه، یا فقط یه چیز: جمله‌ها، کلمه‌ها، یا صرف فعل و ضمیرها. مرور کارت‌های دیگه سر جاش می‌مونه تا برگردی.',
  'focus.all': 'همه',
  'focus.sentences': 'جمله‌ها',
  'focus.words': 'کلمه‌ها',
  'focus.forms': 'فعل و ضمیر',
  'settings.currentLevel': 'سطح فعلی',
  'settings.immersion': 'غوطه‌وری',
  'settings.immersive': 'انگلیسی و تلفظ پنهون باشه',
  'settings.immersiveHint': 'معنی و تلفظ فقط با یه ضربه نشون داده می‌شن. خاموشش کنی، همیشه دیده می‌شن.',
  'card.meaning': 'معنی',
  'card.pronunciation': 'تلفظ',
  'card.typeReply': 'جوابت رو بنویس…',
  'settings.levelNow': 'کارت‌های جدید حالا از این سطح میان:',
  'settings.backup': 'پشتیبان',
  'settings.exportBackup': 'ذخیرهٔ پشتیبان',
  'settings.importBackup': 'بازگردانی…',
  'settings.backupHint': 'برنامهٔ مرور و تاریخچه‌ات فقط توی همین مرورگره، و iOS می‌تونه پاکش کنه. هر از گاهی یه پشتیبان توی Files ذخیره کن؛ بازگردانی چیزی رو که اینجاست جایگزین می‌کنه.',
  'settings.backupSaved': 'پشتیبان ذخیره شد',
  'settings.backupRestored': 'بازگردانی شد',
  'settings.notBackup': 'این فایل پشتیبانِ این برنامه نیست.',
  'settings.newerBackup': 'این پشتیبان مال نسخهٔ جدیدتریه.',
  'settings.backupFailed': 'این فایل خونده نشد.',
  'settings.scheduled': 'کارت زمان‌بندی‌شده',
  'settings.reviews': 'مرور',
  'settings.lastBackup': 'آخرین پشتیبان',
  'settings.backupReplace': 'بازگردانی چیزی رو که روی این دستگاهه جایگزین می‌کنه.',
  'settings.unknownDate': 'تاریخ نامشخص',
  'settings.confirmRestore': 'پیشرفت این دستگاه با پشتیبانِ این تاریخ جایگزین بشه؟',
  'settings.goneFromDeck': 'دیگه توی بسته نیستن',

  // The online account
  'account.title': 'حساب آنلاین',
  'account.email': 'ایمیل',
  'account.password': 'رمز (حداقل ۸ حرف)',
  'account.signIn': 'ورود',
  'account.signUp': 'ساختن حساب',
  'account.signOut': 'خروج',
  'account.syncNow': 'همگام‌سازی',
  'account.hint': 'با یه حساب، پیشرفتت آنلاین هم ذخیره می‌شه و روی هر دستگاهی که باهاش وارد شی هست. بدون اینترنت هم مثل قبل کار می‌کنه.',
  'account.working': 'یه لحظه…',
  'account.syncing': 'داره همگام می‌شه…',
  'account.synced': 'آخرین همگام‌سازی',
  'account.notYet': 'هنوز همگام نشده',
  'account.waiting': 'تغییر منتظر اینترنته',
  'account.offline': 'اینترنت نیست؛ وصل که شی، خودش می‌ره بالا.',
  'account.expired': 'ورودت منقضی شد. دوباره وارد شو؛ پیشرفتت روی این دستگاه سر جاشه.',
  'account.welcome': 'وارد شدی — پیشرفتت آنلاین ذخیره شد',
  'account.signedOut': 'خارج شدی. پیشرفتت روی این دستگاه می‌مونه.',
  'account.errInput': 'ایمیل و یه رمز حداقل ۸ حرفی بنویس.',
  'account.errInvalid': 'ایمیل یا رمز اشتباهه. تازه‌واردی؟ «ساختن حساب» رو بزن.',
  'account.errExists': 'با این ایمیل از قبل حساب هست. «ورود» رو بزن.',
  'account.errTooMany': 'زیادی امتحان کردی. چند دقیقه صبر کن.',
  'account.errWeak': 'این رمز خیلی ضعیفه. یه رمز دیگه انتخاب کن.',
  'account.errOffline': 'وصل نشد. اینترنتت رو چک کن.',
  'account.backupHint': 'پیشرفتت آنلاین ذخیره می‌شه. پشتیبان یه نسخهٔ اضافه‌ست؛ بازگردانی چیزی رو که اینجا و توی حسابه جایگزین می‌کنه.',

  // The reference screen
  'tab.kb': 'مرجع',
  'kb.search': 'جستجو — فارسی، انگلیسی یا فینگلیش',
  'kb.words': 'کلمه‌ها',
  'kb.verbs': 'فعل‌ها',
  'kb.pronouns': 'ضمیر و پسوند',
  'kb.notes': 'دستور زبان',
  'kb.practise': 'تمرینش کن',
  'kb.examples': 'توی جمله‌ها',
  'kb.noExamples': 'هنوز جمله‌ای با این توی بسته نیست.',
  'kb.nothing': 'چیزی پیدا نشد.',
  'kb.notLoaded': 'مرجع بالا نیومد — یه بار با اینترنت باز کن.',
  'kb.core': 'پرکاربرد',
  'kb.alsoSaid': 'این‌جوری هم می‌گن',
  'kb.compound': 'فعل مرکب',
  'kb.pastStem': 'بن ماضی',
  'kb.presStem': 'بن مضارع',
  'kb.lookup': 'مرجع ←',
  'kb.focusDone': 'اینا تموم شد — برگشتی سر تمرین همیشگی.',
  'kb.nothingToDrill': 'این کارت‌ها هنوز روی این دستگاه نیستن.',

  // Your own sentences
  'bank.title': 'جمله‌های خودم',
  'bank.english': 'انگلیسی',
  'bank.farsi': 'فارسی',
  'bank.finglish': 'تلفظ (اختیاری)',
  'bank.straightIn': 'هر جمله‌ای که بنویسی همون موقع میاد تو تمرین — سهمیهٔ کارت جدید روزانه شاملش نمی‌شه.',
  'bank.add': 'اضافه کن',
  'bank.none': 'هنوز جمله‌ای اضافه نکردی.',
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
  for (const element of root.querySelectorAll('[data-t-placeholder]')) {
    const value = STRINGS[element.dataset.tPlaceholder];
    if (value) element.placeholder = value;
  }
}
