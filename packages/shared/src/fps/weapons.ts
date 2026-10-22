import { Vec3, clamp } from './math.js';
export enum WeaponId {
  Vanguard = 0,
  Kraber = 1,
  Vector = 2,
  Cerberus = 3,
  Sheriff = 4,
  Karambit = 5,
}
export enum HitZone {
  Head = 0,
  Chest = 1,
  Stomach = 2,
  Limbs = 3,
}
export interface WeaponDefinition {
  readonly id: WeaponId;
  readonly name: string;
  readonly rpm: number;
  readonly damage: readonly [number, number, number, number];
  readonly falloffStart: number;
  readonly falloffEnd: number;
  readonly minimumDamageMultiplier: number;
  readonly penetration: number;
  readonly adsZoom: number;
  readonly adsRecoilMultiplier: number;
  readonly movementMultiplier: number;
  readonly pellets: number;
  readonly magazine: number;
  readonly reserve: number;
  readonly reloadSeconds: number;
  readonly shellReload: boolean;
  readonly automatic: boolean;
  readonly hipSpread: number;
  readonly adsSpread: number;
  readonly bloomPerShot: number;
  readonly maximumBloom: number;
  readonly bloomRecovery: number;
  readonly recoil: Readonly<Float32Array>;
}
const radians = Math.PI / 180;
const arPattern = new Float32Array([
  0.8, 0, 1, 0, 1.1, 0.05, 1.2, -0.1, 1.15, -0.35, 0.9, -0.55, 0.7, -0.8, 0.55, -0.9, 0.35, 0.6,
  0.25, 0.9, 0.2, 1.1, 0.15, 1.2, 0.35, 0.8, 0.25, 0.4, 0.2, -0.5, 0.2, -0.7, 0.2, -0.9, 0.2, -0.7,
  0.3, 0.3, 0.3, 0.5, 0.3, 0.7, 0.3, 0.6, 0.3, -0.3, 0.3, -0.5, 0.3, -0.7, 0.3, -0.4, 0.3, 0.2, 0.3,
  0.4, 0.3, 0.3, 0.3, -0.3,
]);
const smgPattern = new Float32Array([
  0.4, 0, 0.45, -0.1, 0.5, -0.2, 0.55, 0.1, 0.6, 0.3, 0.6, 0.4, 0.45, -0.4, 0.4, -0.5, 0.45, 0.35,
  0.4, 0.45, 0.4, -0.3, 0.4, -0.4,
]);
export const WEAPONS: readonly WeaponDefinition[] = Object.freeze([
  {
    id: WeaponId.Vanguard,
    name: 'VANGUARD-AR',
    rpm: 660,
    damage: [44, 24, 28, 18],
    falloffStart: 25,
    falloffEnd: 55,
    minimumDamageMultiplier: 0.7,
    penetration: 0.4,
    adsZoom: 1.35,
    adsRecoilMultiplier: 0.7,
    movementMultiplier: 1,
    pellets: 1,
    magazine: 30,
    reserve: 120,
    reloadSeconds: 2.2,
    shellReload: false,
    automatic: true,
    hipSpread: 1.1,
    adsSpread: 0.12,
    bloomPerShot: 0.14,
    maximumBloom: 2.8,
    bloomRecovery: 5,
    recoil: arPattern,
  },
  {
    id: WeaponId.Kraber,
    name: 'KRABER-DS50',
    rpm: 48,
    damage: [300, 125, 110, 88],
    falloffStart: Infinity,
    falloffEnd: Infinity,
    minimumDamageMultiplier: 1,
    penetration: 1.2,
    adsZoom: 6,
    adsRecoilMultiplier: 0.7,
    movementMultiplier: 1,
    pellets: 1,
    magazine: 5,
    reserve: 25,
    reloadSeconds: 3.2,
    shellReload: false,
    automatic: false,
    hipSpread: 5,
    adsSpread: 0,
    bloomPerShot: 2,
    maximumBloom: 5,
    bloomRecovery: 8,
    recoil: new Float32Array([4.2, 0.25, 4.1, -0.25, 4.3, 0.15]),
  },
  {
    id: WeaponId.Vector,
    name: 'VECTOR-9X',
    rpm: 1000,
    damage: [26, 16, 18, 12],
    falloffStart: 12,
    falloffEnd: 30,
    minimumDamageMultiplier: 0.5,
    penetration: 0.15,
    adsZoom: 1.2,
    adsRecoilMultiplier: 0.7,
    movementMultiplier: 1.06,
    pellets: 1,
    magazine: 33,
    reserve: 132,
    reloadSeconds: 1.75,
    shellReload: false,
    automatic: true,
    hipSpread: 0.7,
    adsSpread: 0.18,
    bloomPerShot: 0.08,
    maximumBloom: 1.8,
    bloomRecovery: 6,
    recoil: smgPattern,
  },
  {
    id: WeaponId.Cerberus,
    name: 'CERBERUS-12',
    rpm: 135,
    damage: [22, 15, 15, 11],
    falloffStart: 8,
    falloffEnd: 22,
    minimumDamageMultiplier: 0.25,
    penetration: 0,
    adsZoom: 1.2,
    adsRecoilMultiplier: 0.7,
    movementMultiplier: 1,
    pellets: 9,
    magazine: 8,
    reserve: 40,
    reloadSeconds: 0.55,
    shellReload: true,
    automatic: false,
    hipSpread: 3.4,
    adsSpread: 2.6,
    bloomPerShot: 0.5,
    maximumBloom: 1,
    bloomRecovery: 4,
    recoil: new Float32Array([3.2, 0.15, 3.4, -0.2, 3.1, 0.1]),
  },
  {
    id: WeaponId.Sheriff,
    name: 'SHERIFF-500',
    rpm: 165,
    damage: [145, 55, 60, 40],
    falloffStart: 30,
    falloffEnd: 60,
    minimumDamageMultiplier: 0.75,
    penetration: 0.5,
    adsZoom: 1.35,
    adsRecoilMultiplier: 0.7,
    movementMultiplier: 1,
    pellets: 1,
    magazine: 6,
    reserve: 36,
    reloadSeconds: 2.5,
    shellReload: false,
    automatic: false,
    hipSpread: 0.4,
    adsSpread: 0.1,
    bloomPerShot: 0.8,
    maximumBloom: 3,
    bloomRecovery: 5,
    recoil: new Float32Array([2.4, 0, 2.5, 0.25, 2.6, -0.2, 2.4, 0.1, 2.5, -0.15, 2.6, 0.2]),
  },
  {
    id: WeaponId.Karambit,
    name: 'KARAMBIT-ZERO',
    rpm: 120,
    damage: [100, 100, 100, 100],
    falloffStart: 2.6,
    falloffEnd: 2.6,
    minimumDamageMultiplier: 0,
    penetration: 0,
    adsZoom: 1,
    adsRecoilMultiplier: 1,
    movementMultiplier: 1.15,
    pellets: 1,
    magazine: 0,
    reserve: 0,
    reloadSeconds: 0,
    shellReload: false,
    automatic: false,
    hipSpread: 0,
    adsSpread: 0,
    bloomPerShot: 0,
    maximumBloom: 0,
    bloomRecovery: 0,
    recoil: new Float32Array([0, 0]),
  },
] satisfies WeaponDefinition[]);
export function weaponDamage(weapon: WeaponDefinition, zone: HitZone, distance: number): number {
  if (distance < 0 || !Number.isFinite(distance)) return 0;
  if (weapon.id === WeaponId.Karambit) return distance <= 2.6 ? 100 : 0;
  const base = weapon.damage[zone];
  if (distance <= weapon.falloffStart) return base;
  const ratio = clamp(
    (distance - weapon.falloffStart) / (weapon.falloffEnd - weapon.falloffStart),
    0,
    1,
  );
  return base * (1 - ratio * (1 - weapon.minimumDamageMultiplier));
}
export function meleeDamage(
  attacker: Readonly<Vec3>,
  victim: Readonly<Vec3>,
  victimForward: Readonly<Vec3>,
  attackerForward: Readonly<Vec3>,
): number {
  const dx = attacker.x - victim.x,
    dy = attacker.y - victim.y,
    dz = attacker.z - victim.z;
  if (dx * dx + dy * dy + dz * dz > 2.6 ** 2) return 0;
  const behind = dx * victimForward.x + dz * victimForward.z < 0,
    facing = attackerForward.x * victimForward.x + attackerForward.z * victimForward.z > 0.5;
  return behind && facing ? 200 : 100;
}
export class FireResult {
  accepted = false;
  weapon = WeaponId.Vanguard;
  shot = 0;
  ammo = 0;
  pellets = 1;
  spread = 0;
  recoilPitch = 0;
  recoilYaw = 0;
  seed = 0;
}
export interface AimState {
  readonly ads: boolean;
  readonly grounded: boolean;
  readonly sliding: boolean;
  readonly speed: number;
}
export class WeaponController {
  readonly ammo = new Uint16Array(6);
  readonly reserve = new Uint16Array(6);
  readonly nextFire = new Float64Array(6);
  readonly reloadUntil = new Float64Array(6);
  readonly bloom = new Float64Array(6);
  readonly shots = new Uint32Array(6);
  readonly lastShot = new Float64Array(6);
  private randomState: number;
  private triggerHeld = false;
  constructor(seed: number) {
    this.randomState = seed >>> 0 || 0x6d2b79f5;
    this.reset();
  }
  reset(): void {
    for (let i = 0; i < 6; i++) {
      this.ammo[i] = WEAPONS[i]!.magazine;
      this.reserve[i] = WEAPONS[i]!.reserve;
      this.nextFire[i] = 0;
      this.reloadUntil[i] = 0;
      this.bloom[i] = 0;
      this.shots[i] = 0;
      this.lastShot[i] = -Infinity;
    }
    this.triggerHeld = false;
  }
  update(now: number, dt: number): void {
    for (let id = 0; id < 6; id++) {
      const definition = WEAPONS[id]!;
      this.bloom[id] = Math.max(0, this.bloom[id]! - definition.bloomRecovery * dt);
      if (now - this.lastShot[id]! > 0.4) this.shots[id] = 0;
      let due = this.reloadUntil[id]!;
      if (due > 0 && now >= due) {
        if (definition.shellReload) {
          while (due <= now && this.ammo[id]! < definition.magazine && this.reserve[id]! > 0) {
            this.ammo[id] = this.ammo[id]! + 1;
            this.reserve[id] = this.reserve[id]! - 1;
            due += definition.reloadSeconds;
          }
          this.reloadUntil[id] =
            this.ammo[id]! < definition.magazine && this.reserve[id]! > 0 ? due : 0;
        } else {
          const count = Math.min(definition.magazine - this.ammo[id]!, this.reserve[id]!);
          this.ammo[id] = this.ammo[id]! + count;
          this.reserve[id] = this.reserve[id]! - count;
          this.reloadUntil[id] = 0;
        }
      }
    }
  }
  reload(id: WeaponId, now: number): boolean {
    const definition = WEAPONS[id];
    if (
      !definition ||
      id === WeaponId.Karambit ||
      this.reloadUntil[id]! > 0 ||
      this.ammo[id]! >= definition.magazine ||
      !this.reserve[id]
    )
      return false;
    this.reloadUntil[id] = now + (definition.shellReload ? 0.45 : definition.reloadSeconds);
    return true;
  }
  trigger(
    out: FireResult,
    id: WeaponId,
    now: number,
    held: boolean,
    aim: Readonly<AimState>,
  ): boolean {
    const fresh = held && !this.triggerHeld;
    this.triggerHeld = held;
    const definition = WEAPONS[id];
    out.accepted = false;
    if (
      !held ||
      !definition ||
      (!definition.automatic && !fresh) ||
      now + 1e-9 < this.nextFire[id]!
    )
      return false;
    if (id !== WeaponId.Karambit) {
      if (!this.ammo[id]) return false;
      if (this.reloadUntil[id]! > 0) {
        if (!definition.shellReload) return false;
        this.reloadUntil[id] = 0;
      }
      this.ammo[id] = this.ammo[id]! - 1;
    }
    if (now - this.lastShot[id]! > 0.4) this.shots[id] = 0;
    const shot = this.shots[id]!,
      pattern = (shot % (definition.recoil.length / 2)) * 2,
      recoil = aim.ads ? definition.adsRecoilMultiplier : 1;
    out.recoilPitch = definition.recoil[pattern]! * radians * recoil;
    out.recoilYaw = definition.recoil[pattern + 1]! * radians * recoil;
    let spread = (aim.ads ? definition.adsSpread : definition.hipSpread) + this.bloom[id]!;
    if (!aim.grounded) spread += id === WeaponId.Vector ? 0.15 : 1.3;
    if (aim.speed > 0.3)
      spread += Math.min(1, aim.speed / 12.8) * (id === WeaponId.Vector ? 0.2 : 0.9);
    if (aim.sliding && id !== WeaponId.Vector) spread += 0.35;
    if (id === WeaponId.Sheriff && shot === 0 && aim.grounded && aim.speed < 0.1) spread = 0;
    this.randomState ^= this.randomState << 13;
    this.randomState ^= this.randomState >>> 17;
    this.randomState ^= this.randomState << 5;
    out.accepted = true;
    out.weapon = id;
    out.shot = shot;
    out.ammo = this.ammo[id]!;
    out.pellets = definition.pellets;
    out.spread = spread * radians;
    out.seed = this.randomState >>> 0;
    this.shots[id] = shot + 1;
    this.lastShot[id] = now;
    this.nextFire[id] =
      (this.nextFire[id]! >= now - 1 / 60 ? this.nextFire[id]! : now) + 60 / definition.rpm;
    this.bloom[id] = Math.min(definition.maximumBloom, this.bloom[id]! + definition.bloomPerShot);
    return true;
  }
}
/** Fills a caller-owned direction; the shotgun has one central plus eight fixed star pellets. */
export function pelletDirection(
  out: Vec3,
  yaw: number,
  pitch: number,
  shot: Readonly<FireResult>,
  pellet: number,
): Vec3 {
  let dx = 0,
    dy = 0;
  if (shot.weapon === WeaponId.Cerberus) {
    if (pellet > 0) {
      const angle = ((pellet - 1) * Math.PI) / 4,
        radius = (pellet % 2 ? 1 : 0.65) * shot.spread;
      dx = Math.cos(angle) * radius;
      dy = Math.sin(angle) * radius;
    }
  } else if (shot.spread > 0) {
    let state = (shot.seed ^ Math.imul(pellet + 1, 0x9e3779b9)) >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const angle = ((state >>> 0) / 4294967296) * Math.PI * 2;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const radius = Math.sqrt((state >>> 0) / 4294967296) * shot.spread;
    dx = Math.cos(angle) * radius;
    dy = Math.sin(angle) * radius;
  }
  const p = clamp(pitch + dy, -Math.PI / 2, Math.PI / 2),
    y = yaw + dx;
  return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
}
