// Short synthesised UI sounds.
//
// Synthesised rather than shipped as audio files: two short tones cost nothing
// to cache, never 404, and keep the app a set of text files with no binary
// assets. Web Audio also lets the sound be genuinely brief — a sampled click
// tends to carry a few milliseconds of silence that reads as lag.

let ctx = null;
let enabled = true;

export function setEnabled(value) {
  enabled = value;
}

/**
 * The context must be created after a user gesture or iOS refuses to play, and
 * it suspends itself when the page is backgrounded, so resume on every use.
 */
function context() {
  if (!ctx) {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * A short percussive blip. Frequencies are deliberately low-mid and the decay
 * is ~70ms: this fires after every card, so anything brighter or longer becomes
 * irritating within a session of a hundred.
 */
function blip({ frequency, duration = 0.07, gain = 0.05, type = 'sine' }) {
  if (!enabled) return;
  const audio = context();
  if (!audio) return;

  try {
    const osc = audio.createOscillator();
    const amp = audio.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, audio.currentTime);
    // Slight downward slide stops it sounding like a alert beep.
    osc.frequency.exponentialRampToValueAtTime(
      frequency * 0.86, audio.currentTime + duration,
    );

    amp.gain.setValueAtTime(0, audio.currentTime);
    amp.gain.linearRampToValueAtTime(gain, audio.currentTime + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);

    osc.connect(amp).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration);
  } catch {
    // Audio is a nicety; never let it break the practice loop.
  }
}

/** Moving to the next card. */
export function next() {
  blip({ frequency: 520 });
}

/** A card you got wrong and will see again this session. */
export function again() {
  blip({ frequency: 300, duration: 0.09, gain: 0.045 });
}

/** Session finished. */
export function complete() {
  blip({ frequency: 620, duration: 0.1, gain: 0.05 });
  setTimeout(() => blip({ frequency: 830, duration: 0.14, gain: 0.045 }), 90);
}
