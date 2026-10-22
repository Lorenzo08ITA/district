export const EPSILON = 1e-8;
export const TAU = Math.PI * 2;
/** Mutable registers: callers allocate them once, then reuse every simulation/frame tick. */
export class Vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v: Readonly<Vec3>): this {
    return this.set(v.x, v.y, v.z);
  }
  add(v: Readonly<Vec3>): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  scale(n: number): this {
    this.x *= n;
    this.y *= n;
    this.z *= n;
    return this;
  }
  addScaled(v: Readonly<Vec3>, n: number): this {
    this.x += v.x * n;
    this.y += v.y * n;
    this.z += v.z * n;
    return this;
  }
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  length(): number {
    return Math.sqrt(this.lengthSquared());
  }
  normalize(): this {
    const n = this.length();
    return n > EPSILON ? this.scale(1 / n) : this.set(0, 0, 0);
  }
}
export class Quaternion {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 1,
  ) {}
  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }
  normalize(): this {
    const n = Math.hypot(this.x, this.y, this.z, this.w);
    if (n < EPSILON) throw new RangeError('Zero quaternion');
    this.x /= n;
    this.y /= n;
    this.z /= n;
    this.w /= n;
    return this;
  }
}
export function dot(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function subtract(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return out.set(a.x - b.x, a.y - b.y, a.z - b.z);
}
export function cross(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  const x = a.y * b.z - a.z * b.y,
    y = a.z * b.x - a.x * b.z,
    z = a.x * b.y - a.y * b.x;
  return out.set(x, y, z);
}
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
export function rotate(
  out: Vec3,
  v: Readonly<Vec3>,
  q: Readonly<Quaternion>,
  inverse = false,
): Vec3 {
  const qx = inverse ? -q.x : q.x,
    qy = inverse ? -q.y : q.y,
    qz = inverse ? -q.z : q.z;
  const tx = 2 * (qy * v.z - qz * v.y),
    ty = 2 * (qz * v.x - qx * v.z),
    tz = 2 * (qx * v.y - qy * v.x);
  return out.set(
    v.x + q.w * tx + qy * tz - qz * ty,
    v.y + q.w * ty + qz * tx - qx * tz,
    v.z + q.w * tz + qx * ty - qy * tx,
  );
}
export class RayHit {
  hit = false;
  distance = Infinity;
  exitDistance = Infinity;
  triangle = -1;
  readonly point = new Vec3();
  readonly normal = new Vec3();
  reset(maxDistance = Infinity): this {
    this.hit = false;
    this.distance = maxDistance;
    this.exitDistance = maxDistance;
    this.triangle = -1;
    this.normal.set(0, 0, 0);
    return this;
  }
}
export class ObbRaycaster {
  private origin = new Vec3();
  private direction = new Vec3();
  private localNormal = new Vec3();
  cast(
    out: RayHit,
    origin: Readonly<Vec3>,
    direction: Readonly<Vec3>,
    center: Readonly<Vec3>,
    half: Readonly<Vec3>,
    orientation: Readonly<Quaternion>,
    maxDistance = 1000,
  ): boolean {
    out.reset(maxDistance);
    subtract(this.origin, origin, center);
    rotate(this.origin, this.origin, orientation, true);
    rotate(this.direction, direction, orientation, true);
    let enter = 0,
      exit = maxDistance,
      nx = 0,
      ny = 0,
      nz = 0;
    for (let axis = 0; axis < 3; axis++) {
      const p = axis === 0 ? this.origin.x : axis === 1 ? this.origin.y : this.origin.z,
        d = axis === 0 ? this.direction.x : axis === 1 ? this.direction.y : this.direction.z,
        h = axis === 0 ? half.x : axis === 1 ? half.y : half.z;
      if (Math.abs(d) < EPSILON) {
        if (p < -h || p > h) return false;
        continue;
      }
      let a = (-h - p) / d,
        b = (h - p) / d,
        sign = -1;
      if (a > b) {
        const swap = a;
        a = b;
        b = swap;
        sign = 1;
      }
      if (a > enter) {
        enter = a;
        nx = axis === 0 ? sign : 0;
        ny = axis === 1 ? sign : 0;
        nz = axis === 2 ? sign : 0;
      }
      exit = Math.min(exit, b);
      if (enter > exit) return false;
    }
    if (exit < 0 || enter > maxDistance) return false;
    out.hit = true;
    out.distance = enter;
    out.exitDistance = exit;
    out.triangle = -1;
    out.point.copy(origin).addScaled(direction, enter);
    this.localNormal.set(nx, ny, nz);
    if (this.localNormal.lengthSquared() < EPSILON)
      out.normal.copy(direction).scale(-1).normalize();
    else rotate(out.normal, this.localNormal, orientation);
    return true;
  }
}
/** Dot-product acceleration intentionally does not clamp momentum accumulated across directions. */
export function accelerate(
  velocity: Vec3,
  wishDir: Readonly<Vec3>,
  wishSpeed: number,
  accel: number,
  dt: number,
): void {
  const add = wishSpeed - (velocity.x * wishDir.x + velocity.z * wishDir.z);
  if (add <= 0) return;
  const speed = Math.min(accel * dt * wishSpeed, add);
  velocity.x += wishDir.x * speed;
  velocity.z += wishDir.z * speed;
}
