// Procedural spatial ambient audio system (no music) using Web Audio API.

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private started = false;
  enabled = true;

  private ensure() {
    if (this.ctx) return;
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
  }

  start() {
    this.ensure();
    if (!this.ctx || this.started) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.started = true;
    this.startWind();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
    return this.enabled;
  }

  private noiseBuffer(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private startWind() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(4);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    this.windFilter = lp;
    const g = ctx.createGain();
    g.gain.value = 0.1;
    this.windGain = g;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master!);
    src.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();
  }

  setWind(intensity: number) {
    if (this.windGain && this.ctx) {
      this.windGain.gain.setTargetAtTime(0.05 + intensity * 0.16, this.ctx.currentTime, 0.4);
    }
    if (this.windFilter && this.ctx) {
      this.windFilter.frequency.setTargetAtTime(300 + intensity * 500, this.ctx.currentTime, 0.6);
    }
  }

  // Chapter-flavoured ambient bed (very subtle)
  setThemeBed(theme: string) {
    if (!this.ctx || !this.windFilter) return;
    const base =
      theme === "forest" ? 320 : theme === "ruins" ? 240 : theme === "factory" ? 520 : theme === "void" ? 180 : 380;
    this.windFilter.frequency.setTargetAtTime(base, this.ctx.currentTime, 1.2);
  }

  footstep() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.12);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 170 + Math.random() * 90;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.11);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + 0.12);
  }

  jump() {
    this.tone(210, 0.09, "sine", 0.1);
  }

  land(force = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 150;
    const g = ctx.createGain();
    const v = Math.min(0.4, 0.11 * force);
    g.gain.setValueAtTime(v, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + 0.2);
  }

  clank() {
    this.tone(680, 0.12, "square", 0.07);
    setTimeout(() => this.tone(420, 0.1, "square", 0.05), 40);
  }

  lever() {
    this.tone(320, 0.08, "sawtooth", 0.08);
    setTimeout(() => this.tone(180, 0.12, "sawtooth", 0.06), 60);
  }

  splash() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.4);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.38);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + 0.4);
  }

  death() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.48);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + 0.5);
  }

  checkpoint() {
    this.tone(520, 0.18, "sine", 0.1);
    setTimeout(() => this.tone(780, 0.22, "sine", 0.09), 120);
  }

  win() {
    this.tone(440, 0.3, "sine", 0.12);
    setTimeout(() => this.tone(660, 0.4, "sine", 0.1), 200);
    setTimeout(() => this.tone(880, 0.6, "sine", 0.08), 420);
  }

  snap() {
    // bear trap
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.15);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + 0.15);
    this.tone(120, 0.12, "square", 0.18);
  }

  creak() {
    // falling log groan
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(90, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.4);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 220;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.connect(bp);
    bp.connect(g);
    g.connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  }

  spark() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.18);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + 0.18);
  }

  private magnetOsc: OscillatorNode | null = null;
  private magnetGain: GainNode | null = null;
  setMagnet(intensity: number) {
    if (!this.ctx || !this.enabled) return;
    if (!this.magnetOsc) {
      this.magnetOsc = this.ctx.createOscillator();
      this.magnetOsc.type = "sine";
      this.magnetOsc.frequency.value = 60;
      this.magnetGain = this.ctx.createGain();
      this.magnetGain.gain.value = 0;
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 240;
      this.magnetOsc.connect(lp);
      lp.connect(this.magnetGain);
      this.magnetGain.connect(this.master!);
      this.magnetOsc.start();
    }
    this.magnetGain!.gain.setTargetAtTime(intensity * 0.12, this.ctx.currentTime, 0.12);
  }

  gravFlip() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.connect(g);
    g.connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
  }

  spider() {
    if (!this.ctx || !this.enabled) return;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (!this.ctx) return;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer(0.05);
        const bp = this.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 3000 + Math.random() * 1500;
        bp.Q.value = 8;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.08, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.05);
        src.connect(bp);
        bp.connect(g);
        g.connect(this.master!);
        src.start();
        src.stop(this.ctx.currentTime + 0.06);
      }, i * 70);
    }
  }

  chapterGong() {
    if (!this.ctx || !this.enabled) return;
    [110, 165, 220].forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.14 - i * 0.03, this.ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 2.2);
        osc.connect(g);
        g.connect(this.master!);
        osc.start();
        osc.stop(this.ctx.currentTime + 2.3);
      }, i * 80);
    });
  }

  private sawOsc: OscillatorNode | null = null;
  private sawGain: GainNode | null = null;
  setSaw(intensity: number) {
    if (!this.ctx || !this.enabled) return;
    if (!this.sawOsc) {
      this.sawOsc = this.ctx.createOscillator();
      this.sawOsc.type = "sawtooth";
      this.sawOsc.frequency.value = 90;
      this.sawGain = this.ctx.createGain();
      this.sawGain.gain.value = 0;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 400;
      this.sawOsc.connect(hp);
      hp.connect(this.sawGain);
      this.sawGain.connect(this.master!);
      this.sawOsc.start();
    }
    this.sawGain!.gain.setTargetAtTime(intensity * 0.06, this.ctx.currentTime, 0.1);
  }

  private conveyorGain: GainNode | null = null;
  private conveyorSrc: AudioBufferSourceNode | null = null;
  setConveyor(intensity: number) {
    if (!this.ctx || !this.enabled) return;
    if (!this.conveyorSrc) {
      this.conveyorSrc = this.ctx.createBufferSource();
      this.conveyorSrc.buffer = this.noiseBuffer(2);
      this.conveyorSrc.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 320;
      bp.Q.value = 2;
      this.conveyorGain = this.ctx.createGain();
      this.conveyorGain.gain.value = 0;
      this.conveyorSrc.connect(bp);
      bp.connect(this.conveyorGain);
      this.conveyorGain.connect(this.master!);
      this.conveyorSrc.start();
    }
    this.conveyorGain!.gain.setTargetAtTime(intensity * 0.08, this.ctx.currentTime, 0.2);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }
}
