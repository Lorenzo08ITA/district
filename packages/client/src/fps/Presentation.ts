import { clamp } from '@district/rts-shared/fps';
/** Timestamped interpolation tolerates worker delivery jitter without delaying mouse aim. */
export class PosePresentation {
  private previous = new Float64Array(24);
  readonly current = new Float64Array(24);
  readonly values = new Float64Array(24);
  private received = 0;
  private previousTime = 0;
  private initialized = false;
  push(value: Float64Array, time: number): boolean {
    const teleport =
      !this.initialized ||
      Math.hypot(
        value[1]! - this.current[1]!,
        value[2]! - this.current[2]!,
        value[3]! - this.current[3]!,
      ) > 3 ||
      value[10]! > 0 !== this.current[10]! > 0;
    if (this.initialized && time <= this.received) return false;
    this.previousTime = teleport ? time - 1000 / 60 : this.received;
    this.previous.set(teleport ? value : this.current);
    this.current.set(value);
    this.received = time;
    this.initialized = true;
    return teleport;
  }
  sample(time: number): Float64Array {
    this.values.set(this.current);
    const t = clamp(
      (time - 1000 / 60 - this.previousTime) / (this.received - this.previousTime),
      0,
      1,
    );
    for (let i = 1; i <= 3; i++)
      this.values[i] = this.previous[i]! + (this.current[i]! - this.previous[i]!) * t;
    this.values[7] = this.previous[7]! + (this.current[7]! - this.previous[7]!) * t;
    return this.values;
  }
}
export class RenderBudget {
  private sum = 0;
  private count = 0;
  private since = 0;
  private fastSince = 0;
  scale: number;
  constructor(
    readonly minimum: number,
    readonly maximum: number,
    initial: number,
  ) {
    this.scale = clamp(initial, minimum, maximum);
  }
  sample(dtMs: number, time: number): boolean {
    if (dtMs < 1 || dtMs > 150) return false;
    this.sum += dtMs;
    this.count++;
    if (!this.since) {
      this.since = time;
      return false;
    }
    if (time - this.since < 1500 || this.count < 20) return false;
    const mean = this.sum / this.count;
    this.sum = this.count = 0;
    this.since = time;
    const before = this.scale;
    if (mean > 22) {
      this.scale = Math.max(this.minimum, this.scale * 0.85);
      this.fastSince = 0;
    } else if (mean < 14) {
      if (!this.fastSince) this.fastSince = time;
      if (time - this.fastSince >= 4500) {
        this.scale = Math.min(this.maximum, this.scale * 1.1);
        this.fastSince = time;
      }
    } else this.fastSince = 0;
    return Math.abs(before - this.scale) > 0.02;
  }
}
