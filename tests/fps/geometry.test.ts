import { describe, it, expect } from 'vitest';
import {
  Vec3,
  Quaternion,
  RayHit,
  ObbRaycaster,
  WorldBuilder,
  StaticWorld,
  SweepHit,
  CapsuleContact,
  CapsuleTriangle,
} from '@district/rts-shared/fps';
describe('FPS geometry', () => {
  it('computes segment/triangle closest distance and direct intersection', () => {
    const world = new WorldBuilder().quad(-10, 0, -10, -10, 0, 10, 10, 0, 10, 10, 0, -10).build(),
      contact = new CapsuleContact(),
      solver = new CapsuleTriangle();
    expect(solver.distance(contact, world.triangles, 0, new Vec3(0, 1, 0), 1.8, 0.32)).toBeCloseTo(
      1.32,
    );
    expect(contact.normal.y).toBeCloseTo(1);
    expect(
      solver.distance(contact, world.triangles, 0, new Vec3(0, -0.8, 0), 1.8, 0.32),
    ).toBeCloseTo(0);
  });
  it('sweeps through a thin wall without tunnelling at extreme speed', () => {
    const world = new WorldBuilder().box(-0.03, -1, -10, 0.03, 4, 10).build(),
      hit = new SweepHit();
    expect(world.sweepCapsule(hit, new Vec3(-4, 0, 0), 1.8, 0.32, new Vec3(20, 0, 0))).toBe(true);
    expect(-4 + 20 * hit.fraction).toBeCloseTo(-0.351, 3);
    expect(hit.normal.x).toBeCloseTo(-1);
  });
  it('does not stop tangential floor movement and catches slope impact', () => {
    const floor = new WorldBuilder().quad(-10, 0, -10, -10, 0, 10, 10, 0, 10, 10, 0, -10).build(),
      hit = new SweepHit();
    expect(floor.sweepCapsule(hit, new Vec3(0, 0.001, 0), 1.8, 0.32, new Vec3(1, 0, 0))).toBe(
      false,
    );
    const ramp = new WorldBuilder().ramp(-5, -5, 5, 5, 0, 4).build();
    expect(ramp.sweepCapsule(hit, new Vec3(0, 6, 0), 1.8, 0.32, new Vec3(0, -10, 0))).toBe(true);
    expect(hit.normal.y).toBeGreaterThan(0.9);
    expect(hit.normal.z).toBeLessThan(0);
  });
  it('uses rounded capsule corners rather than an expanded box', () => {
    const world = new WorldBuilder().box(0, 0, 0, 1, 2, 1).build(),
      hit = new SweepHit();
    expect(world.sweepCapsule(hit, new Vec3(-0.3, 0, -0.3), 1.8, 0.32, new Vec3(0.01, 0, 0))).toBe(
      false,
    );
    expect(world.sweepCapsule(hit, new Vec3(-0.3, 0, -0.3), 1.8, 0.32, new Vec3(0.4, 0, 0.4))).toBe(
      true,
    );
    expect(hit.normal.x).toBeLessThan(-0.6);
    expect(hit.normal.z).toBeLessThan(-0.6);
  });
  it('raycasts indexed triangles and reuses hit storage', () => {
    const builder = new WorldBuilder();
    for (let i = 0; i < 100; i++) builder.box(i * 3, 0, -1, i * 3 + 1, 2, 1);
    const world = builder.build(),
      hit = new RayHit();
    expect(world.raycast(hit, new Vec3(-2, 1, 0), new Vec3(1, 0, 0), 500)).toBe(true);
    expect(hit.distance).toBeCloseTo(2);
    expect(world.raycast(hit, new Vec3(-2, 5, 0), new Vec3(1, 0, 0), 500)).toBe(false);
    expect(hit.hit).toBe(false);
  });
  it('raycasts a rotated OBB and reports the exit for penetration', () => {
    const ray = new ObbRaycaster(),
      hit = new RayHit(),
      q = new Quaternion(0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8));
    expect(
      ray.cast(hit, new Vec3(0, 0, 5), new Vec3(0, 0, -1), new Vec3(), new Vec3(1, 1, 1), q, 20),
    ).toBe(true);
    expect(hit.distance).toBeCloseTo(5 - Math.SQRT2);
    expect(hit.exitDistance).toBeCloseTo(5 + Math.SQRT2);
    expect(
      ray.cast(hit, new Vec3(4, 0, 5), new Vec3(0, 0, -1), new Vec3(), new Vec3(1, 1, 1), q, 20),
    ).toBe(false);
    expect(hit.hit).toBe(false);
  });
  it('validates static geometry and supports empty worlds', () => {
    expect(() => new StaticWorld([0, 0, 0, 1, 0, 0, 2, 0, 0])).toThrow('Degenerate');
    expect(() => new StaticWorld([NaN, 0, 0])).toThrow();
    expect(new StaticWorld([]).fits(new Vec3(), 1.8, 0.32)).toBe(true);
  });
});
