import { Vec3 } from '@district/rts-shared/fps';
/** Exact integration for a constant target during each frame, stable at varying render rates. */
export class SecondOrderSpring3D {
  readonly position = new Vec3();
  readonly velocity = new Vec3();
  readonly target = new Vec3();
  constructor(
    readonly frequency = 12,
    readonly damping = 0.8,
  ) {
    if (frequency <= 0 || damping < 0) throw new RangeError('Invalid spring');
  }
  impulse(x: number, y: number, z: number): void {
    this.velocity.x += x;
    this.velocity.y += y;
    this.velocity.z += z;
  }
  update(dt: number): void {
    const w = this.frequency * Math.PI * 2,
      z = this.damping;
    dt = Math.min(0.1, Math.max(0, dt));
    for (let axis = 0; axis < 3; axis++) {
      const p = axis === 0 ? this.position.x : axis === 1 ? this.position.y : this.position.z,
        v = axis === 0 ? this.velocity.x : axis === 1 ? this.velocity.y : this.velocity.z,
        target = axis === 0 ? this.target.x : axis === 1 ? this.target.y : this.target.z,
        x = p - target;
      let next = 0,
        speed = 0;
      if (z < 1) {
        const wd = w * Math.sqrt(1 - z * z),
          e = Math.exp(-z * w * dt),
          c = Math.cos(wd * dt),
          s = Math.sin(wd * dt);
        next = e * (x * c + ((v + z * w * x) / wd) * s);
        speed = e * (v * c - ((z * w * v + w * w * x) / wd) * s);
      } else if (Math.abs(z - 1) < 1e-6) {
        const e = Math.exp(-w * dt),
          a = v + w * x;
        next = (x + a * dt) * e;
        speed = (v - w * a * dt) * e;
      } else {
        const root = Math.sqrt(z * z - 1),
          a = -w * (z - root),
          b = -w * (z + root),
          c = (v - b * x) / (a - b),
          d = x - c;
        next = c * Math.exp(a * dt) + d * Math.exp(b * dt);
        speed = c * a * Math.exp(a * dt) + d * b * Math.exp(b * dt);
      }
      if (axis === 0) {
        this.position.x = target + next;
        this.velocity.x = speed;
      } else if (axis === 1) {
        this.position.y = target + next;
        this.velocity.y = speed;
      } else {
        this.position.z = target + next;
        this.velocity.z = speed;
      }
    }
  }
  reset(): void {
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.target.set(0, 0, 0);
  }
}
