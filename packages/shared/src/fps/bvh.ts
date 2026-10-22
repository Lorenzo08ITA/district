import { Vec3, RayHit, EPSILON, dot, subtract, cross } from './math.js';
export class CapsuleContact {
  distance = Infinity;
  readonly capsulePoint = new Vec3();
  readonly trianglePoint = new Vec3();
  readonly normal = new Vec3();
}
export class SweepHit {
  hit = false;
  fraction = 1;
  triangle = -1;
  readonly normal = new Vec3();
  reset(): this {
    this.hit = false;
    this.fraction = 1;
    this.triangle = -1;
    this.normal.set(0, 0, 0);
    return this;
  }
}
/** Scratch-owned analytic closest-feature tests, including capsule/triangle edges and faces. */
export class CapsuleTriangle {
  private pointDelta = new Vec3();
  private a = new Vec3();
  private b = new Vec3();
  private c = new Vec3();
  private p = new Vec3();
  private q = new Vec3();
  private ab = new Vec3();
  private ac = new Vec3();
  private ap = new Vec3();
  private temporary = new Vec3();
  private closest = new Vec3();
  private edgePoint = new Vec3();
  private segmentPoint = new Vec3();
  private normal = new Vec3();
  private keep(out: CapsuleContact, p: Vec3, q: Vec3) {
    const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2;
    if (d < out.distance) {
      out.distance = d;
      out.capsulePoint.copy(p);
      out.trianglePoint.copy(q);
    }
  }
  private closestPoint(out: Vec3, p: Vec3, a: Vec3, b: Vec3, c: Vec3) {
    subtract(this.ab, b, a);
    subtract(this.ac, c, a);
    subtract(this.ap, p, a);
    const d1 = dot(this.ab, this.ap),
      d2 = dot(this.ac, this.ap);
    if (d1 <= 0 && d2 <= 0) {
      out.copy(a);
      return;
    }
    subtract(this.pointDelta, p, b);
    const d3 = dot(this.ab, this.pointDelta),
      d4 = dot(this.ac, this.pointDelta);
    if (d3 >= 0 && d4 <= d3) {
      out.copy(b);
      return;
    }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      out.copy(a).addScaled(this.ab, d1 / (d1 - d3));
      return;
    }
    subtract(this.pointDelta, p, c);
    const d5 = dot(this.ab, this.pointDelta),
      d6 = dot(this.ac, this.pointDelta);
    if (d6 >= 0 && d5 <= d6) {
      out.copy(c);
      return;
    }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      out.copy(a).addScaled(this.ac, d2 / (d2 - d6));
      return;
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
      out.set(b.x + (c.x - b.x) * t, b.y + (c.y - b.y) * t, b.z + (c.z - b.z) * t);
      return;
    }
    const inv = 1 / (va + vb + vc);
    out
      .copy(a)
      .addScaled(this.ab, vb * inv)
      .addScaled(this.ac, vc * inv);
  }
  private edge(out: CapsuleContact, a: Vec3, b: Vec3) {
    const ux = this.q.x - this.p.x,
      uy = this.q.y - this.p.y,
      uz = this.q.z - this.p.z,
      vx = b.x - a.x,
      vy = b.y - a.y,
      vz = b.z - a.z,
      wx = this.p.x - a.x,
      wy = this.p.y - a.y,
      wz = this.p.z - a.z;
    const aa = ux * ux + uy * uy + uz * uz,
      bb = ux * vx + uy * vy + uz * vz,
      cc = vx * vx + vy * vy + vz * vz,
      dd = ux * wx + uy * wy + uz * wz,
      ee = vx * wx + vy * wy + vz * wz;
    let s = 0,
      t = 0;
    if (aa < EPSILON) t = Math.max(0, Math.min(1, ee / cc));
    else {
      const denominator = aa * cc - bb * bb;
      s = denominator > EPSILON ? Math.max(0, Math.min(1, (bb * ee - cc * dd) / denominator)) : 0;
      t = (bb * s + ee) / cc;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -dd / aa));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (bb - dd) / aa));
      }
    }
    this.segmentPoint.set(this.p.x + ux * s, this.p.y + uy * s, this.p.z + uz * s);
    this.edgePoint.set(a.x + vx * t, a.y + vy * t, a.z + vz * t);
    this.keep(out, this.segmentPoint, this.edgePoint);
  }
  distance(
    out: CapsuleContact,
    triangles: Float64Array,
    triangle: number,
    feet: Readonly<Vec3>,
    height: number,
    radius: number,
  ): number {
    const i = triangle * 9;
    this.a.set(triangles[i]!, triangles[i + 1]!, triangles[i + 2]!);
    this.b.set(triangles[i + 3]!, triangles[i + 4]!, triangles[i + 5]!);
    this.c.set(triangles[i + 6]!, triangles[i + 7]!, triangles[i + 8]!);
    this.p.set(feet.x, feet.y + radius, feet.z);
    this.q.set(feet.x, feet.y + height - radius, feet.z);
    out.distance = Infinity;
    subtract(this.ab, this.b, this.a);
    subtract(this.ac, this.c, this.a);
    cross(this.normal, this.ab, this.ac).normalize();
    const denominator = this.normal.y * (this.q.y - this.p.y);
    if (Math.abs(denominator) > EPSILON) {
      const t =
        ((this.a.x - this.p.x) * this.normal.x +
          (this.a.y - this.p.y) * this.normal.y +
          (this.a.z - this.p.z) * this.normal.z) /
        denominator;
      if (t >= 0 && t <= 1) {
        this.temporary.copy(this.p);
        this.temporary.y += (this.q.y - this.p.y) * t;
        this.closestPoint(this.closest, this.temporary, this.a, this.b, this.c);
        if (
          (this.closest.x - this.temporary.x) ** 2 +
            (this.closest.y - this.temporary.y) ** 2 +
            (this.closest.z - this.temporary.z) ** 2 <
          1e-12
        ) {
          out.distance = 0;
          out.capsulePoint.copy(this.temporary);
          out.trianglePoint.copy(this.closest);
          out.normal.copy(this.normal);
          return 0;
        }
      }
    }
    this.closestPoint(this.closest, this.p, this.a, this.b, this.c);
    this.keep(out, this.p, this.closest);
    this.closestPoint(this.closest, this.q, this.a, this.b, this.c);
    this.keep(out, this.q, this.closest);
    this.edge(out, this.a, this.b);
    this.edge(out, this.b, this.c);
    this.edge(out, this.c, this.a);
    out.distance = Math.sqrt(out.distance);
    if (out.distance > EPSILON)
      subtract(out.normal, out.capsulePoint, out.trianglePoint).scale(1 / out.distance);
    else out.normal.copy(this.normal);
    return out.distance;
  }
}
/** Balanced static triangle BVH. Construction allocates; queries/sweeps/rays use fixed scratch storage. */
export class StaticWorld {
  readonly triangles: Float64Array;
  readonly triangleCount: number;
  private order: Uint32Array;
  private bounds: Float64Array;
  private left: Int32Array;
  private right: Int32Array;
  private starts: Uint32Array;
  private counts: Uint32Array;
  private nodes = 0;
  private stack: Int32Array;
  private candidates: Uint32Array;
  private calculator = new CapsuleTriangle();
  private contact = new CapsuleContact();
  private position = new Vec3();
  private a = new Vec3();
  private b = new Vec3();
  private c = new Vec3();
  private e1 = new Vec3();
  private e2 = new Vec3();
  private p = new Vec3();
  private t = new Vec3();
  private q = new Vec3();
  constructor(positions: ArrayLike<number>) {
    if (positions.length % 9 !== 0) throw new RangeError('Triangles must contain nine coordinates');
    this.triangles = Float64Array.from(positions);
    this.triangleCount = positions.length / 9;
    if (this.triangleCount > 1000000) throw new RangeError('World triangle limit');
    for (const value of this.triangles)
      if (!Number.isFinite(value)) throw new RangeError('Invalid world coordinate');
    const capacity = Math.max(1, this.triangleCount * 2);
    this.order = Uint32Array.from({ length: this.triangleCount }, (_, i) => i);
    this.bounds = new Float64Array(capacity * 6);
    this.left = new Int32Array(capacity).fill(-1);
    this.right = new Int32Array(capacity).fill(-1);
    this.starts = new Uint32Array(capacity);
    this.counts = new Uint32Array(capacity);
    this.stack = new Int32Array(capacity);
    this.candidates = new Uint32Array(this.triangleCount);
    for (let i = 0; i < this.triangleCount; i++) {
      const o = i * 9;
      this.e1.set(
        this.triangles[o + 3]! - this.triangles[o]!,
        this.triangles[o + 4]! - this.triangles[o + 1]!,
        this.triangles[o + 5]! - this.triangles[o + 2]!,
      );
      this.e2.set(
        this.triangles[o + 6]! - this.triangles[o]!,
        this.triangles[o + 7]! - this.triangles[o + 1]!,
        this.triangles[o + 8]! - this.triangles[o + 2]!,
      );
      if (cross(this.q, this.e1, this.e2).lengthSquared() < 1e-16)
        throw new RangeError('Degenerate world triangle');
    }
    if (this.triangleCount) this.build(0, this.triangleCount);
  }
  private build(start: number, count: number): number {
    const node = this.nodes++,
      offset = node * 6;
    this.bounds[offset] = this.bounds[offset + 1] = this.bounds[offset + 2] = Infinity;
    this.bounds[offset + 3] = this.bounds[offset + 4] = this.bounds[offset + 5] = -Infinity;
    for (let i = start; i < start + count; i++) {
      const t = this.order[i]! * 9;
      for (let v = 0; v < 3; v++)
        for (let axis = 0; axis < 3; axis++) {
          const value = this.triangles[t + v * 3 + axis]!;
          this.bounds[offset + axis] = Math.min(this.bounds[offset + axis]!, value);
          this.bounds[offset + 3 + axis] = Math.max(this.bounds[offset + 3 + axis]!, value);
        }
    }
    if (count <= 6) {
      this.starts[node] = start;
      this.counts[node] = count;
      return node;
    }
    let axis = 0;
    for (let n = 1; n < 3; n++)
      if (
        this.bounds[offset + 3 + n]! - this.bounds[offset + n]! >
        this.bounds[offset + 3 + axis]! - this.bounds[offset + axis]!
      )
        axis = n;
    const sorted = Array.from(this.order.subarray(start, start + count));
    sorted.sort(
      (a, b) =>
        this.triangles[a * 9 + axis]! +
          this.triangles[a * 9 + 3 + axis]! +
          this.triangles[a * 9 + 6 + axis]! -
          (this.triangles[b * 9 + axis]! +
            this.triangles[b * 9 + 3 + axis]! +
            this.triangles[b * 9 + 6 + axis]!) || a - b,
    );
    this.order.set(sorted, start);
    const half = count >> 1;
    this.left[node] = this.build(start, half);
    this.right[node] = this.build(start + half, count - half);
    return node;
  }
  triangleNormal(out: Vec3, triangle: number): Vec3 {
    const i = triangle * 9;
    this.e1.set(
      this.triangles[i + 3]! - this.triangles[i]!,
      this.triangles[i + 4]! - this.triangles[i + 1]!,
      this.triangles[i + 5]! - this.triangles[i + 2]!,
    );
    this.e2.set(
      this.triangles[i + 6]! - this.triangles[i]!,
      this.triangles[i + 7]! - this.triangles[i + 1]!,
      this.triangles[i + 8]! - this.triangles[i + 2]!,
    );
    cross(out, this.e1, this.e2).normalize();
    if (out.y < 0) out.scale(-1);
    return out;
  }
  private query(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
  ): number {
    if (!this.nodes) return 0;
    let top = 1,
      count = 0;
    this.stack[0] = 0;
    while (top) {
      const node = this.stack[--top]!,
        b = node * 6;
      if (
        this.bounds[b]! > maxX ||
        this.bounds[b + 1]! > maxY ||
        this.bounds[b + 2]! > maxZ ||
        this.bounds[b + 3]! < minX ||
        this.bounds[b + 4]! < minY ||
        this.bounds[b + 5]! < minZ
      )
        continue;
      if (this.counts[node]) {
        const end = this.starts[node]! + this.counts[node]!;
        for (let i = this.starts[node]!; i < end; i++) this.candidates[count++] = this.order[i]!;
      } else {
        this.stack[top++] = this.right[node]!;
        this.stack[top++] = this.left[node]!;
      }
    }
    return count;
  }
  sweepCapsule(
    out: SweepHit,
    feet: Readonly<Vec3>,
    height: number,
    radius: number,
    delta: Readonly<Vec3>,
    skin = 0.001,
  ): boolean {
    out.reset();
    const count = this.query(
      Math.min(feet.x, feet.x + delta.x) - radius - skin,
      Math.min(feet.y, feet.y + delta.y) - skin,
      Math.min(feet.z, feet.z + delta.z) - radius - skin,
      Math.max(feet.x, feet.x + delta.x) + radius + skin,
      Math.max(feet.y, feet.y + delta.y) + height + skin,
      Math.max(feet.z, feet.z + delta.z) + radius + skin,
    );
    for (let c = 0; c < count; c++) {
      const triangle = this.candidates[c]!;
      let fraction = 0;
      for (let iteration = 0; iteration < 40; iteration++) {
        this.position.copy(feet).addScaled(delta, fraction);
        const gap =
          this.calculator.distance(
            this.contact,
            this.triangles,
            triangle,
            this.position,
            height,
            radius,
          ) - radius;
        const closing = -dot(delta, this.contact.normal);
        if (gap <= skin + 1e-7) {
          if (closing > EPSILON || gap < -skin) {
            if (fraction < out.fraction) {
              out.hit = true;
              out.fraction = fraction;
              out.triangle = triangle;
              out.normal.copy(this.contact.normal);
            }
          }
          break;
        }
        if (closing <= EPSILON) break;
        fraction += (gap - skin) / closing;
        if (fraction > out.fraction || fraction > 1) break;
      }
    }
    return out.hit;
  }
  fits(feet: Readonly<Vec3>, height: number, radius: number, skin = 0.002): boolean {
    const count = this.query(
      feet.x - radius,
      feet.y,
      feet.z - radius,
      feet.x + radius,
      feet.y + height,
      feet.z + radius,
    );
    for (let n = 0; n < count; n++)
      if (
        this.calculator.distance(
          this.contact,
          this.triangles,
          this.candidates[n]!,
          feet,
          height,
          radius,
        ) <
        radius - skin
      )
        return false;
    return true;
  }
  depenetrate(feet: Vec3, height: number, radius: number): boolean {
    for (let iteration = 0; iteration < 8; iteration++) {
      const count = this.query(
        feet.x - radius,
        feet.y - 0.01,
        feet.z - radius,
        feet.x + radius,
        feet.y + height + 0.01,
        feet.z + radius,
      );
      let moved = false;
      for (let n = 0; n < count; n++) {
        const d = this.calculator.distance(
          this.contact,
          this.triangles,
          this.candidates[n]!,
          feet,
          height,
          radius,
        );
        if (d < radius - 0.0005) {
          feet.addScaled(this.contact.normal, radius - d + 0.001);
          moved = true;
        }
      }
      if (!moved) return true;
    }
    return this.fits(feet, height, radius);
  }
  raycast(
    out: RayHit,
    origin: Readonly<Vec3>,
    direction: Readonly<Vec3>,
    maxDistance: number,
  ): boolean {
    out.reset(maxDistance);
    if (!this.nodes) return false;
    let top = 1;
    this.stack[0] = 0;
    while (top) {
      const node = this.stack[--top]!,
        offset = node * 6;
      let enter = 0,
        exit = out.distance;
      for (let axis = 0; axis < 3; axis++) {
        const p = axis === 0 ? origin.x : axis === 1 ? origin.y : origin.z,
          d = axis === 0 ? direction.x : axis === 1 ? direction.y : direction.z;
        if (Math.abs(d) < EPSILON) {
          if (p < this.bounds[offset + axis]! || p > this.bounds[offset + axis + 3]!) exit = -1;
        } else {
          let a = (this.bounds[offset + axis]! - p) / d,
            b = (this.bounds[offset + axis + 3]! - p) / d;
          if (a > b) {
            const swap = a;
            a = b;
            b = swap;
          }
          enter = Math.max(enter, a);
          exit = Math.min(exit, b);
        }
      }
      if (enter > exit || exit < 0) continue;
      if (!this.counts[node]) {
        this.stack[top++] = this.right[node]!;
        this.stack[top++] = this.left[node]!;
        continue;
      }
      const end = this.starts[node]! + this.counts[node]!;
      for (let n = this.starts[node]!; n < end; n++) {
        const triangle = this.order[n]!,
          i = triangle * 9;
        this.a.set(this.triangles[i]!, this.triangles[i + 1]!, this.triangles[i + 2]!);
        this.b.set(this.triangles[i + 3]!, this.triangles[i + 4]!, this.triangles[i + 5]!);
        this.c.set(this.triangles[i + 6]!, this.triangles[i + 7]!, this.triangles[i + 8]!);
        subtract(this.e1, this.b, this.a);
        subtract(this.e2, this.c, this.a);
        cross(this.p, direction, this.e2);
        const determinant = dot(this.e1, this.p);
        if (Math.abs(determinant) < EPSILON) continue;
        const inverse = 1 / determinant;
        subtract(this.t, origin, this.a);
        const u = dot(this.t, this.p) * inverse;
        if (u < 0 || u > 1) continue;
        cross(this.q, this.t, this.e1);
        const v = dot(direction, this.q) * inverse;
        if (v < 0 || u + v > 1) continue;
        const distance = dot(this.e2, this.q) * inverse;
        if (distance < 0 || distance > out.distance) continue;
        out.hit = true;
        out.distance = distance;
        out.exitDistance = distance;
        out.triangle = triangle;
        out.point.copy(origin).addScaled(direction, distance);
        cross(out.normal, this.e1, this.e2).normalize();
        if (dot(out.normal, direction) > 0) out.normal.scale(-1);
      }
    }
    return out.hit;
  }
}
/** Geometry authoring allocates only at map construction, never inside simulation. */
export class WorldBuilder {
  private vertices: number[] = [];
  triangle(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
  ): this {
    this.vertices.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    return this;
  }
  quad(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
  ): this {
    return this.triangle(ax, ay, az, bx, by, bz, cx, cy, cz).triangle(
      ax,
      ay,
      az,
      cx,
      cy,
      cz,
      dx,
      dy,
      dz,
    );
  }
  box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): this {
    if (minX >= maxX || minY >= maxY || minZ >= maxZ) throw new RangeError('Invalid box');
    return this.quad(minX, minY, minZ, maxX, minY, minZ, maxX, minY, maxZ, minX, minY, maxZ)
      .quad(minX, maxY, minZ, minX, maxY, maxZ, maxX, maxY, maxZ, maxX, maxY, minZ)
      .quad(minX, minY, minZ, minX, minY, maxZ, minX, maxY, maxZ, minX, maxY, minZ)
      .quad(maxX, minY, minZ, maxX, maxY, minZ, maxX, maxY, maxZ, maxX, minY, maxZ)
      .quad(minX, minY, minZ, minX, maxY, minZ, maxX, maxY, minZ, maxX, minY, minZ)
      .quad(minX, minY, maxZ, maxX, minY, maxZ, maxX, maxY, maxZ, minX, maxY, maxZ);
  }
  ramp(minX: number, minZ: number, maxX: number, maxZ: number, lowY: number, highY: number): this {
    if (minX >= maxX || minZ >= maxZ || lowY >= highY) throw new RangeError('Invalid ramp');
    return this.quad(minX, lowY, minZ, minX, highY, maxZ, maxX, highY, maxZ, maxX, lowY, minZ);
  }
  build(): StaticWorld {
    return new StaticWorld(this.vertices);
  }
}
