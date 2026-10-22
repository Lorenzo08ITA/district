import assert from 'node:assert/strict';
import {
  WorldBuilder,
  KinematicController,
  PlayerInput,
  InputButtons,
  PacketWriter,
  PacketReader,
  FpsPacketKind,
  PHYSICS,
} from '@district/rts-shared/fps';
const world = new WorldBuilder()
  .box(-100, -1, -100, 100, 0, 100)
  .box(-100, 0, -100, -99, 8, 100)
  .box(99, 0, -100, 100, 8, 100)
  .box(-100, 0, -100, 100, 8, -99)
  .box(-100, 0, 99, 100, 8, 100)
  .box(-4, 0, -6, 4, 0.3, -4)
  .ramp(10, -20, 20, 20, 0, 8)
  .build();
const controller = new KinematicController(world),
  input = new PlayerInput(),
  writer = new PacketWriter(),
  reader = new PacketReader(),
  received = new PlayerInput();
controller.reset(0, 0, 0);
let maxSpeed = 0;
const times = [];
for (let tick = 0; tick < 6000; tick++) {
  input.sequenceNumber = tick;
  input.clientTick = tick;
  input.moveZ = 1;
  input.moveX = Math.sin(tick * 0.03);
  input.yaw = Math.sin(tick * 0.01);
  input.subTickFraction = (tick % 8) / 8;
  input.buttons =
    InputButtons.Sprint |
    (tick % 110 < 2 ? InputButtons.Jump : 0) |
    (tick % 80 > 55 ? InputButtons.Crouch : 0);
  const start = performance.now();
  reader.reset(writer.begin(FpsPacketKind.Inputs).input(input).finish()).input(received);
  controller.step(received);
  times.push(performance.now() - start);
  maxSpeed = Math.max(
    maxSpeed,
    Math.hypot(controller.state.velocity.x, controller.state.velocity.z),
  );
}
times.sort((a, b) => a - b);
assert.equal(controller.state.tick, 6000);
assert.ok(Number.isFinite(controller.state.position.x));
assert.ok(controller.state.position.y > -1);
assert.ok(
  Math.abs(controller.state.position.x) < 100 && Math.abs(controller.state.position.z) < 100,
);
console.log(
  JSON.stringify(
    {
      ticks: 6000,
      hz: PHYSICS.hz,
      triangles: world.triangleCount,
      inputBytes: writer.finish().byteLength,
      maxSpeed,
      p50Ms: times[3000],
      p95Ms: times[5700],
      maxMs: times[5999],
      position: controller.state.position,
    },
    null,
    2,
  ),
);
