// SM-2 spaced repetition, as used by Anki and SuperMemo.
//
// Pure functions over plain objects: no storage, no DOM. That makes the one
// piece where a subtle bug stays invisible for weeks directly testable.
//
// Quality is 0-5. Below 3 is a lapse: repetitions reset and the card returns
// tomorrow. Self-ratings and AI verdicts both map onto this scale, so one
// scheduler serves both.

export const DEFAULT_EASE = 2.5;
export const MINIMUM_EASE = 1.3;
export const PASSING_QUALITY = 3;

// Without a cap, a few "easy" ratings push a card years out and it effectively
// leaves the deck — bad for a language you are actively trying to keep warm.
export const MAX_INTERVAL_DAYS = 365;

/** Interval an "easy" rating jumps a new card to, skipping the 1-day step. */
export const EASY_GRADUATING_DAYS = 4;

/**
 * Quality scores for the two rating buttons.
 *
 * Binary maps onto SM-2 cleanly: below the passing threshold is a lapse, above
 * it is a standard review. The ease-factor nuance that Hard and Easy used to
 * provide is replaced by measured answer time, which is a real signal rather
 * than a judgement call made under no pressure.
 */
export const RATING_QUALITY = { fail: 2, pass: 4 };



export function newState() {
  return { easeFactor: DEFAULT_EASE, intervalDays: 0, repetitions: 0, lapses: 0 };
}

/** Advance scheduling state by one review. Returns a new object. */
export function next(state, quality) {
  const q = Math.max(0, Math.min(5, quality));
  const out = { ...state };

  if (q < PASSING_QUALITY) {
    out.repetitions = 0;
    out.intervalDays = 1;
    out.lapses += 1;
  } else {
    if (out.repetitions === 0) {
      // Easy on a brand-new card graduates straight to 4 days, as Anki does.
      // Without this every rating on a new card previews "1d", which makes the
      // four buttons look interchangeable and the choice feel arbitrary.
      out.intervalDays = q === 5 ? EASY_GRADUATING_DAYS : 1;
    } else if (out.repetitions === 1) {
      out.intervalDays = 6;
    } else {
      out.intervalDays = Math.min(
        Math.round(out.intervalDays * out.easeFactor),
        MAX_INTERVAL_DAYS,
      );
    }
    out.repetitions += 1;
  }

  // Ease adjusts on every review, pass or fail.
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  out.easeFactor = Math.max(MINIMUM_EASE, out.easeFactor + delta);

  return out;
}

/** Timestamp (ms) when a card in this state should next appear. */
export function dueDate(state, reviewedAt = Date.now()) {
  const days = Math.max(1, state.intervalDays);
  const start = new Date(reviewedAt);
  start.setHours(0, 0, 0, 0);
  return start.getTime() + days * 86400000;
}

/** Interval a rating would produce, for the button labels. */
export function previewInterval(state, rating) {
  return next(state, RATING_QUALITY[rating]).intervalDays;
}
