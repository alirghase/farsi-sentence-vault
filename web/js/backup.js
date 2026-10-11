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
import { t } from './strings.js';

const FORMAT = 'farsi-vault-backup';
const VERSION = 1;

export async function exportData() {
  const [sentences, reviews, attempts, settings] = await Promise.all([
    db.getAll(db.STORE.sentences),
    db.getAll(db.STORE.reviews),
    db.getAll(db.STORE.attempts),
    db.getSettings(),
  ]);
  const textById = new Map(sentences.map((s) => [s.id, s.farsiText]));
  const kindById = new Map(sentences.map((s) => [s.id, s.kind ?? 'sentence']));

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    // kind with the text: a word card and a sentence can share their Persian.
    reviews: reviews.map((r) => ({
      ...r, farsiText: textById.get(r.sentenceId), kind: kindById.get(r.sentenceId),
    })),
    attempts: attempts.map((a) => ({
      ...a, farsiText: textById.get(a.sentenceId), kind: kindById.get(a.sentenceId),
    })),
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
  if (backup?.format !== FORMAT) throw new Error(t('settings.notBackup'));
  if (backup.version > VERSION) throw new Error(t('settings.newerBackup'));

  if (backup.customSentences?.length) {
    await db.putMany(db.STORE.sentences, backup.customSentences);
  }
  const sentences = await db.getAll(db.STORE.sentences);
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const idByText = new Map(sentences.map((s) => [s.farsiText, s.id]));
  const idByKindText = new Map(sentences.map((s) => [`${s.kind ?? 'sentence'}::${s.farsiText}`, s.id]));
  // A backup that records the kind resolves within it; an older one, by text.
  const byText = (row) => (row.kind
    ? idByKindText.get(`${row.kind}::${row.farsiText}`)
    : idByText.get(row.farsiText));
  // The id first when it names the same text here: two words can share a
  // spelling (نه, no and nine), and the text alone would put both histories
  // on one of them.
  const resolve = (row) => {
    const same = byId.get(row.sentenceId);
    if (same && same.farsiText === row.farsiText) return row.sentenceId;
    return byText(row) ?? (same ? row.sentenceId : null);
  };

  let skipped = 0;
  const reviews = [];
  for (const { farsiText, kind, ...row } of backup.reviews ?? []) {
    const sentenceId = resolve({ farsiText, kind, ...row });
    if (!sentenceId) { skipped += 1; continue; }
    reviews.push({ ...row, sentenceId, key: `${sentenceId}::${row.direction}` });
  }
  const attempts = [];
  for (const { farsiText, kind, ...row } of backup.attempts ?? []) {
    const sentenceId = resolve({ farsiText, kind, ...row });
    if (!sentenceId) continue;
    attempts.push({ ...row, sentenceId });
  }

  // One transaction: clear and write together, so a restore that fails leaves
  // the device as it was rather than emptied. Everything above this line is
  // pure computation for the same reason — nothing is written until the whole
  // file has been read and resolved.
  //
  // A backup written before the weak-spots view was removed also carries
  // tagStats. It is ignored rather than restored: nothing counts tags any
  // more, and refusing an older file would be the wrong trade when it holds a
  // real review history.
  await db.replaceAll([
    [db.STORE.reviews, reviews],
    [db.STORE.attempts, attempts],
  ]);
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
