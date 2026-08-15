import type { PlayerSettings } from '../core/types';

export type SoundId =
  | 'ui-tap'
  | 'take-timber'
  | 'place-timber'
  | 'work-hammer'
  | 'saw'
  | 'bell'
  | 'ballista-fire'
  | 'gate-impact'
  | 'fracture'
  | 'objective'
  | 'stabilise'
  | 'defeat';

interface SoundSpec {
  /** Family: timber, stone, metal, cloth or time (design document section 19). */
  family: 'timber' | 'stone' | 'metal' | 'cloth' | 'time';
  frequency: number;
  durationMs: number;
  type: OscillatorType;
  gain: number;
  /** Noise burst mixed in, for impacts and saw strokes. */
  noise?: number;
  /** Second partial, used to give bells and chimes their tail. */
  overtone?: number;
  sweepTo?: number;
}

const SOUNDS: Record<SoundId, SoundSpec> = {
  'ui-tap': { family: 'cloth', frequency: 520, durationMs: 60, type: 'sine', gain: 0.16 },
  'take-timber': { family: 'timber', frequency: 240, durationMs: 110, type: 'triangle', gain: 0.3, noise: 0.25 },
  'place-timber': { family: 'timber', frequency: 180, durationMs: 140, type: 'triangle', gain: 0.34, noise: 0.3 },
  'work-hammer': { family: 'timber', frequency: 150, durationMs: 90, type: 'square', gain: 0.26, noise: 0.4 },
  saw: { family: 'timber', frequency: 320, durationMs: 220, type: 'sawtooth', gain: 0.16, noise: 0.5 },
  bell: { family: 'metal', frequency: 528, durationMs: 1600, type: 'sine', gain: 0.34, overtone: 1.503 },
  'ballista-fire': {
    family: 'metal',
    frequency: 420,
    durationMs: 320,
    type: 'sawtooth',
    gain: 0.34,
    noise: 0.45,
    sweepTo: 120,
  },
  'gate-impact': { family: 'stone', frequency: 90, durationMs: 300, type: 'square', gain: 0.42, noise: 0.6 },
  fracture: { family: 'time', frequency: 760, durationMs: 520, type: 'sine', gain: 0.26, overtone: 1.41, sweepTo: 520 },
  objective: { family: 'metal', frequency: 660, durationMs: 260, type: 'sine', gain: 0.24, overtone: 1.5 },
  stabilise: { family: 'metal', frequency: 396, durationMs: 1800, type: 'sine', gain: 0.36, overtone: 1.5 },
  defeat: { family: 'time', frequency: 220, durationMs: 900, type: 'sine', gain: 0.3, sweepTo: 110 },
};

/** Small pitch variation stops repeated work sounds becoming a machine gun. */
const VARIATION_CENTS = [0, 28, -22, 41, -37];

/**
 * Procedural audio.
 *
 * Synthesising rather than shipping files keeps the build free of binary
 * assets and guarantees there is never a silent missing-asset failure. The
 * context is only created on a genuine user gesture and is resumed after an
 * app switch, which is what browsers require (design document section 19).
 */
export class AudioService {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicTimer: number | null = null;
  private variationIndex = 0;
  private noiseBuffer: AudioBuffer | null = null;
  private musicIntensity = 0;

  constructor(private settings: PlayerSettings) {}

  setSettings(settings: PlayerSettings): void {
    this.settings = settings;
    if (this.effectsBus) this.effectsBus.gain.value = settings.effectsVolume;
    if (this.musicBus) this.musicBus.gain.value = settings.musicVolume * 0.32;
  }

  /** Must be called from inside a real pointer or key event. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const context = new Ctor();
      this.context = context;

      this.master = context.createGain();
      this.master.gain.value = 1;
      this.master.connect(context.destination);

      this.effectsBus = context.createGain();
      this.effectsBus.gain.value = this.settings.effectsVolume;
      this.effectsBus.connect(this.master);

      this.musicBus = context.createGain();
      this.musicBus.gain.value = this.settings.musicVolume * 0.32;
      this.musicBus.connect(this.master);

      this.noiseBuffer = this.makeNoiseBuffer(context);
      void context.resume();
    } catch {
      // Audio is a nicety; the game stays fully playable without it.
      this.context = null;
    }
  }

  /** Browsers suspend the context on app switch; call this on resume. */
  resume(): void {
    if (this.context?.state === 'suspended') void this.context.resume();
  }

  suspend(): void {
    if (this.context?.state === 'running') void this.context.suspend();
  }

  get isReady(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  /**
   * @param quiet Echo actions use quieter versions with a crystalline tail so
   *              five agents working at once do not become audio clutter.
   */
  play(id: SoundId, quiet = false): void {
    const context = this.context;
    const bus = this.effectsBus;
    if (!context || !bus || context.state !== 'running') return;

    const spec = SOUNDS[id];
    const now = context.currentTime;
    const duration = spec.durationMs / 1000;
    const cents = VARIATION_CENTS[this.variationIndex % VARIATION_CENTS.length] ?? 0;
    this.variationIndex += 1;
    const frequency = spec.frequency * Math.pow(2, cents / 1200);
    const level = spec.gain * (quiet ? 0.45 : 1);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(level, now + Math.min(0.02, duration * 0.2));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    envelope.connect(bus);

    const osc = context.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(frequency, now);
    if (spec.sweepTo) osc.frequency.exponentialRampToValueAtTime(spec.sweepTo, now + duration);
    osc.connect(envelope);
    osc.start(now);
    osc.stop(now + duration);

    if (spec.overtone) {
      const partial = context.createOscillator();
      partial.type = 'sine';
      partial.frequency.setValueAtTime(frequency * spec.overtone, now);
      const partialGain = context.createGain();
      partialGain.gain.setValueAtTime(level * (quiet ? 0.2 : 0.34), now);
      partialGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      partial.connect(partialGain).connect(bus);
      partial.start(now);
      partial.stop(now + duration);
    }

    if (spec.noise && this.noiseBuffer) {
      const source = context.createBufferSource();
      source.buffer = this.noiseBuffer;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = frequency * 2;
      filter.Q.value = 0.8;
      const noiseGain = context.createGain();
      noiseGain.gain.setValueAtTime(level * spec.noise, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.7);
      source.connect(filter).connect(noiseGain).connect(bus);
      source.start(now);
      source.stop(now + duration);
    }
  }

  /**
   * Layered loop music: each additional Echo adds a voice, and the final ten
   * seconds tighten the pulse without becoming stressful noise.
   */
  startLoopMusic(intensity: number): void {
    this.musicIntensity = intensity;
    if (!this.context || !this.musicBus || this.musicTimer !== null) return;

    // A slow pulse loosely matched to the second hand.
    const beat = () => {
      this.pulseNote(146.83, 0.4);
      if (this.musicIntensity >= 1) this.pulseNote(220, 0.24);
      if (this.musicIntensity >= 2) this.pulseNote(293.66, 0.18);
      if (this.musicIntensity >= 3) this.pulseNote(349.23, 0.14);
    };
    beat();
    this.musicTimer = window.setInterval(beat, 2000);
  }

  setMusicIntensity(intensity: number): void {
    this.musicIntensity = intensity;
  }

  stopLoopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private pulseNote(frequency: number, gain: number): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus || context.state !== 'running') return;

    const now = context.currentTime;
    const osc = context.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(gain, now + 0.08);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    osc.connect(envelope).connect(bus);
    osc.start(now);
    osc.stop(now + 1.5);
  }

  private makeNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * 0.5);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    // A fixed pseudo-random fill: deterministic, and never calls Math.random
    // where a rule could accidentally depend on it.
    let state = 0x2f6e2b1;
    for (let i = 0; i < length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[i] = (state / 2147483648 - 1) * 0.6;
    }
    return buffer;
  }

  /** Haptics, used sparingly and only where supported. */
  vibrate(pattern: number | number[]): void {
    if (!this.settings.hapticsEnabled) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* unsupported; ignore */
    }
  }

  dispose(): void {
    this.stopLoopMusic();
    try {
      void this.context?.close();
    } catch {
      /* already closed */
    }
    this.context = null;
    this.master = null;
    this.effectsBus = null;
    this.musicBus = null;
  }
}
