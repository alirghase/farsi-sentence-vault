// Backup and restore of everything that took practice to produce.
//
// iOS can evict a web app's storage, and there is no server holding a copy, so
// the schedule and review history exist in exactly one place. A backup file is
// the cheapest honest answer to that.
//
// Sentence ids on older devices were minted per device, so a backup keys every
// review and attempt by the Persian text as well. Restoring on another device —
// or after the deck was reloaded — maps back through the text, not the id.

import * as db from './db.js';

const FORMAT = 'farsi-vault-backup';
const VERSION = 1;

export async function exportData() {
  const [sentences, reviews, attempts, tagStats, settings] = await Promise.all([
    db.getAll(db.STORE.sentences),
    db.getAll(db.STORE.reviews),
    db.getAll(db.STORE.attempts),
    db.getAll(db.STORE.tagStats),
    db.getSettings(),
  ]);
  const textById = new Map(sentences.map((s) => [s.id, s.farsiText]));

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    reviews: reviews.map((r) => ({ ...r, farsiText: textById.get(r.sentenceId) })),
    attempts: attempts.map((a) => ({ ...a, farsiText: textById.get(a.sentenceId) })),
    tagStats,
    // Anything not from the bundled deck would be lost otherwise. Today that
    // is nothing, but a restore must not depend on that staying true.
    customSentences: sentences.filter((s) => s.source !== 'seed'),
  };
}

/**
 * Replace this device's progress with a backup.
 *
 * Replace, not merge: merging two review histories for the same card has no
 * right answer, and a restore is something you do onto a fresh or broken
 * install. Returns counts, including rows skipped because their sentence is no
 * longer in the deck.
 */
export async function importData(backup) {
  if (backup?.format !== FORMAT) throw new Error('Not a Farsi Vault backup file.');
  if (backup.version > VERSION) throw new Error('This backup is from a newer version of the app.');

  if (backup.customSentences?.length) {
    await db.putMany(db.STORE.sentences, backup.customSentences);
  }
  const sentences = await db.getAll(db.STORE.sentences);
  const ids = new Set(sentences.map((s) => s.id));
  const idByText = new Map(sentences.map((s) => [s.farsiText, s.id]));
  const resolve = (row) => idByText.get(row.farsiText) ?? (ids.has(row.sentenceId) ? row.sentenceId : null);

  let skipped = 0;
  const reviews = [];
  for (const { farsiText, ...row } of backup.reviews ?? []) {
    const sentenceId = resolve({ farsiText, ...row });
    if (!sentenceId) { skipped += 1; continue; }
    reviews.push({ ...row, sentenceId, key: `${sentenceId}::${row.direction}` });
  }
  const attempts = [];
  for (const { farsiText, ...row } of backup.attempts ?? []) {
    const sentenceId = resolve({ farsiText, ...row });
    if (!sentenceId) continue;
    attempts.push({ ...row, sentenceId });
  }

  await Promise.all([
    db.clear(db.STORE.reviews),
    db.clear(db.STORE.attempts),
    db.clear(db.STORE.tagStats),
  ]);
  await db.putMany(db.STORE.reviews, reviews);
  await db.putMany(db.STORE.attempts, attempts);
  await db.putMany(db.STORE.tagStats, backup.tagStats ?? []);
  const settings = await db.saveSettings(backup.settings ?? {});

  return { reviews: reviews.length, attempts: attempts.length, skipped, settings };
}

/**
 * Hand the file to the user.
 *
 * The share sheet where there is one — on an iPhone that is the route to Files
 * or iCloud Drive, and a download link inside a Home Screen app goes nowhere
 * useful. A plain download everywhere else.
 */
export async function saveFile(data) {
  const day = new Date().toISOString().slice(0, 10);
  const name = `farsi-vault-backup-${day}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      // Fall through to a download.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
