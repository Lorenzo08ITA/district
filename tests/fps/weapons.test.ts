import { describe, it, expect } from 'vitest';
import {
  WEAPONS,
  WeaponId,
  HitZone,
  weaponDamage,
  meleeDamage,
  Vec3,
  WeaponController,
  FireResult,
  pelletDirection,
} from '@district/rts-shared/fps';
const standing = { ads: false, grounded: true, sliding: false, speed: 0 };
describe('FPS arsenal', () => {
  it('contains all six exact weapon specifications and falloffs', () => {
    expect(WEAPONS.map((w) => w.rpm)).toEqual([660, 48, 1000, 135, 165, 120]);
    expect(weaponDamage(WEAPONS[0]!, HitZone.Head, 25)).toBe(44);
    expect(weaponDamage(WEAPONS[0]!, HitZone.Chest, 55)).toBeCloseTo(24 * 0.7);
    expect(weaponDamage(WEAPONS[1]!, HitZone.Chest, 10000)).toBe(125);
    expect(weaponDamage(WEAPONS[2]!, HitZone.Limbs, 30)).toBe(6);
    expect(weaponDamage(WEAPONS[3]!, HitZone.Chest, 22)).toBeCloseTo(3.75);
    expect(weaponDamage(WEAPONS[4]!, HitZone.Head, 60)).toBeCloseTo(108.75);
  });
  it('honours rate of fire without frame-quantization drift', () => {
    const controller = new WeaponController(4),
      shot = new FireResult();
    let count = 0;
    controller.ammo[2] = 1000;
    for (let tick = 0; tick < 600; tick++) {
      controller.update(tick / 60, 1 / 60);
      if (controller.trigger(shot, WeaponId.Vector, tick / 60, true, standing)) count++;
    }
    expect(count).toBeGreaterThanOrEqual(166);
    expect(count).toBeLessThanOrEqual(167);
  });
  it('requires a new press for semiautomatic weapons and completes magazine reload', () => {
    const controller = new WeaponController(5),
      shot = new FireResult();
    expect(controller.trigger(shot, WeaponId.Sheriff, 0, true, standing)).toBe(true);
    expect(controller.trigger(shot, WeaponId.Sheriff, 1, true, standing)).toBe(false);
    controller.trigger(shot, WeaponId.Sheriff, 1, false, standing);
    expect(controller.trigger(shot, WeaponId.Sheriff, 1, true, standing)).toBe(true);
    expect(controller.reload(WeaponId.Sheriff, 1)).toBe(true);
    controller.update(3.49, 0.1);
    expect(controller.ammo[4]).toBe(4);
    controller.update(3.5, 0.01);
    expect(controller.ammo[4]).toBe(6);
    expect(controller.reserve[4]).toBe(34);
  });
  it('reloads shotgun shells individually and allows interruption', () => {
    const controller = new WeaponController(6),
      shot = new FireResult();
    controller.ammo[3] = 2;
    expect(controller.reload(WeaponId.Cerberus, 0)).toBe(true);
    controller.update(0.46, 0.46);
    expect(controller.ammo[3]).toBe(3);
    expect(controller.reloadUntil[3]).toBeGreaterThan(0);
    expect(controller.trigger(shot, WeaponId.Cerberus, 0.5, true, standing)).toBe(true);
    expect(controller.reloadUntil[3]).toBe(0);
    expect(controller.ammo[3]).toBe(2);
  });
  it('reproduces recoil and seeded spread; shotgun ignores random seed', () => {
    const a = new WeaponController(19),
      b = new WeaponController(19),
      one = new FireResult(),
      two = new FireResult(),
      direction = new Vec3(),
      other = new Vec3();
    for (let i = 0; i < 12; i++) {
      a.update(i * 0.1, 0.1);
      b.update(i * 0.1, 0.1);
      expect(a.trigger(one, WeaponId.Vanguard, i * 0.1, true, standing)).toBe(true);
      expect(b.trigger(two, WeaponId.Vanguard, i * 0.1, true, standing)).toBe(true);
      expect(one).toEqual(two);
      expect(pelletDirection(direction, 0, 0, one, 0)).toEqual(
        pelletDirection(other, 0, 0, two, 0),
      );
    }
    one.weapon = WeaponId.Cerberus;
    one.spread = 0.05;
    one.seed = 1;
    two.weapon = WeaponId.Cerberus;
    two.spread = 0.05;
    two.seed = 999;
    for (let i = 0; i < 9; i++)
      expect(pelletDirection(direction, 0, 0, one, i)).toEqual(
        pelletDirection(other, 0, 0, two, i),
      );
  });
  it('keeps first standing Sheriff shot precise and reduces ADS recoil', () => {
    const a = new WeaponController(1),
      b = new WeaponController(1),
      one = new FireResult(),
      two = new FireResult();
    a.trigger(one, WeaponId.Sheriff, 0, true, standing);
    expect(one.spread).toBe(0);
    a.trigger(one, WeaponId.Vanguard, 0.1, true, standing);
    b.trigger(two, WeaponId.Vanguard, 0.1, true, { ...standing, ads: true });
    expect(two.recoilPitch).toBeCloseTo(one.recoilPitch * 0.7);
  });
  it('limits melee range and detects directional backstabs', () => {
    expect(meleeDamage(new Vec3(0, 0, 1), new Vec3(), new Vec3(0, 0, -1), new Vec3(0, 0, -1))).toBe(
      200,
    );
    expect(meleeDamage(new Vec3(0, 0, -1), new Vec3(), new Vec3(0, 0, -1), new Vec3(0, 0, 1))).toBe(
      100,
    );
    expect(meleeDamage(new Vec3(0, 0, 3), new Vec3(), new Vec3(0, 0, -1), new Vec3(0, 0, -1))).toBe(
      0,
    );
  });
});
