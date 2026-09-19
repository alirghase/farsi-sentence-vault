// Text-to-speech and recording.
//
// TTS is a genuine unknown on iOS: Safari exposes only the voices installed on
// the device, and Persian is not there by default. Everything here detects and
// degrades rather than assuming — a missing voice hides the play button, it
// does not break the card.
//
// Recording is more dependable: MediaRecorder works in iOS Safari 14.3+.
// Transcription happens server-side because Apple has no Persian dictation.

// --- text to speech --------------------------------------------------------

let cachedVoices = null;

/**
 * Voice list loads asynchronously and is often empty on first call, which is
 * the classic Web Speech bug — one poll-and-wait avoids a permanently empty list.
 */
export function loadVoices(timeoutMs = 2000) {
  if (cachedVoices) return Promise.resolve(cachedVoices);
  if (!('speechSynthesis' in globalThis)) return Promise.resolve([]);

  return new Promise((resolve) => {
    const collect = () => {
      const voices = speechSynthesis.getVoices();
      if (voices.length) {
        cachedVoices = voices;
        resolve(voices);
        return true;
      }
      return false;
    };
    if (collect()) return;

    const timer = setTimeout(() => {
      cachedVoices = speechSynthesis.getVoices();
      resolve(cachedVoices);
    }, timeoutMs);

    speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        if (collect()) clearTimeout(timer);
      },
      { once: true },
    );
  });
}

export async function persianVoice() {
  const voices = await loadVoices();
  return (
    voices.find((v) => v.lang === 'fa-IR') ??
    voices.find((v) => v.lang?.toLowerCase().startsWith('fa')) ??
    null
  );
}

export async function isSpeechAvailable() {
  return (await persianVoice()) !== null;
}

/**
 * Speak Persian text.
 *
 * Rate is below default: the point is to shadow along with it, and the default
 * is too quick to follow.
 */
export async function speak(text, { rate = 0.85 } = {}) {
  const voice = await persianVoice();
  if (!voice) return false;

  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = rate;
  speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
}

/** Voices present on this device, for the diagnostics in Settings. */
export async function voiceReport() {
  const voices = await loadVoices();
  return {
    total: voices.length,
    persian: voices
      .filter((v) => v.lang?.toLowerCase().startsWith('fa'))
      .map((v) => `${v.name} (${v.lang})`),
  };
}

// --- recording -------------------------------------------------------------

export class Recorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.stream = null;
  }

  static isSupported() {
    return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /**
   * Pick a container the browser will actually produce. Safari records
   * audio/mp4 and ignores the webm types Chrome prefers, so asking for the
   * wrong one yields an empty blob rather than an error.
   */
  static preferredMimeType() {
    const candidates = [
      'audio/mp4',
      'audio/mpeg',
      'audio/webm;codecs=opus',
      'audio/webm',
    ];
    if (typeof MediaRecorder === 'undefined') return '';
    return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? '';
  }

  get isRecording() {
    return this.mediaRecorder?.state === 'recording';
  }

  async start() {
    if (!Recorder.isSupported()) throw new Error('Recording is not supported in this browser.');
    await this.stop();

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = Recorder.preferredMimeType();
    this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];

    this.mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.mediaRecorder.start();
  }

  /** Stop and return the recorded blob, or null if nothing was captured. */
  async stop() {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive') {
      this.releaseStream();
      return null;
    }

    const blob = await new Promise((resolve) => {
      recorder.addEventListener(
        'stop',
        () => {
          const type = recorder.mimeType || 'audio/mp4';
          resolve(this.chunks.length ? new Blob(this.chunks, { type }) : null);
        },
        { once: true },
      );
      recorder.stop();
    });

    this.releaseStream();
    this.mediaRecorder = null;
    return blob;
  }

  releaseStream() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
