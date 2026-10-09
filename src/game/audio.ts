// NEON STRIKE 3D - procedural WebAudio SFX (no external files => works offline)
export class AudioFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 0.7;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  resume() { this.ensure(); }

  private noiseBuffer(ctx: AudioContext, dur: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private env(ctx: AudioContext, node: AudioNode, peak: number, attack: number, decay: number): GainNode {
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g);
    g.connect(this.master!);
    return g;
  }

  /** short filtered noise burst */
  private burst(peak: number, dur: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ensure(); if (!ctx || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, dur + 0.05);
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    src.connect(filt);
    this.env(ctx, filt, peak, 0.002, dur);
    src.start();
    src.stop(ctx.currentTime + dur + 0.06);
  }

  private tone(freq: number, peak: number, dur: number, type: OscillatorType = 'square', slideTo?: number) {
    const ctx = this.ensure(); if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    this.env(ctx, osc, peak, 0.004, dur);
    osc.start();
    osc.stop(t + dur + 0.05);
  }

  shoot() { this.burst(0.5, 0.09, 900, 0.8); this.tone(160, 0.25, 0.07, 'square', 60); }
  remoteShoot() { this.burst(0.18, 0.07, 700, 0.8); }
  botShoot() { this.burst(0.16, 0.07, 520, 0.9); }
  reload() { this.tone(520, 0.12, 0.05, 'square'); setTimeout(() => this.tone(720, 0.12, 0.05, 'square'), 350); setTimeout(() => this.burst(0.2, 0.04, 1400, 2), 1100); }
  hit() { this.tone(1300, 0.22, 0.05, 'triangle', 900); }
  headshot() { this.tone(1750, 0.25, 0.07, 'triangle', 1150); }
  hurt() { this.burst(0.35, 0.14, 220, 0.7, 'lowpass'); this.tone(90, 0.2, 0.12, 'sawtooth', 55); }
  kill() { this.tone(880, 0.2, 0.08, 'triangle'); setTimeout(() => this.tone(1320, 0.2, 0.1, 'triangle'), 80); }
  death() { this.tone(300, 0.3, 0.5, 'sawtooth', 60); this.burst(0.3, 0.3, 180, 0.6, 'lowpass'); }
  jump() { this.tone(240, 0.08, 0.08, 'sine', 340); }
  land() { this.burst(0.14, 0.06, 300, 0.7, 'lowpass'); }
  step() { this.burst(0.055, 0.045, 340 + Math.random() * 120, 0.6, 'lowpass'); }
  spawnFx() { this.tone(440, 0.15, 0.12, 'sine', 880); setTimeout(() => this.tone(660, 0.12, 0.14, 'sine', 1320), 90); }
  ui() { this.tone(600, 0.1, 0.045, 'square'); }
  countdown() { this.tone(760, 0.18, 0.1, 'square'); }
  matchEnd() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, 0.22, 'triangle'), i * 130)); }
  empty() { this.tone(220, 0.1, 0.05, 'square', 180); }
  weaponSwitch() { this.burst(0.14, 0.05, 1100, 1.4); setTimeout(() => this.tone(340, 0.07, 0.05, 'square'), 60); }
  waveStart() { this.tone(196, 0.35, 0.3, 'sawtooth', 98); setTimeout(() => this.tone(262, 0.3, 0.25, 'sawtooth', 131), 260); }
}
