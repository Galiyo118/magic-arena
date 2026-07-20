// ─── SOUND EFFECTS ───────────────────────────────────────────
// All sounds are synthesized with WebAudio at runtime, same idea as
// the runtime generated sprites: no audio files in the repo.

const SFX = {
  ctx: null,
  muted: false,
  masterGain: null,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.35;
    this.masterGain.connect(this.ctx.destination);
  },

  resume() {
    // Browsers suspend audio until a user gesture
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  },

  // Short helper: play an oscillator sweep
  _tone(type, startFreq, endFreq, duration, volume = 1, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + duration);
  },

  // White noise burst, used for impacts
  _noise(duration, volume = 1, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(gain);
    gain.connect(this.masterGain);
    src.start(t0);
  },

  shoot(type) {
    // Slightly different pitch per projectile type
    const base = { fireball: 300, ice_shard: 500, chain_bolt: 220, hex_slash: 150, acid_flask: 260, shadow_bind: 180 }[type] || 300;
    this._tone("square", base, base * 0.4, 0.09, 0.35);
  },

  hit() {
    this._noise(0.08, 0.5);
    this._tone("sawtooth", 200, 80, 0.1, 0.3);
  },

  kill() {
    this._tone("square", 440, 880, 0.1, 0.4);
    this._tone("square", 550, 1100, 0.12, 0.4, 0.08);
    this._noise(0.2, 0.4);
  },

  death() {
    this._tone("sawtooth", 300, 40, 0.5, 0.5);
    this._noise(0.3, 0.5);
  },

  dash() {
    this._tone("sine", 700, 1400, 0.12, 0.25);
  },

  special() {
    this._tone("sawtooth", 120, 500, 0.25, 0.4);
  },

  victory() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this._tone("square", f, f, 0.18, 0.4, i * 0.14));
  },

  defeat() {
    const notes = [400, 350, 300, 200];
    notes.forEach((f, i) => this._tone("sawtooth", f, f * 0.9, 0.22, 0.35, i * 0.16));
  },
};
