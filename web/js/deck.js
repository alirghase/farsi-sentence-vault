// Keeps the on-device deck in step with the one bundled in the app.

import * as db from './db.js';

/**
 * Fields the bundle owns. When the deck is corrected — a fixed gloss, a
 * stripped quote mark, a better translation — these are copied over the row
 * already on the device. Scheduling lives in the reviews store, keyed by the
 * row's id, so rewriting content never touches progress.
 */
const CONTENT_FIELDS = [
  'englishText', 'farsiText', 'finglish', 'literalGloss', 'difficulty',
  'situation', 'grammarTags', 'breakdown', 'alternatives',
];

/**
 * Merge the bundled deck into IndexedDB.
 *
 * Three things the earlier version got wrong, each silently:
 * - it only ever added sentences, so a correction to one already on the device
 *   never arrived (the quote-mark fix to the word map, for one);
 * - it only copied a breakdown onto rows that had none, for the same reason;
 * - it never removed a sentence the deck had dropped.
 *
 * Rows are matched on the bundle's stable id first, then on the Persian text,
 * which is how rows created before the bundle carried ids are adopted. A
 * dropped sentence is removed only if it was never reviewed: one with history
 * stays, because deleting it would delete the history with it.
 *
 * Returns { added, updated, removed } for the caller to report.
 */
export async function syncBundled(incoming) {
  const [existing, reviews] = await Promise.all([
    db.getAll(db.STORE.sentences),
    db.getAll(db.STORE.reviews),
  ]);

  const bySeedId = new Map();
  const byText = new Map();
  for (const row of existing) {
    if (row.seedId) bySeedId.set(row.seedId, row);
    bySeedId.set(row.id, bySeedId.get(row.id) ?? row);
    byText.set(row.farsiText, row);
  }

  const now = Date.now();
  const matched = new Set();
  const writes = [];
  let added = 0;
  let updated = 0;

  for (const source of incoming) {
    const row = (source.id && bySeedId.get(source.id)) ?? byText.get(source.farsiText);

    if (row && !matched.has(row.id)) {
      matched.add(row.id);
      const next = { ...row, seedId: source.id ?? row.seedId };
      for (const field of CONTENT_FIELDS) {
        if (source[field] !== undefined) next[field] = source[field];
      }
      if (JSON.stringify(next) !== JSON.stringify(row)) {
        writes.push(next);
        updated += 1;
      }
      continue;
    }

    const id = source.id ?? crypto.randomUUID();
    matched.add(id);
    writes.push({
      ...source,
      id,
      seedId: source.id,
      kind: source.kind ?? 'sentence',
      source: 'seed',
      createdAt: now,
    });
    added += 1;
  }

  const reviewed = new Set(reviews.map((r) => r.sentenceId));
  const dropped = existing
    .filter((row) => row.source === 'seed' && !matched.has(row.id) && !reviewed.has(row.id))
    .map((row) => row.id);

  await db.putMany(db.STORE.sentences, writes);
  await db.removeMany(db.STORE.sentences, dropped);
  return { added, updated, removed: dropped.length };
}

/** Fetch the bundled deck and merge it. Never throws: a failed fetch is offline. */
export async function loadBundled(url = 'data/seed_sentences.json') {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bundle = await response.json();
    const incoming = bundle.sentences ?? [];
    if (!incoming.length) return null;
    return await syncBundled(incoming);
  } catch {
    return null;
  }
}
