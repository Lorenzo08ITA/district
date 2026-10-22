import { describe, it, expect } from 'vitest';
import {
  WorldBuilder,
  Vec3,
  accelerate,
  PHYSICS,
  KinematicController,
  PlayerInput,
  InputButtons,
  MovementEvents,
  JumpPads,
} from '@district/rts-shared/fps';
const floor = () => new WorldBuilder().box(-100, -1, -100, 100, 0, 100);
function run(controller: KinematicController, input: PlayerInput, count: number) {
  for (let i = 0; i < count; i++) {
    input.sequenceNumber++;
    input.clientTick++;
    controller.step(input);
  }
}
describe('FPS kinematics', () => {
  it('accelerates by projected speed without deleting strafe momentum', () => {
    const velocity = new Vec3(15, 0, 0);
    accelerate(velocity, new Vec3(0, 0, -1), 3.2, 28, 1 / 60);
    expect(velocity.x).toBe(15);
    expect(velocity.z).toBeCloseTo((-28 / 60) * 3.2);
    accelerate(velocity, new Vec3(1, 0, 0), 3.2, 28, 1 / 60);
    expect(velocity.x).toBe(15);
  });
  it('reaches sprint speed and stays supported on the floor', () => {
    const controller = new KinematicController(floor().build()),
      input = new PlayerInput();
    controller.reset(0, 0, 0);
    input.moveZ = 1;
    input.buttons = InputButtons.Sprint;
    run(controller, input, 120);
    expect(Math.hypot(controller.state.velocity.x, controller.state.velocity.z)).toBeCloseTo(
      12.8,
      3,
    );
    expect(controller.state.position.y).toBeCloseTo(0.001, 2);
    expect(controller.state.grounded).toBe(true);
  });
  it('prevents tunnelling and slides along walls', () => {
    const controller = new KinematicController(floor().box(-0.05, 0, -20, 0.05, 4, 20).build()),
      input = new PlayerInput();
    controller.reset(-4, 0, 0);
    controller.state.velocity.set(300, 0, -12);
    input.buttons = InputButtons.Jump;
    controller.step(input);
    expect(controller.state.position.x).toBeLessThan(-0.36 + 0.01);
    expect(controller.state.position.z).toBeLessThan(0);
    expect(controller.state.velocity.x).toBeLessThan(0.01);
  });
  it('climbs low steps but cannot climb tall cover', () => {
    for (const height of [0.3, 1.2]) {
      const controller = new KinematicController(floor().box(-2, 0, -4, 2, height, -2).build()),
        input = new PlayerInput();
      controller.reset(0, 0, 0);
      input.moveZ = 1;
      let maxY = 0;
      for (let i = 0; i < 50; i++) {
        controller.step(input);
        maxY = Math.max(maxY, controller.state.position.y);
      }
      if (height < 0.45) {
        expect(maxY).toBeGreaterThan(0.28);
        expect(controller.state.position.z).toBeLessThan(-4);
      } else {
        expect(maxY).toBeLessThan(0.02);
        expect(controller.state.position.z).toBeGreaterThan(-1.7);
      }
    }
  });
  it('splits the jump at sub-tick time including the end boundary', () => {
    const early = new KinematicController(floor().build()),
      late = new KinematicController(floor().build()),
      input = new PlayerInput();
    early.reset(0, 0, 0);
    late.reset(0, 0, 0);
    input.buttons = InputButtons.Jump;
    early.step(input);
    input.subTickFraction = 1;
    late.step(input);
    expect(early.state.position.y).toBeGreaterThan(0.1);
    expect(late.state.position.y).toBeLessThan(0.01);
    expect(late.state.velocity.y).toBeCloseTo(9.4);
  });
  it('retains momentum and adds a bounded slide-hop boost', () => {
    const controller = new KinematicController(floor().build()),
      input = new PlayerInput();
    controller.reset(0, 0, 0);
    controller.state.velocity.set(0, 0, -12);
    input.buttons = InputButtons.Crouch | InputButtons.Jump;
    controller.step(input);
    expect(controller.state.events & MovementEvents.Jumped).toBeTruthy();
    expect(-controller.state.velocity.z).toBeGreaterThan(12);
    expect(-controller.state.velocity.z).toBeLessThan(13.4);
    expect(controller.state.crouched).toBe(true);
  });
  it('buffers jumps shortly before landing without auto-bunnyhopping a held key', () => {
    const controller = new KinematicController(floor().build()),
      input = new PlayerInput();
    controller.reset(0, 0.3, 0);
    controller.state.velocity.y = -4;
    input.buttons = InputButtons.Jump;
    let jumped = false;
    for (let i = 0; i < 15; i++) {
      controller.step(input);
      if (controller.state.events & MovementEvents.Jumped) jumped = true;
    }
    expect(jumped).toBe(true);
    run(controller, input, 120);
    expect(controller.state.grounded).toBe(true);
  });
  it('honours coyote time and rejects a late airborne jump', () => {
    for (const wait of [2, 10]) {
      const controller = new KinematicController(
          new WorldBuilder().box(-2, -1, -2, 2, 0, 2).build(),
        ),
        input = new PlayerInput();
      controller.reset(0, 0, 1.95);
      controller.state.velocity.z = 12;
      run(controller, input, wait);
      expect(controller.state.grounded).toBe(false);
      input.buttons = InputButtons.Jump;
      controller.step(input);
      expect(controller.state.velocity.y > 0).toBe(wait === 2);
    }
  });
  it('crouches under cover and refuses to stand into the ceiling', () => {
    const controller = new KinematicController(floor().box(-3, 1.1, -5, 3, 3, -1).build()),
      input = new PlayerInput();
    controller.reset(0, 0, 1);
    input.moveZ = 1;
    input.buttons = InputButtons.Crouch;
    run(controller, input, 35);
    expect(controller.state.position.z).toBeLessThan(-1);
    input.moveZ = 0;
    input.buttons = 0;
    run(controller, input, 4);
    expect(controller.state.crouched).toBe(true);
    expect(controller.state.eyeHeight).toBeLessThan(0.9);
  });
  it('triggers a jump-pad impulse only once during cooldown', () => {
    const controller = new KinematicController(
        floor().build(),
        new JumpPads([-1, -0.1, -1, 1, 0.3, 1, 4, 16, -10]),
      ),
      input = new PlayerInput();
    controller.reset(0, 0, 0);
    controller.step(input);
    expect(controller.state.events & MovementEvents.JumpPad).toBeTruthy();
    expect(controller.state.velocity.y).toBe(16);
    expect(controller.state.velocity.x).toBe(4);
    controller.step(input);
    expect(controller.state.events & MovementEvents.JumpPad).toBeFalsy();
    expect(controller.state.velocity.y).toBeLessThan(16);
  });
  it('is repeatable over a mixed 1200-tick replay', () => {
    const world = floor().box(-8, 0, -20, -5, 3, -3).ramp(3, -10, 8, 10, 0, 3).build(),
      a = new KinematicController(world),
      b = new KinematicController(world),
      input = new PlayerInput();
    a.reset(0, 0, 0);
    b.reset(0, 0, 0);
    for (let tick = 0; tick < 1200; tick++) {
      input.clientTick = tick;
      input.yaw = Math.sin(tick * 0.01) * 2;
      input.moveX = Math.sin(tick * 0.03);
      input.moveZ = 1;
      input.buttons =
        InputButtons.Sprint |
        (tick % 90 < 2 ? InputButtons.Jump : 0) |
        (tick % 70 < 20 ? InputButtons.Crouch : 0);
      input.subTickFraction = (tick % 10) / 10;
      a.step(input);
      b.step(input);
    }
    expect(a.state).toEqual(b.state);
    expect(Number.isFinite(a.state.position.x)).toBe(true);
    expect(PHYSICS.hz).toBe(60);
  });
});

it('starts a buffered slide on landing and applies downhill slope boost', () => {
  const world = new WorldBuilder().ramp(-20, -20, 20, 20, 0, 16).build(),
    sliding = new KinematicController(world),
    normal = new KinematicController(world),
    input = new PlayerInput(),
    plain = new PlayerInput();
  sliding.reset(0, 9.1, 0);
  normal.reset(0, 9.1, 0);
  sliding.state.velocity.set(0, -12, -12);
  normal.state.velocity.set(0, -12, -12);
  input.buttons = InputButtons.Crouch;
  let landed = false;
  for (let i = 0; i < 8; i++) {
    sliding.step(input);
    normal.step(plain);
    if (sliding.state.events & MovementEvents.Landed) {
      landed = true;
      expect(sliding.state.events & MovementEvents.SlideStarted).toBeTruthy();
      expect(sliding.state.sliding).toBe(true);
      expect(sliding.state.velocity.z).toBeLessThan(normal.state.velocity.z);
      break;
    }
  }
  expect(landed).toBe(true);
});
it('cannot step upward into a low ceiling', () => {
  const controller = new KinematicController(
      floor().box(-2, 0, -4, 2, 0.4, -2).box(-3, 1.95, -5, 3, 3, 1).build(),
    ),
    input = new PlayerInput();
  controller.reset(0, 0, 0);
  input.moveZ = 1;
  run(controller, input, 60);
  expect(controller.state.position.z).toBeGreaterThan(-1.7);
  expect(controller.state.position.y).toBeLessThan(0.1);
});
it('expires an early aerial crouch buffer before landing', () => {
  const controller = new KinematicController(floor().build()),
    input = new PlayerInput();
  controller.reset(0, 4, 0);
  controller.state.velocity.set(0, 0, -12);
  input.buttons = InputButtons.Crouch;
  let landed = false;
  for (let i = 0; i < 90; i++) {
    controller.step(input);
    if (controller.state.events & MovementEvents.Landed) {
      landed = true;
      expect(controller.state.sliding).toBe(false);
      break;
    }
  }
  expect(landed).toBe(true);
});

it('keeps ground contact while walking uphill instead of alternating with airborne ticks', () => {
  const controller = new KinematicController(new WorldBuilder().ramp(-4, 0, 4, 30, 0, 7.5).build()),
    input = new PlayerInput();
  controller.reset(0, 0.25, 1);
  input.moveZ = 1;
  input.yaw = Math.PI;
  input.buttons = InputButtons.Sprint;
  let supported = 0;
  for (let tick = 0; tick < 60; tick++) {
    controller.step(input);
    if (controller.state.grounded) supported++;
  }
  expect(supported).toBeGreaterThan(58);
  expect(controller.state.position.z).toBeGreaterThan(10);
  expect(controller.state.position.y).toBeGreaterThan(2.5);
});
