export class ProceduralAudioEngine {
  readonly context: AudioContext;
  private noise: AudioBuffer;
  private master: GainNode;
  private compression: DynamicsCompressorNode;
  private voices = 0;
  muted = false;
  private curve = new Float32Array(512);
  constructor() {
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.36;
    this.compression = this.context.createDynamicsCompressor();
    this.compression.threshold.value = -12;
    this.compression.ratio.value = 5;
    this.master.connect(this.compression);
    this.compression.connect(this.context.destination);
    const rate = this.context.sampleRate;
    this.noise = this.context.createBuffer(1, rate, rate);
    const data = this.noise.getChannelData(0);
    let seed = 918273,
      low = 0;
    for (let i = 0; i < rate; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const white = (seed >>> 0) / 2147483648 - 1;
      low = 0.97 * low + 0.03 * white;
      data[i] = white * 0.65 + low * 2.5;
    }
    for (let i = 0; i < this.curve.length; i++) {
      const x = (i / (this.curve.length - 1)) * 2 - 1;
      this.curve[i] = Math.tanh(x * 3);
    }
  }
  async resume(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume();
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.36, this.context.currentTime, 0.02);
  }
  private output(x: number, y: number, z: number, spatial: boolean): AudioNode {
    if (!spatial) return this.master;
    const pan = this.context.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = 3;
    pan.maxDistance = 100;
    pan.rolloffFactor = 1.3;
    pan.positionX.value = x;
    pan.positionY.value = y;
    pan.positionZ.value = z;
    pan.connect(this.master);
    return pan;
  }
  shot(weapon: number, x = 0, y = 0, z = 0, spatial = false): void {
    if (this.muted || this.context.state !== 'running' || this.voices >= 24) return;
    this.voices++;
    const c = this.context,
      now = c.currentTime,
      output = this.output(x, y, z, spatial),
      noise = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      gain = c.createGain(),
      bass = c.createOscillator(),
      bassGain = c.createGain(),
      metal = c.createOscillator(),
      metalGain = c.createGain();
    const length = weapon === 1 ? 0.18 : weapon === 3 ? 0.14 : weapon === 5 ? 0.06 : 0.085;
    noise.buffer = this.noise;
    noise.playbackRate.value = weapon === 2 ? 1.35 : weapon === 1 ? 0.8 : 1;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(
      weapon === 1 ? 900 : weapon === 2 ? 2400 : weapon === 3 ? 650 : 1700,
      now,
    );
    filter.frequency.exponentialRampToValueAtTime(180, now + length);
    filter.Q.value = 0.6;
    gain.gain.setValueAtTime(weapon === 3 ? 1.1 : 0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    bass.type = 'triangle';
    bass.frequency.setValueAtTime(weapon === 1 ? 95 : 140, now);
    bass.frequency.exponentialRampToValueAtTime(35, now + length);
    bassGain.gain.setValueAtTime(0.6, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + length);
    bass.connect(bassGain);
    bassGain.connect(output);
    metal.type = 'square';
    metal.frequency.value = weapon === 4 ? 2300 : 3700;
    metalGain.gain.setValueAtTime(0.08, now);
    metalGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
    metal.connect(metalGain);
    metalGain.connect(output);
    noise.start(now, 0, length);
    bass.start(now);
    metal.start(now);
    bass.stop(now + length);
    metal.stop(now + 0.03);
    noise.onended = () => {
      this.voices--;
      noise.disconnect();
      filter.disconnect();
      gain.disconnect();
      bass.disconnect();
      bassGain.disconnect();
      metal.disconnect();
      metalGain.disconnect();
      if (output !== this.master) output.disconnect();
    };
  }
  hit(headshot: boolean, kill: boolean): void {
    if (this.muted || this.context.state !== 'running') return;
    const c = this.context,
      now = c.currentTime;
    for (let i = 0; i < 2; i++) {
      const oscillator = c.createOscillator(),
        gain = c.createGain();
      oscillator.type = headshot || kill ? 'sawtooth' : 'triangle';
      const frequency = headshot || kill ? 880 * (i + 1) : i ? 2400 : 1800;
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(
        frequency * (headshot || kill ? 1.7 : 1.05),
        now + 0.035,
      );
      gain.gain.setValueAtTime(headshot || kill ? 0.13 : 0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      if (headshot || kill) {
        const shaper = c.createWaveShaper();
        shaper.curve = this.curve;
        oscillator.connect(shaper);
        shaper.connect(gain);
        oscillator.onended = () => {
          oscillator.disconnect();
          shaper.disconnect();
          gain.disconnect();
        };
      } else {
        oscillator.connect(gain);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      }
      gain.connect(this.master);
      oscillator.start();
      oscillator.stop(now + 0.065);
    }
  }
  foot(x: number, y: number, z: number, spatial: boolean): void {
    if (this.muted || this.context.state !== 'running' || this.voices >= 24) return;
    this.voices++;
    const c = this.context,
      now = c.currentTime,
      source = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      gain = c.createGain(),
      output = this.output(x, y, z, spatial);
    source.buffer = this.noise;
    filter.type = 'lowpass';
    filter.frequency.value = 330;
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    source.start(now, 0, 0.08);
    source.onended = () => {
      this.voices--;
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      if (output !== this.master) output.disconnect();
    };
  }
  casing(): void {
    if (this.muted || this.context.state !== 'running') return;
    const c = this.context,
      now = c.currentTime,
      osc = c.createOscillator(),
      gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(3200, now);
    osc.frequency.exponentialRampToValueAtTime(1900, now + 0.04);
    gain.gain.setValueAtTime(0.025, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(now + 0.065);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  listener(x: number, y: number, z: number, yaw: number, pitch: number): void {
    if (this.context.state !== 'running') return;
    const l = this.context.listener,
      time = this.context.currentTime;
    l.positionX.setValueAtTime(x, time);
    l.positionY.setValueAtTime(y, time);
    l.positionZ.setValueAtTime(z, time);
    l.forwardX.setValueAtTime(Math.sin(yaw) * Math.cos(pitch), time);
    l.forwardY.setValueAtTime(Math.sin(pitch), time);
    l.forwardZ.setValueAtTime(-Math.cos(yaw) * Math.cos(pitch), time);
    l.upX.setValueAtTime(0, time);
    l.upY.setValueAtTime(1, time);
    l.upZ.setValueAtTime(0, time);
  }
  async destroy(): Promise<void> {
    await this.context.close();
  }
}
