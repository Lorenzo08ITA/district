import { KinematicState, clamp } from '@district/rts-shared/fps';
export interface HistoryPlayer {
  active: boolean;
  hp: number;
  generation: number;
  yaw: number;
  controller: { state: KinematicState };
}
export const BOXES = 6,
  POSE_STRIDE = 60;
/** Center xyz, half xyz and quaternion xyzw for each of the six anatomical OBBs. */
export function writePose(
  out: Float64Array,
  offset: number,
  state: KinematicState,
  yaw: number,
): void {
  const crouch = state.crouched,
    height = crouch ? 0.95 : 1.8,
    sin = Math.sin(yaw),
    cos = Math.cos(yaw),
    qy = -Math.sin(yaw / 2),
    qw = Math.cos(yaw / 2);
  for (let box = 0; box < 6; box++) {
    const o = offset + box * 10;
    let x = 0,
      y = 0,
      z = 0,
      hx = 0,
      hy = 0,
      hz = 0;
    switch (box) {
      case 0:
        y = height - 0.17;
        hx = 0.17;
        hy = 0.17;
        hz = 0.17;
        break;
      case 1:
        y = height * 0.71;
        hx = 0.25;
        hy = height * 0.13;
        hz = 0.16;
        break;
      case 2:
        y = height * 0.49;
        hx = 0.24;
        hy = height * 0.1;
        hz = 0.16;
        break;
      case 3:
      case 4:
        x = box === 3 ? -0.34 : 0.34;
        y = height * 0.67;
        z = -0.03;
        hx = 0.11;
        hy = height * 0.19;
        hz = 0.13;
        break;
      case 5:
        y = height * 0.23;
        hx = 0.24;
        hy = height * 0.23;
        hz = 0.15;
        break;
    }
    out[o] = state.position.x + x * cos - z * sin;
    out[o + 1] = state.position.y + y;
    out[o + 2] = state.position.z + x * sin + z * cos;
    out[o + 3] = hx;
    out[o + 4] = hy;
    out[o + 5] = hz;
    out[o + 6] = 0;
    out[o + 7] = qy;
    out[o + 8] = 0;
    out[o + 9] = qw;
  }
}
export class WorldHistoryBuffer {
  private poses: Float64Array;
  private life: Uint32Array;
  private alive: Uint8Array;
  private ticks = new Int32Array(64).fill(-1);
  latest = -1;
  constructor(readonly capacity: number) {
    this.poses = new Float64Array(64 * capacity * POSE_STRIDE);
    this.life = new Uint32Array(64 * capacity);
    this.alive = new Uint8Array(64 * capacity);
  }
  record(tick: number, players: readonly HistoryPlayer[]): void {
    const slot = tick & 63;
    this.ticks[slot] = tick;
    this.latest = tick;
    for (let id = 0; id < this.capacity; id++) {
      const player = players[id]!,
        entry = slot * this.capacity + id;
      this.alive[entry] = player.active && player.hp > 0 ? 1 : 0;
      this.life[entry] = player.generation;
      if (this.alive[entry])
        writePose(this.poses, entry * POSE_STRIDE, player.controller.state, player.yaw);
    }
  }
  sample(out: Float64Array, id: number, time: number, generation: number): boolean {
    if (this.latest < 0 || id < 0 || id >= this.capacity) return false;
    const t = clamp(time, Math.max(0, this.latest - 63), this.latest),
      a = Math.floor(t),
      b = Math.min(this.latest, a + 1),
      fraction = t - a,
      ai = (a & 63) * this.capacity + id,
      bi = (b & 63) * this.capacity + id;
    if (
      this.ticks[a & 63] !== a ||
      this.ticks[b & 63] !== b ||
      !this.alive[ai] ||
      !this.alive[bi] ||
      this.life[ai] !== generation ||
      this.life[bi] !== generation
    )
      return false;
    for (let box = 0; box < 6; box++) {
      const o = box * 10,
        A = ai * POSE_STRIDE + o,
        B = bi * POSE_STRIDE + o;
      for (let n = 0; n < 6; n++)
        out[o + n] = this.poses[A + n]! + (this.poses[B + n]! - this.poses[A + n]!) * fraction;
      let sign = 0;
      for (let n = 6; n < 10; n++) sign += this.poses[A + n]! * this.poses[B + n]!;
      const flip = sign < 0 ? -1 : 1;
      let norm = 0;
      for (let n = 6; n < 10; n++) {
        const q = this.poses[A + n]! + (this.poses[B + n]! * flip - this.poses[A + n]!) * fraction;
        out[o + n] = q;
        norm += q * q;
      }
      const inverse = 1 / Math.sqrt(norm);
      for (let n = 6; n < 10; n++) out[o + n] = out[o + n]! * inverse;
    }
    return true;
  }
}
