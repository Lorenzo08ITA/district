import { describe, it, expect } from 'vitest';
import { GameRoom, FpsEvent } from '../../packages/server/src/fps/GameRoom';
import { WorldHistoryBuffer, POSE_STRIDE } from '../../packages/server/src/fps/History';
import {
  WorldBuilder,
  ObbRaycaster,
  RayHit,
  Quaternion,
  PlayerInput,
  InputButtons,
  WeaponId,
  Vec3,
  createArena,
  SpawnSelector,
} from '@district/rts-shared/fps';
import { SecondOrderSpring3D } from '../../packages/client/src/fps/SecondOrderSpring3D';
function players(mode: 'ffa' | 'tdm' | 'ctf' | 'hardpoint' = 'ffa') {
  const room = new GameRoom('nexus', mode, 123);
  const a = room.add('Alpha', 'a', 'a'),
    b = room.add('Beta', 'b', 'b');
  return { room, a, b };
}
function place(p: ReturnType<typeof players>['a'], x: number, z: number) {
  p.controller.reset(x, 0.01, z);
  p.input.moveX = p.input.moveZ = p.input.buttons = 0;
  p.protectedUntil = 0;
}
describe('FPS authoritative rooms', () => {
  it('runs identical seeded bots, physics and scores', () => {
    const a = new GameRoom('sandstorm', 'tdm', 42),
      b = new GameRoom('sandstorm', 'tdm', 42);
    for (let n = 0; n < 4; n++) {
      a.add('Bot', '', 'b' + n, true, 100);
      b.add('Bot', '', 'b' + n, true, 100);
    }
    for (let n = 0; n < 600; n++) {
      a.step();
      b.step();
    }
    expect(a.positions).toEqual(b.positions);
    expect(a.teamScores).toEqual(b.teamScores);
    expect(a.players.map((p) => p.hp)).toEqual(b.players.map((p) => p.hp));
  });
  it('rejects duplicates, sequence jumps and full input queues', () => {
    const { room, a } = players(),
      input = new PlayerInput();
    input.sequenceNumber = 1;
    room.enqueue(a, input);
    expect(() => room.enqueue(a, input)).toThrow('duplicata');
    input.sequenceNumber = 300;
    expect(() => room.enqueue(a, input)).toThrow('finestra');
    for (let n = 2; n <= 120; n++) {
      input.sequenceNumber = n;
      room.enqueue(a, input);
    }
    input.sequenceNumber = 121;
    expect(() => room.enqueue(a, input)).toThrow('eccessivi');
  });
  it('limits speed by executing one input per server tick', () => {
    const { room, a } = players();
    place(a, -31, 25);
    for (let n = 1; n <= 60; n++) {
      const input = new PlayerInput();
      input.sequenceNumber = n;
      input.moveZ = 1;
      room.enqueue(a, input);
    }
    room.step();
    expect(a.queue.length).toBe(4);
    expect(
      Math.hypot(a.controller.state.position.x + 31, a.controller.state.position.z - 25),
    ).toBeLessThan(0.3);
    expect(a.lastProcessed).toBe(56);
  });
  it('balances teams, bounds capacity and clears a reused player slot', () => {
    const room = new GameRoom('nexus', 'tdm', 2);
    for (let n = 0; n < 12; n++) room.add('P', '', 'p' + n);
    expect(room.players.filter((p) => p.team === 0)).toHaveLength(6);
    expect(() => room.add('P', '', 'extra')).toThrow('piena');
    const first = room.players[0]!;
    first.kills = 20;
    first.lastAccepted = 99;
    first.active = false;
    const reused = room.add('New', '', 'new');
    expect(reused.kills).toBe(0);
    expect(reused.lastAccepted).toBe(0);
  });
  it('authoritatively hits a head, kills, and respawns after 90 ticks', () => {
    const { room, a, b } = players();
    place(a, -39, 25);
    place(b, -39, 15);
    a.input.weapon = WeaponId.Kraber;
    a.input.yaw = 0;
    for (let n = 0; n < 70; n++) room.step();
    a.protectedUntil = b.protectedUntil = 0;
    const input = new PlayerInput();
    input.sequenceNumber = 1;
    input.weapon = WeaponId.Kraber;
    input.buttons = InputButtons.Fire | InputButtons.Ads;
    room.enqueue(a, input);
    room.step();
    expect(b.hp).toBe(0);
    expect(a.kills).toBe(1);
    expect(a.headshots).toBe(1);
    expect(b.deaths).toBe(1);
    expect(room.events.data.some((v, i) => i % 16 === 0 && v === FpsEvent.Hit)).toBe(true);
    a.input.buttons = 0;
    for (let n = 0; n < 90; n++) room.step();
    expect(b.hp).toBe(100);
    expect(b.generation).toBe(2);
    expect(b.protectedUntil).toBeGreaterThan(room.tickNumber);
  });
  it('blocks friendly fire and solid walls', () => {
    for (const mode of ['ffa', 'tdm'] as const) {
      const { room, a, b } = players(mode);
      place(a, mode === 'tdm' ? -31 : -13, mode === 'tdm' ? 25 : 5);
      place(b, mode === 'tdm' ? -31 : -13, mode === 'tdm' ? 15 : -15);
      if (mode === 'tdm') b.team = a.team;
      a.input.weapon = 1;
      for (let n = 0; n < 70; n++) room.step();
      a.protectedUntil = b.protectedUntil = 0;
      const input = new PlayerInput();
      input.sequenceNumber = 1;
      input.weapon = 1;
      input.buttons = InputButtons.Fire;
      room.enqueue(a, input);
      room.step();
      expect(b.hp).toBe(100);
    }
  });
  it('allows a powerful weapon to penetrate a single thin wall', () => {
    const { room, a, b } = players();
    room.arena.world = new WorldBuilder().box(-40, 0, 23, -38, 3, 23.1).build();
    place(a, -39, 25);
    place(b, -39, 15);
    a.input.weapon = WeaponId.Kraber;
    for (let n = 0; n < 70; n++) room.step();
    a.protectedUntil = b.protectedUntil = 0;
    const input = new PlayerInput();
    input.sequenceNumber = 1;
    input.weapon = WeaponId.Kraber;
    input.buttons = InputButtons.Fire | InputButtons.Ads;
    room.enqueue(a, input);
    room.step();
    expect(b.hp).toBe(0);
    expect(a.damage).toBe(100);
  });
  it('never shoots through a fifth thin wall after exhausting the penetration iteration budget', () => {
    const { room, a, b } = players();
    const world = new WorldBuilder();
    for (let n = 0; n < 5; n++) world.box(-40, 0, 23 - n * 0.4, -38, 3, 23.1 - n * 0.4);
    room.arena.world = world.build();
    place(a, -39, 25);
    place(b, -39, 15);
    a.input.weapon = WeaponId.Kraber;
    for (let n = 0; n < 70; n++) room.step();
    a.protectedUntil = b.protectedUntil = 0;
    const input = new PlayerInput();
    input.sequenceNumber = 1;
    input.weapon = WeaponId.Kraber;
    input.buttons = InputButtons.Fire | InputButtons.Ads;
    room.enqueue(a, input);
    room.step();
    expect(b.hp).toBe(100);
  });
  it('carries an enemy flag, forces a pistol and scores only at own base', () => {
    const { room, a, b } = players('ctf');
    place(b, 30, 25);
    place(a, 0, -27);
    room.step();
    expect(a.carrying).toBe(1);
    room.step();
    expect(a.weapon).toBe(WeaponId.Sheriff);
    place(a, 0, 27);
    room.step();
    expect(a.captures).toBe(1);
    expect(room.teamScores[0]).toBe(1);
    expect(room.flagHome[1]).toBe(1);
    expect(a.carrying).toBe(-1);
  });
  it('scores uncontested hardpoints; contested points stop scoring', () => {
    const { room, a, b } = players('hardpoint');
    place(a, -24, 0);
    place(b, 30, 25);
    for (let n = 0; n < 60; n++) room.step();
    expect(room.teamScores[0]).toBe(1);
    place(b, -24, 1);
    for (let n = 0; n < 60; n++) room.step();
    expect(room.teamScores[0]).toBe(1);
    room.tickNumber = 2699;
    room.step();
    expect(room.hardpoint).toBe(1);
  });
  it('ends each mode at a finite match deadline', () => {
    for (const mode of ['ffa', 'tdm', 'ctf', 'hardpoint'] as const) {
      const room = new GameRoom('sandstorm', mode, 1, 2);
      room.add('A', 'a', 'a');
      room.step();
      room.step();
      expect(room.ended).toBe(true);
      const tick = room.tickNumber;
      room.step();
      expect(room.tickNumber).toBe(tick);
    }
  });
  it('interpolates hitboxes but never rewinds into another life', () => {
    const { a } = players(),
      history = new WorldHistoryBuffer(1),
      pose = new Float64Array(POSE_STRIDE);
    place(a, 0, 20);
    history.record(1, [a]);
    a.controller.state.position.x = 10;
    history.record(2, [a]);
    expect(history.sample(pose, 0, 1.5, a.generation)).toBe(true);
    expect(pose[0]).toBeCloseTo(5);
    a.generation++;
    history.record(3, [a]);
    expect(history.sample(pose, 0, 2.5, a.generation)).toBe(false);
  });
  it('aligns anatomical hitboxes with the visible forward direction', () => {
    const { a } = players(),
      history = new WorldHistoryBuffer(1),
      pose = new Float64Array(POSE_STRIDE),
      angle = Math.PI / 4;
    place(a, 0, 20);
    a.yaw = angle;
    history.record(0, [a]);
    expect(history.sample(pose, 0, 0, a.generation)).toBe(true);
    const center = new Vec3(pose[10]!, pose[11]!, pose[12]!),
      half = new Vec3(pose[13]!, pose[14]!, pose[15]!),
      quaternion = new Quaternion().set(pose[16]!, pose[17]!, pose[18]!, pose[19]!),
      origin = new Vec3(center.x + Math.sin(angle) * 5, center.y, center.z - Math.cos(angle) * 5),
      direction = new Vec3(-Math.sin(angle), 0, Math.cos(angle)),
      hit = new RayHit();
    expect(new ObbRaycaster().cast(hit, origin, direction, center, half, quaternion)).toBe(true);
    expect(hit.distance).toBeCloseTo(5 - 0.16, 6);
  });
  it('selects valid spawns away from occupied enemy positions', () => {
    const arena = createArena('nexus'),
      selector = new SpawnSelector(),
      out = new Vec3(),
      positions = new Float64Array([0, 0, 27]),
      alive = new Uint8Array([1]),
      teams = new Uint8Array([1]);
    selector.choose(out, arena, positions, alive, teams, 0, false, 4);
    expect(arena.world.fits(out, 1.8, 0.32)).toBe(true);
    expect(Math.hypot(out.x, out.z - 27)).toBeGreaterThan(20);
  });
});
describe('FPS render springs', () => {
  it('converges consistently across render rates', () => {
    for (const damping of [0.7, 1, 1.4]) {
      const a = new SecondOrderSpring3D(5, damping),
        b = new SecondOrderSpring3D(5, damping);
      a.target.x = b.target.x = 1;
      for (let n = 0; n < 60; n++) a.update(1 / 60);
      for (let n = 0; n < 144; n++) b.update(1 / 144);
      expect(a.position.x).toBeCloseTo(b.position.x, 9);
      expect(a.position.x).toBeCloseTo(1, 5);
    }
  });
});
