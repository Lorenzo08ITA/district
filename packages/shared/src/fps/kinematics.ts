import { Vec3, clamp, dot, cross, accelerate } from './math.js';
import { StaticWorld, SweepHit } from './bvh.js';
export const PHYSICS = Object.freeze({
  hz: 60,
  dt: 1 / 60,
  radius: 0.32,
  standingHeight: 1.8,
  crouchingHeight: 0.95,
  standingEye: 1.62,
  crouchingEye: 0.8,
  eyeDecay: 18,
  maxSpeed: 8.5,
  sprintSpeed: 12.8,
  groundAccel: 14,
  friction: 8,
  airWishSpeedCap: 3.2,
  airAccel: 28,
  gravity: -24.5,
  jumpImpulse: 9.4,
  stepHeight: 0.45,
  slideThreshold: 9.5,
  slideBufferMs: 150,
  slideFriction: 1.15,
  slideLowFrictionMs: 550,
  slopeBoost: 18,
  slideHopBonus: 1.4,
  softSpeedCap: 22,
  coyoteMs: 90,
  jumpBufferMs: 110,
  groundSnap: 0.065,
  walkableNormalY: 0.6427876096865394,
  skin: 0.001,
});
export enum InputButtons {
  Jump = 1,
  Crouch = 2,
  Sprint = 4,
  Fire = 8,
  Ads = 16,
  Reload = 32,
  Inspect = 64,
}
export enum MovementEvents {
  Jumped = 1,
  Landed = 2,
  SlideStarted = 4,
  JumpPad = 8,
}
export class PlayerInput {
  sequenceNumber = 0;
  clientTick = 0;
  subTickFraction = 0;
  moveX = 0;
  moveZ = 0;
  yaw = 0;
  pitch = 0;
  buttons = 0;
  weapon = 0;
  copy(input: Readonly<PlayerInput>): this {
    this.sequenceNumber = input.sequenceNumber;
    this.clientTick = input.clientTick;
    this.subTickFraction = input.subTickFraction;
    this.moveX = input.moveX;
    this.moveZ = input.moveZ;
    this.yaw = input.yaw;
    this.pitch = input.pitch;
    this.buttons = input.buttons;
    this.weapon = input.weapon;
    return this;
  }
}
export class KinematicState {
  readonly position = new Vec3();
  readonly velocity = new Vec3();
  readonly groundNormal = new Vec3(0, 1, 0);
  tick = 0;
  grounded = false;
  crouched = false;
  sliding = false;
  eyeHeight: number = PHYSICS.standingEye;
  slideTimeMs = 0;
  coyoteMs = 0;
  jumpBufferMs = 0;
  crouchBufferMs = 0;
  padCooldownMs = 0;
  previousButtons = 0;
  events = 0;
  impactVelocity = 0;
  lastPad = -1;
  copy(other: Readonly<KinematicState>): this {
    this.position.copy(other.position);
    this.velocity.copy(other.velocity);
    this.groundNormal.copy(other.groundNormal);
    this.tick = other.tick;
    this.grounded = other.grounded;
    this.crouched = other.crouched;
    this.sliding = other.sliding;
    this.eyeHeight = other.eyeHeight;
    this.slideTimeMs = other.slideTimeMs;
    this.coyoteMs = other.coyoteMs;
    this.jumpBufferMs = other.jumpBufferMs;
    this.crouchBufferMs = other.crouchBufferMs;
    this.padCooldownMs = other.padCooldownMs;
    this.previousButtons = other.previousButtons;
    this.events = other.events;
    this.impactVelocity = other.impactVelocity;
    this.lastPad = other.lastPad;
    return this;
  }
}
/** Fixed-size jump-pad records: min xyz, max xyz, impulse xyz. */
export class JumpPads {
  readonly records: Float64Array;
  constructor(data: ArrayLike<number> = []) {
    if (data.length % 9) throw new RangeError('Invalid jump-pad records');
    this.records = Float64Array.from(data);
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) throw new RangeError('Invalid jump-pad value');
    }
    for (let i = 0; i < data.length; i += 9)
      if (data[i]! >= data[i + 3]! || data[i + 1]! >= data[i + 4]! || data[i + 2]! >= data[i + 5]!)
        throw new RangeError('Invalid jump-pad bounds');
  }
}
export class KinematicController {
  readonly state = new KinematicState();
  private hit = new SweepHit();
  private probeHit = new SweepHit();
  private delta = new Vec3();
  private wish = new Vec3();
  private startPosition = new Vec3();
  private startVelocity = new Vec3();
  private flatPosition = new Vec3();
  private flatVelocity = new Vec3();
  private stepPosition = new Vec3();
  private stepVelocity = new Vec3();
  private groundDelta = new Vec3(0, -PHYSICS.groundSnap, 0);
  private crease = new Vec3();
  private candidate = new Vec3();
  private originalVelocity = new Vec3();
  private planes = [new Vec3(), new Vec3(), new Vec3(), new Vec3()];
  private blocked = false;
  private stepNormal = new Vec3();
  constructor(
    readonly world: StaticWorld,
    readonly pads = new JumpPads(),
  ) {}
  reset(x: number, y: number, z: number): void {
    const fresh = this.state;
    fresh.position.set(x, y, z);
    fresh.velocity.set(0, 0, 0);
    fresh.groundNormal.set(0, 1, 0);
    fresh.tick = 0;
    fresh.grounded = false;
    fresh.crouched = false;
    fresh.sliding = false;
    fresh.eyeHeight = PHYSICS.standingEye;
    fresh.slideTimeMs =
      fresh.coyoteMs =
      fresh.jumpBufferMs =
      fresh.crouchBufferMs =
      fresh.padCooldownMs =
        0;
    fresh.previousButtons = fresh.events = 0;
    fresh.impactVelocity = 0;
    fresh.lastPad = -1;
    this.world.depenetrate(fresh.position, PHYSICS.standingHeight, PHYSICS.radius);
    this.probe();
  }
  private height(): number {
    return this.state.crouched ? PHYSICS.crouchingHeight : PHYSICS.standingHeight;
  }
  private probe(allowAscending = false): boolean {
    const s = this.state;
    if (s.velocity.y > 1 && !allowAscending) return false;
    if (
      this.world.sweepCapsule(
        this.probeHit,
        s.position,
        this.height(),
        PHYSICS.radius,
        this.groundDelta,
      ) &&
      this.probeHit.normal.y >= PHYSICS.walkableNormalY
    ) {
      s.position.addScaled(this.groundDelta, this.probeHit.fraction);
      s.groundNormal.copy(this.probeHit.normal);
      s.grounded = true;
      s.coyoteMs = PHYSICS.coyoteMs;
      if (s.velocity.y < 0) s.velocity.y = 0;
      return true;
    }
    return false;
  }
  step(input: Readonly<PlayerInput>, movementMultiplier = 1): void {
    const s = this.state;
    s.events = 0;
    s.impactVelocity = 0;
    const pressed = input.buttons & ~s.previousButtons,
      fraction = clamp(input.subTickFraction, 0, 1);
    if (pressed & (InputButtons.Jump | InputButtons.Crouch)) {
      if (fraction > 0)
        this.advance(input, s.previousButtons, PHYSICS.dt * fraction, movementMultiplier);
      if (pressed & InputButtons.Jump) s.jumpBufferMs = PHYSICS.jumpBufferMs;
      if (pressed & InputButtons.Crouch) s.crouchBufferMs = PHYSICS.slideBufferMs;
      this.advance(input, input.buttons, PHYSICS.dt * (1 - fraction), movementMultiplier);
    } else this.advance(input, input.buttons, PHYSICS.dt, movementMultiplier);
    s.previousButtons = input.buttons;
    s.tick++;
  }
  private startSlide(): void {
    const s = this.state;
    if (!s.sliding) {
      s.sliding = true;
      s.slideTimeMs = 0;
      s.events |= MovementEvents.SlideStarted;
    }
  }
  private advance(
    input: Readonly<PlayerInput>,
    buttons: number,
    dt: number,
    multiplier: number,
  ): void {
    const s = this.state,
      ms = dt * 1000,
      crouch = !!(buttons & InputButtons.Crouch);
    if (crouch) s.crouched = true;
    else if (s.crouched && this.world.fits(s.position, PHYSICS.standingHeight, PHYSICS.radius))
      s.crouched = false;
    if (!crouch) s.sliding = false;
    if (
      s.grounded &&
      s.crouchBufferMs > 0 &&
      Math.hypot(s.velocity.x, s.velocity.z) > PHYSICS.slideThreshold
    )
      this.startSlide();
    if (s.jumpBufferMs > 0 && (s.grounded || s.coyoteMs > 0)) {
      if (s.sliding) {
        const speed = Math.hypot(s.velocity.x, s.velocity.z),
          bonus = PHYSICS.slideHopBonus * Math.max(0, 1 - speed / PHYSICS.softSpeedCap);
        s.velocity.x += Math.sin(input.yaw) * bonus;
        s.velocity.z -= Math.cos(input.yaw) * bonus;
      }
      s.velocity.y = PHYSICS.jumpImpulse;
      s.grounded = false;
      s.coyoteMs = 0;
      s.jumpBufferMs = 0;
      s.sliding = false;
      s.events |= MovementEvents.Jumped;
    }
    if (dt <= 0) return;
    const mx = clamp(input.moveX, -1, 1),
      mz = clamp(input.moveZ, -1, 1),
      length = Math.hypot(mx, mz),
      scale = length > 1 ? 1 / length : 1;
    this.wish.set(
      (Math.cos(input.yaw) * mx + Math.sin(input.yaw) * mz) * scale,
      0,
      (Math.sin(input.yaw) * mx - Math.cos(input.yaw) * mz) * scale,
    );
    const wishMagnitude = Math.min(1, length);
    if (wishMagnitude > 0) this.wish.normalize();
    if (s.grounded) {
      const speed = Math.hypot(s.velocity.x, s.velocity.z),
        friction =
          s.sliding && s.slideTimeMs < PHYSICS.slideLowFrictionMs
            ? PHYSICS.slideFriction
            : PHYSICS.friction;
      if (speed > 0) {
        const factor = Math.max(0, speed - speed * friction * dt) / speed;
        s.velocity.x *= factor;
        s.velocity.z *= factor;
      }
      const max =
        (buttons & InputButtons.Sprint ? PHYSICS.sprintSpeed : PHYSICS.maxSpeed) *
        multiplier *
        (s.crouched && !s.sliding ? 0.55 : 1);
      accelerate(s.velocity, this.wish, max * wishMagnitude, PHYSICS.groundAccel, dt);
      if (s.groundNormal.y < 0.999) {
        const into = dot(s.velocity, s.groundNormal);
        s.velocity.addScaled(s.groundNormal, -into);
      }
    } else
      accelerate(
        s.velocity,
        this.wish,
        PHYSICS.airWishSpeedCap * wishMagnitude,
        PHYSICS.airAccel,
        dt,
      );
    const wasGrounded = s.grounded;
    s.velocity.y += PHYSICS.gravity * dt * 0.5;
    const impact = s.velocity.y;
    this.world.depenetrate(s.position, this.height(), PHYSICS.radius);
    this.startPosition.copy(s.position);
    this.startVelocity.copy(s.velocity);
    this.slideMove(s.position, s.velocity, dt);
    const wall = this.blocked;
    const stepped =
      wasGrounded && wall && !(s.events & MovementEvents.Jumped) ? this.tryStep(dt) : false;
    s.velocity.y += PHYSICS.gravity * dt * 0.5;
    s.grounded = false;
    const keepGround = wasGrounded && !(s.events & MovementEvents.Jumped);
    if ((impact <= 0 || keepGround) && (this.probe(!!keepGround) || stepped)) {
      if (stepped) {
        s.grounded = true;
        s.groundNormal.copy(this.stepNormal);
        s.coyoteMs = PHYSICS.coyoteMs;
        if (s.velocity.y < 0) s.velocity.y = 0;
      }
      if (!wasGrounded) {
        s.events |= MovementEvents.Landed;
        s.impactVelocity = -impact;
        if (
          crouch &&
          s.crouchBufferMs > 0 &&
          Math.hypot(s.velocity.x, s.velocity.z) > PHYSICS.slideThreshold
        ) {
          this.startSlide();
          if (s.groundNormal.y < 0.999) {
            this.candidate
              .set(
                s.groundNormal.x * s.groundNormal.y,
                s.groundNormal.y * s.groundNormal.y - 1,
                s.groundNormal.z * s.groundNormal.y,
              )
              .normalize();
            s.velocity.addScaled(this.candidate, (1 - s.groundNormal.y) * PHYSICS.slopeBoost);
          }
        }
      }
    } else s.coyoteMs = Math.max(0, s.coyoteMs - ms);
    if (s.sliding) {
      s.slideTimeMs += ms;
      if (Math.hypot(s.velocity.x, s.velocity.z) < 3) s.sliding = false;
    }
    s.jumpBufferMs = Math.max(0, s.jumpBufferMs - ms);
    s.crouchBufferMs = Math.max(0, s.crouchBufferMs - ms);
    s.padCooldownMs = Math.max(0, s.padCooldownMs - ms);
    const target = s.crouched ? PHYSICS.crouchingEye : PHYSICS.standingEye;
    s.eyeHeight += (target - s.eyeHeight) * (1 - Math.exp(-PHYSICS.eyeDecay * dt));
    const records = this.pads.records;
    if (s.padCooldownMs <= 0)
      for (let i = 0; i < records.length; i += 9)
        if (
          s.position.x >= records[i]! &&
          s.position.x <= records[i + 3]! &&
          s.position.y >= records[i + 1]! &&
          s.position.y <= records[i + 4]! &&
          s.position.z >= records[i + 2]! &&
          s.position.z <= records[i + 5]!
        ) {
          s.velocity.set(records[i + 6]!, records[i + 7]!, records[i + 8]!);
          s.grounded = false;
          s.coyoteMs = 0;
          s.padCooldownMs = 350;
          s.lastPad = i / 9;
          s.events |= MovementEvents.JumpPad;
          break;
        }
  }
  private clip(out: Vec3, velocity: Vec3, normal: Vec3): void {
    const into = dot(velocity, normal);
    out.copy(velocity);
    if (into < 0) out.addScaled(normal, -into * 1.00001);
  }
  private slideMove(position: Vec3, velocity: Vec3, dt: number): void {
    let remaining = dt,
      planeCount = 0;
    this.blocked = false;
    this.originalVelocity.copy(velocity);
    for (let iteration = 0; iteration < 4; iteration++) {
      this.delta.copy(velocity).scale(remaining);
      if (this.delta.lengthSquared() < 1e-14) break;
      if (!this.world.sweepCapsule(this.hit, position, this.height(), PHYSICS.radius, this.delta)) {
        position.add(this.delta);
        break;
      }
      position.addScaled(this.delta, this.hit.fraction);
      remaining *= 1 - this.hit.fraction;
      if (this.hit.normal.y < PHYSICS.walkableNormalY) this.blocked = true;
      this.planes[planeCount++]!.copy(this.hit.normal);
      for (let i = 0; i < planeCount; i++) {
        this.clip(this.candidate, velocity, this.planes[i]!);
        let valid = true;
        for (let j = 0; j < planeCount; j++)
          if (j !== i && dot(this.candidate, this.planes[j]!) < -1e-6) {
            valid = false;
            break;
          }
        if (valid) {
          velocity.copy(this.candidate);
          break;
        }
        if (i === planeCount - 1) {
          if (planeCount === 2) {
            cross(this.crease, this.planes[0]!, this.planes[1]!).normalize();
            velocity.copy(this.crease).scale(dot(this.originalVelocity, this.crease));
          } else velocity.set(0, 0, 0);
        }
      }
      if (dot(velocity, this.originalVelocity) <= 0) {
        velocity.set(0, 0, 0);
        break;
      }
    }
  }
  private tryStep(dt: number): boolean {
    const s = this.state;
    this.flatPosition.copy(s.position);
    this.flatVelocity.copy(s.velocity);
    this.stepPosition.copy(this.startPosition);
    this.stepVelocity.copy(this.startVelocity);
    this.delta.set(0, PHYSICS.stepHeight, 0);
    if (
      this.world.sweepCapsule(
        this.probeHit,
        this.stepPosition,
        this.height(),
        PHYSICS.radius,
        this.delta,
      )
    )
      return false;
    this.stepPosition.add(this.delta);
    this.stepVelocity.y = 0;
    this.slideMove(this.stepPosition, this.stepVelocity, dt);
    this.delta.set(0, -PHYSICS.stepHeight - PHYSICS.groundSnap, 0);
    if (
      !this.world.sweepCapsule(
        this.probeHit,
        this.stepPosition,
        this.height(),
        PHYSICS.radius,
        this.delta,
      )
    )
      return false;
    this.world.triangleNormal(this.stepNormal, this.probeHit.triangle);
    if (this.stepNormal.y < PHYSICS.walkableNormalY || this.probeHit.normal.y <= 0) return false;
    this.stepPosition.addScaled(this.delta, this.probeHit.fraction);
    const flat =
        (this.flatPosition.x - this.startPosition.x) ** 2 +
        (this.flatPosition.z - this.startPosition.z) ** 2,
      stepped =
        (this.stepPosition.x - this.startPosition.x) ** 2 +
        (this.stepPosition.z - this.startPosition.z) ** 2;
    if (
      stepped > flat + 1e-8 &&
      this.stepPosition.y - this.startPosition.y <= PHYSICS.stepHeight + 0.003
    ) {
      s.position.copy(this.stepPosition);
      s.velocity.copy(this.stepVelocity);
      s.groundNormal.copy(this.stepNormal);
      return true;
    }
    return false;
  }
}
