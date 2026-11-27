"use client";

/**
 * Three tiny generated sounds, muted by default (docs/design.md).
 * No audio files: a few oscillator notes through the Web Audio API.
 */
const KEY = "experiment-doctor.sound";
let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode */
  }
}

function tone(freq: number, startOffset: number, length: number, type: OscillatorType = "sine", gain = 0.06) {
  if (!ctx) ctx = new AudioContext();
  const t = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(gain, t + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

export const sounds = {
  /** Verification starts: soft 80ms click. */
  verify() {
    if (soundEnabled()) tone(880, 0, 0.08, "triangle", 0.04);
  },
  /** Verified repair: two ascending tones, 250ms total. */
  success() {
    if (!soundEnabled()) return;
    tone(660, 0, 0.12);
    tone(990, 0.12, 0.13);
  },
  /** Time is up: soft descending tone, 180ms. */
  timeout() {
    if (!soundEnabled()) return;
    if (!ctx) ctx = new AudioContext();
    tone(440, 0, 0.09, "sine", 0.05);
    tone(330, 0.09, 0.09, "sine", 0.05);
  },
};
