// The one network boundary. Everything else in the app is offline.

import * as db from './db.js';
import { ERROR_TAG_KEYS } from './taxonomy.js';

export class ApiError extends Error {
  constructor(message, { status = 0, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.cause = cause;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // result is a data: URL; the payload follows the comma.
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function normaliseBase(url) {
  return url.trim().replace(/\/+$/, '');
}

/** Liveness check for the settings screen. */
export async function health(baseURL) {
  const response = await fetch(`${normaliseBase(baseURL)}/healthz`);
  if (!response.ok) throw new ApiError(`HTTP ${response.status}`, { status: response.status });
  return response.json();
}

/**
 * Report attempts, receive grades and new sentences.
 *
 * Best-effort and resumable: attempts are only marked synced after the call
 * succeeds, so a failure just means the next sync retries them.
 */
export async function sync({ attempts, wantSentences, since, settings }) {
  const base = normaliseBase(settings.backendURL);
  if (!base || !settings.apiToken) {
    throw new ApiError('Backend not configured. Add the URL and token in Settings.');
  }

  const payload = [];
  for (const { attempt, sentence } of attempts) {
    payload.push({
      id: attempt.id,
      sentenceId: attempt.sentenceId,
      direction: attempt.direction,
      mode: attempt.mode,
      englishText: sentence.englishText,
      referenceFarsi: sentence.farsiText,
      // Without these the backend cannot attribute self-rated attempts to any
      // tag, and speak-aloud practice would contribute nothing to adaptation.
      grammarTags: sentence.grammarTags ?? [],
      typedAnswer: attempt.typedAnswer,
      audioBase64: attempt.audioBlob ? await blobToBase64(attempt.audioBlob) : null,
      selfRating: attempt.selfRating,
    });
  }

  let response;
  try {
    response = await fetch(`${base}/v1/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiToken}`,
      },
      body: JSON.stringify({
        attempts: payload,
        wantSentences,
        since: since ? new Date(since).toISOString() : null,
      }),
    });
  } catch (error) {
    throw new ApiError('Could not reach the backend. Are you online?', { cause: error });
  }

  if (response.status === 401) {
    throw new ApiError('The backend rejected the token. Check it in Settings.', { status: 401 });
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new ApiError(`Backend returned HTTP ${response.status}. ${detail}`, {
      status: response.status,
    });
  }

  const result = await response.json();
  // Defend against a model or server that returns a tag outside the closed set.
  for (const grade of result.grades ?? []) {
    grade.errorTags = (grade.errorTags ?? []).filter((t) => ERROR_TAG_KEYS.includes(t));
  }
  return result;
}

/** Attempts that still need reporting, joined to their sentences. */
export async function pendingAttempts(limit = 60) {
  const [attempts, sentences] = await Promise.all([
    db.getAll(db.STORE.attempts),
    db.getAll(db.STORE.sentences),
  ]);
  const byId = new Map(sentences.map((s) => [s.id, s]));

  return attempts
    .filter((a) => !a.syncedAt)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit)
    .map((attempt) => ({ attempt, sentence: byId.get(attempt.sentenceId) }))
    .filter((pair) => pair.sentence);
}

/** Fold a sync result back into local state. */
export async function applyResult(result, sent) {
  const bySentId = new Map(sent.map(({ attempt, sentence }) => [attempt.id, sentence]));
  const byId = new Map(sent.map(({ attempt }) => [attempt.id, attempt]));
  const now = Date.now();
  let graded = 0;

  for (const grade of result.grades ?? []) {
    const attempt = byId.get(grade.attemptId);
    if (!attempt) continue;

    attempt.transcript = grade.transcript || null;
    attempt.aiScore = grade.score;
    attempt.aiVerdict = grade.verdict;
    attempt.aiFeedback = grade.feedback;
    attempt.correctedFarsi = grade.correctedFarsi;
    attempt.aiErrorTags = grade.errorTags;
    attempt.gradedAt = now;
    // The clip has served its purpose; 100 a day would otherwise fill the device.
    attempt.audioBlob = null;
    graded += 1;

    await applyGradeToTagStats(grade, bySentId.get(grade.attemptId));
  }

  // Mark everything sent, graded or not — self-rated attempts have now
  // contributed their signal and must not be resent.
  for (const { attempt } of sent) {
    attempt.syncedAt = now;
    await db.put(db.STORE.attempts, attempt);
  }

  const added = await insertSentences(result.sentences ?? []);
  await db.saveSettings({ lastSyncAt: now });
  return { graded, added };
}

/**
 * An AI grade is better evidence than a self-rating, so correct the counts the
 * self-rating already recorded rather than double-counting.
 */
async function applyGradeToTagStats(grade, sentence) {
  if (!sentence) return;
  const exercised = new Set(sentence.grammarTags ?? []);
  const failed = new Set(grade.errorTags ?? []);

  for (const tag of new Set([...exercised, ...failed])) {
    const stat = (await db.get(db.STORE.tagStats, tag)) ?? {
      tag,
      failCount: 0,
      totalCount: 0,
    };
    if (!exercised.has(tag)) stat.totalCount += 1; // tag the grader added
    if (failed.has(tag)) stat.failCount += 1;
    stat.lastSeen = Date.now();
    await db.put(db.STORE.tagStats, stat);
  }
}

async function insertSentences(incoming) {
  if (!incoming.length) return 0;
  const existing = await db.getAll(db.STORE.sentences);
  const seen = new Set(existing.map((s) => s.farsiText));

  const fresh = incoming
    .filter((s) => !seen.has(s.farsiText))
    .map((s) => ({
      id: s.id ?? crypto.randomUUID(),
      englishText: s.englishText,
      farsiText: s.farsiText,
      finglish: s.finglish,
      literalGloss: s.literalGloss,
      difficulty: s.difficulty,
      situation: s.situation,
      grammarTags: s.grammarTags ?? [],
      source: 'generated',
      createdAt: Date.now(),
    }));

  await db.putMany(db.STORE.sentences, fresh);
  return fresh.length;
}
