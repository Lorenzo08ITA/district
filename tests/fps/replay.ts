import {
  WorldBuilder,
  KinematicController,
  PlayerInput,
  InputButtons,
  PacketWriter,
  PacketReader,
  FpsPacketKind,
  WeaponController,
  FireResult,
  WeaponId,
  quantizeInput,
  Vec3,
  pelletDirection,
} from '@district/rts-shared/fps';
/** The same fixture runs in Node and a real browser Worker; movement values use a micrometre tolerance across JS runtimes. */
export function runFpsReplay() {
  const world = new WorldBuilder()
      .box(-80, -1, -80, 80, 0, 80)
      .box(-80, 0, -80, -79, 8, 80)
      .box(79, 0, -80, 80, 8, 80)
      .box(-80, 0, -80, 80, 8, -79)
      .box(-80, 0, 79, 80, 8, 80)
      .box(-10, 0, -8, -7, 3, 10)
      .box(2, 0, -12, 8, 0.3, -10)
      .ramp(10, -20, 20, 20, 0, 6)
      .build(),
    controller = new KinematicController(world),
    input = new PlayerInput(),
    quantized = new PlayerInput(),
    received = new PlayerInput(),
    writer = new PacketWriter(),
    reader = new PacketReader(),
    weapons = new WeaponController(781),
    shot = new FireResult(),
    direction = new Vec3();
  controller.reset(0, 0, 0);
  let shots = 0,
    checksum = 0;
  const aim = { ads: false, grounded: true, sliding: false, speed: 0 };
  for (let tick = 0; tick < 2400; tick++) {
    input.sequenceNumber = tick;
    input.clientTick = tick;
    input.subTickFraction = (tick % 7) / 7;
    input.moveX = Math.sin(tick * 0.021);
    input.moveZ = 1;
    input.yaw = Math.sin(tick * 0.006) * 2;
    input.pitch = Math.cos(tick * 0.003) * 0.1;
    input.buttons =
      InputButtons.Sprint |
      (tick % 80 < 2 ? InputButtons.Jump : 0) |
      (tick % 113 > 75 ? InputButtons.Crouch : 0);
    quantizeInput(quantized, input);
    reader.reset(writer.begin(FpsPacketKind.Inputs).input(quantized).finish()).input(received);
    controller.step(received);
    const state = controller.state;
    aim.ads = tick % 90 > 45;
    aim.grounded = state.grounded;
    aim.sliding = state.sliding;
    aim.speed = Math.hypot(state.velocity.x, state.velocity.z);
    weapons.update(tick / 60, 1 / 60);
    if (weapons.ammo[0] === 0) weapons.reload(WeaponId.Vanguard, tick / 60);
    if (weapons.trigger(shot, WeaponId.Vanguard, tick / 60, true, aim)) {
      pelletDirection(direction, received.yaw, received.pitch, shot, 0);
      checksum = (checksum + Math.round(direction.x * 1e6) + Math.round(direction.z * 1e6)) | 0;
      shots++;
    }
  }
  return {
    tick: controller.state.tick,
    position: [
      controller.state.position.x,
      controller.state.position.y,
      controller.state.position.z,
    ],
    velocity: [
      controller.state.velocity.x,
      controller.state.velocity.y,
      controller.state.velocity.z,
    ],
    grounded: controller.state.grounded,
    crouched: controller.state.crouched,
    eyeHeight: controller.state.eyeHeight,
    shots,
    checksum,
  };
}
