// Text-to-speech, used only to play a revealed answer aloud.
//
// TTS is a genuine unknown on iOS: Safari exposes only the voices installed on
// the device, and Persian is not there by default. Everything here detects and
// degrades rather than assuming — a missing voice hides the play button, it
// does not break the card.

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
