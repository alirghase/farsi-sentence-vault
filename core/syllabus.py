"""The core verbs, and a count of how well the deck covers them.

Situations give variety but not coverage: a deck full of "ordering food" can
leave whole verbs untouched. tools/coverage.py reports from here.
"""

from __future__ import annotations

import functools
import re

# --- Core verbs -----------------------------------------------------------
# The highest-frequency Persian verbs. Persian leans heavily on compound verbs
# (noun + light verb), so those are listed as their own entries: a learner who
# knows کردن but not "زنگ زدن" still cannot make a phone call.

CORE_VERBS = [
    ("بودن", "to be"),
    ("داشتن", "to have"),
    ("رفتن", "to go"),
    ("اومدن", "to come"),
    ("کردن", "to do / make"),
    ("شدن", "to become"),
    ("گفتن", "to say"),
    ("دیدن", "to see"),
    ("دادن", "to give"),
    ("گرفتن", "to take / get"),
    ("خوردن", "to eat"),
    ("خواستن", "to want"),
    ("تونستن", "to be able"),
    ("دونستن", "to know (a fact)"),
    ("شناختن", "to know (a person)"),
    ("آوردن", "to bring"),
    ("بردن", "to take away / win"),
    ("گذاشتن", "to put / let"),
    ("برداشتن", "to pick up"),
    ("زدن", "to hit / strike"),
    ("خریدن", "to buy"),
    ("فروختن", "to sell"),
    ("نوشتن", "to write"),
    ("خوندن", "to read / sing"),
    ("موندن", "to stay"),
    ("رسیدن", "to arrive"),
    ("فهمیدن", "to understand"),
    ("پرسیدن", "to ask"),
    ("گشتن", "to look for / wander"),
    ("نشستن", "to sit"),
    ("خوابیدن", "to sleep"),
    ("بلند شدن", "to get up"),
    ("کار کردن", "to work"),
    ("صحبت کردن", "to talk"),
    ("زنگ زدن", "to phone"),
    ("قدم زدن", "to walk / stroll"),
    ("دوست داشتن", "to like / love"),
    ("لازم داشتن", "to need"),
    ("یاد گرفتن", "to learn"),
    ("فکر کردن", "to think"),
    ("منتظر موندن", "to wait"),
    ("کمک کردن", "to help"),
    ("درست کردن", "to make / fix"),
    ("پیدا کردن", "to find"),
    ("باز کردن", "to open"),
    ("بستن", "to close"),
    ("شروع کردن", "to start"),
    ("تموم کردن", "to finish"),
]

# Present stems, which are irregular and cannot be derived from the infinitive:
# رفتن -> می‌رم, اومدن -> میام. Without these the count sees only the past tense
# and calls a verb thin when half the deck uses it.
#
# Several are a single letter (رفتن -> ر). Those must never be matched as bare
# substrings — "ر" occurs inside a large fraction of Persian words, which scored
# رفتن at 622 of 849 sentences. A present stem only counts inside a conjugated
# form: a می‌/ب/ن prefix and a personal ending.
PRESENT_STEMS = {
    "بودن": "هست", "داشتن": "دار", "رفتن": "ر", "اومدن": "ی", "کردن": "کن",
    "شدن": "ش", "گفتن": "گ", "دیدن": "بین", "دادن": "د", "گرفتن": "گیر",
    "خوردن": "خور", "خواستن": "خوا", "تونستن": "تون", "دونستن": "دون",
    "شناختن": "شناس", "آوردن": "آر", "بردن": "بر", "گذاشتن": "ذار",
    "برداشتن": "دار", "زدن": "زن", "خریدن": "خر", "فروختن": "فروش",
    "نوشتن": "نویس", "خوندن": "خون", "موندن": "مون", "رسیدن": "رس",
    "فهمیدن": "فهم", "پرسیدن": "پرس", "گشتن": "گرد", "نشستن": "شین",
    "خوابیدن": "خواب", "بستن": "بند",
}

# A few verbs do not compose from prefix + stem + ending. اومدن is the one that
# matters: its present is میاد / میام and its imperative بیا, none of which fall
# out of the stem. Without these it scored 8 where the true figure is 30.
EXTRA_FORMS = {
    "اومدن": (r"ن?می\u200c?ا(?:م|د|ی|ن|یم|ین)", r"ن?بیا(?:م|د|ی|ن|یم|ین)?"),
    "گفتن": (r"ن?بگو",),
    "شدن": (r"ن?میش(?:م|ه|ی|ن|یم|ین)",),
}

# Forms of the light verbs that close a compound.
_LIGHT_VERB_FORMS = (
    "کرد", "کن", "شد", "شو", "زد", "زن", "داشت", "دار",
    "گرفت", "گیر", "موند", "مون",
)

_FA = r"[\u0600-\u06FF]"
_ENDINGS = r"(?:یم|ید|ین|ند|م|ی|ه|ن|د)?"
_PREFIX = r"(?:ن?می\u200c?|ب|ن)"


def _past_stem(infinitive: str) -> str:
    return infinitive[:-1] if infinitive.endswith("ن") else infinitive


@functools.lru_cache(maxsize=None)
def _verb_pattern(infinitive: str) -> re.Pattern:
    """A regex that matches an inflected form of a simple verb."""
    past = _past_stem(infinitive)
    alternatives = [rf"ن?{re.escape(past)}{_ENDINGS}"]
    present = PRESENT_STEMS.get(infinitive)
    if present:
        alternatives.append(rf"{_PREFIX}{re.escape(present)}{_ENDINGS}")
    alternatives.extend(EXTRA_FORMS.get(infinitive, ()))
    body = "|".join(alternatives)
    return re.compile(rf"(?<!{_FA})(?:{body})(?!{_FA})")


def coverage(sentences: list[dict]) -> dict[str, int]:
    """How many sentences actually use each core verb.

    Two things this deliberately does NOT do, both learned from versions that
    lied:

    * A compound verb is not scored by its nominal alone. "کار کردن" matched on
      "کار" counts every occurrence of the noun "work" — 24 hits at A1+A2 with
      no verb present. The light verb has to follow it.
    * A present stem is not matched as a bare substring, for the reason in the
      PRESENT_STEMS note above.

    It remains a coverage signal, not a parser.
    """
    counts = {verb: 0 for verb, _ in CORE_VERBS}
    for sentence in sentences:
        text = sentence.get("farsiText", "")
        words = text.split()
        for verb, _ in CORE_VERBS:
            if " " in verb:
                nominal, light = verb.split(" ", 1)
                forms = (_past_stem(light), *_LIGHT_VERB_FORMS)
                hit = any(
                    word.startswith(nominal)
                    and any(form in nxt for nxt in words[i + 1:i + 3] for form in forms)
                    for i, word in enumerate(words)
                )
            else:
                hit = bool(_verb_pattern(verb).search(text))
            if hit:
                counts[verb] += 1
    return counts


# --- Core words ---------------------------------------------------------------
# The small words everyday speech is mostly made of — the ones worth meeting in
# several sentences rather than once. Written from experience, not a corpus: no
# frequency list ships with the repo. Verbs are in CORE_VERBS above.
#
# A word "counts" when a sentence contains it, bare or with a clitic or plural
# ending (کتابم, کتابا, خونه‌ست). Close enough to show where the deck is thin.

CORE_WORDS = """
من I | تو you | اون he/she/that | ما we | شما you(formal) | اونا they | این this | اینا these
خودم myself | همه everyone | هیچی nothing | هیچکس nobody | یکی someone | چیزی something | کسی anyone
هر every | همین this-very | همون that-very | بعضی some | چند a-few
از from | به to | با with | برای for | واسه for | تا until | که that | یا or | ولی but | اما but
چون because | اگه if | وقتی when | پس so | هم also | بدون without | مثل like | پیش with/near
کنار beside | جلوی in-front-of | پشت behind | روی on | زیر under | بین between | بعد after | قبل before
کجا where | چی what | چرا why | کی who/when | چطوری how | چقدر how-much | کدوم which | چه what
نه no | آره yeah | بله yes | فقط only | حتی even | دیگه anymore/else | هنوز still | الان now
امروز today | دیروز yesterday | فردا tomorrow | امشب tonight | دیشب last-night | همیشه always
هیچوقت never | گاهی sometimes | معمولا usually | زود early | دیر late | خیلی very | کم little | زیاد a-lot
بیشتر more | کمتر less | اینجا here | اونجا there | بالا up | پایین down | بیرون out | دوباره again
تنها alone | شاید maybe | حتما definitely | اصلا at-all | واقعا really | البته of-course | یعنی I-mean
خب well | آخه but-come-on | مثلا for-example | تقریبا almost | باید must | سریع fast | آروم slowly
یه a/one | دو two | سه three | چهار four | پنج five | ده ten | صد hundred | هزار thousand | نیم half
آدم person | مرد man | زن woman | بچه child | پسر boy/son | دختر girl/daughter | دوست friend
مامان mum | بابا dad | خواهر sister | برادر brother | خانواده family | شوهر husband | همسر spouse
عمو uncle(paternal) | خاله aunt(maternal) | دایی uncle(maternal) | عمه aunt(paternal)
مادربزرگ grandmother | پدربزرگ grandfather | همسایه neighbour | همکار colleague | مهمون guest | دکتر doctor
روز day | شب night | صبح morning | ظهر noon | عصر afternoon | هفته week | ماه month | سال year
ساعت hour/clock | دقیقه minute | وقت time | لحظه moment | اول first | آخر last
خونه home | اتاق room | در door | کار work | مدرسه school | دانشگاه university | شهر city
خیابون street | کوچه alley | مغازه shop | بازار market | رستوران restaurant | بیمارستان hospital
بانک bank | ایستگاه station | اتوبوس bus | تاکسی taxi | ماشین car | راه way | جا place | پول money
گوشی phone | کتاب book | آب water | غذا food | نون bread | چای tea | قهوه coffee | میوه fruit
لباس clothes | کفش shoes | کیف bag | کلید key | پنجره window | میز table | صندلی chair | تخت bed
چیز thing | اسم name | حرف word/talk | خبر news | سوال question | جواب answer | مشکل problem
فکر thought | بار time(s) | دفعه time(s) | زبون language | فارسی Persian | عکس photo | فیلم film
هوا weather/air | بارون rain
سر head | دست hand | پا foot | چشم eye | گوش ear | دندون tooth | دل heart | شکم stomach | گلو throat
کمر back | حال state/mood | درد pain | قرص pill
خوب good | بد bad | بزرگ big | کوچیک small | جدید new | قدیمی old | گرم warm | سرد cold
گرون expensive | ارزون cheap | آسون easy | سخت hard | راحت comfortable | خسته tired | گشنه hungry
تشنه thirsty | خوشحال happy | ناراحت upset | مریض ill | قشنگ beautiful | زشت ugly | تمیز clean
کثیف dirty | پر full | خالی empty | باز open | بسته closed | درست right | غلط wrong | مهم important
لازم necessary | آماده ready | آزاد free | شلوغ busy/crowded | نزدیک near | دور far | بلند tall/loud
کوتاه short | خوشمزه tasty | عالی great | سفید white | سیاه black | قرمز red | سبز green
سلام hello | خداحافظ goodbye | مرسی thanks | ممنون thank-you | ببخشید sorry/excuse-me | لطفا please
خواهش please/you're-welcome | بفرمایین here-you-are | باشه okay
آقا Mr/sir | خانم Mrs/lady | رئیس boss | شرکت company | کمک help | دلیل reason | فرق difference
قرار plan/appointment | قول promise | کلمه word | فرصت chance | تولد birthday | عروسی wedding | عید holiday
برق electricity | چراغ light | بلیت ticket | پرواز flight | هتل hotel | دستشویی toilet | تلویزیون TV
کامپیوتر computer | مرغ chicken | برنج rice | ماهی fish | نمک salt | شیر milk | گوشت meat
جالب interesting | عجیب strange | عصبانی angry | نگران worried | خوشگل pretty | جوون young | پیر old
سنگین heavy | تازه fresh/just | داغ hot | شیرین sweet | تلخ bitter | آبی blue | روشن on/bright
تاریک dark | بیدار awake
"""

CORE_WORD_LIST = [
    tuple(entry.split(" ", 1)) for line in CORE_WORDS.strip().splitlines()
    for entry in (e.strip() for e in line.split("|")) if entry
]

_WORD_ENDINGS = ("", "م", "ت", "ش", "مون", "تون", "شون", "ه", "ی", "ها", "ا", "رو", "و",
                 "ام", "ای", "ست", "یم", "ین", "ن", "اش", "هام", "هات", "هاش", "امون", "ات",
                 "مه", "ته", "شه")


def word_counts(texts: list[str]) -> dict[str, int]:
    """How many of `texts` contain each core word, bare or with an ending."""
    split = [{w.replace("‌", "") for w in re.split(r"[\s؟،؛.!?:«»\"]+", t) if w}
             for t in texts]
    counts = {}
    for word, _gloss in CORE_WORD_LIST:
        forms = {word + ending for ending in _WORD_ENDINGS}
        counts[word] = sum(1 for tokens in split if tokens & forms)
    return counts


def core_share(text: str) -> float:
    """How much of a sentence is core words, to the nearest quarter.

    The app introduces new sentences highest share first, so the words everyday
    speech is mostly made of come before the ones it rarely needs. Quarters
    rather than exact fractions so each tier is big enough to shuffle.
    """
    tokens = [w.replace("\u200c", "") for w in re.split(r"[\s؟،؛.!?:«»\"]+", text) if w]
    if not tokens:
        return 0.0
    forms, verbs = _core_forms()
    return round(sum(t in forms or bool(verbs.fullmatch(t)) for t in tokens) / len(tokens) * 4) / 4


@functools.lru_cache(maxsize=None)
def _core_forms() -> tuple[set[str], re.Pattern]:
    """Every core word with its endings, and one pattern for the core verbs."""
    forms = {word + ending for word, _gloss in CORE_WORD_LIST for ending in _WORD_ENDINGS}
    simple = [v for v, _gloss in CORE_VERBS if " " not in v]
    verbs = re.compile("|".join(f"(?:{_verb_pattern(v).pattern})" for v in simple))
    return forms, verbs
