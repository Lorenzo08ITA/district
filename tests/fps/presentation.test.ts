import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ARENA_NAMES,
  createArena,
  KinematicController,
  PlayerInput,
} from '@district/rts-shared/fps';
import { ProceduralWeaponFactory } from '../../packages/client/src/fps/Assets';
import { batchStaticMeshes } from '../../packages/client/src/fps/Surfaces';
import { WorldBackdrop } from '../../packages/client/src/fps/Backdrop';
import { PosePresentation, RenderBudget } from '../../packages/client/src/fps/Presentation';
describe('FPS tactical arenas', () => {
  for (const name of ARENA_NAMES)
    it(name + ': valid spawn volumes and reproducible collision geometry', () => {
      const arena = createArena(name),
        again = createArena(name),
        controller = new KinematicController(arena.world, arena.pads);
      expect(arena.surfaces).toEqual(again.surfaces);
      for (let n = 0; n < arena.spawns.length; n += 3) {
        controller.reset(arena.spawns[n]!, arena.spawns[n + 1]!, arena.spawns[n + 2]!);
        expect(arena.world.fits(controller.state.position, 1.8, 0.32)).toBe(true);
      }
      for (let n = 0; n < arena.surfaces.length; n += 8) {
        expect(arena.surfaces[n + 3]).toBeGreaterThan(arena.surfaces[n]!);
        expect(arena.surfaces[n + 5]).toBeGreaterThan(arena.surfaces[n + 2]!);
      }
    });
  for (const name of ['depot', 'bastion', 'cedar'] as const)
    it(name + ': traversable three-lane route between flag bases', () => {
      const arena = createArena(name),
        controller = new KinematicController(arena.world, arena.pads),
        input = new PlayerInput();
      controller.reset(0, 0.05, 27);
      const lane = name === 'depot' ? 12 : 8;
      for (const [x, z] of [
        [lane, 27],
        [lane, -27],
        [0, -27],
      ]) {
        let ticks = 0;
        while (
          Math.hypot(controller.state.position.x - x!, controller.state.position.z - z!) > 0.6 &&
          ticks++ < 600
        ) {
          input.moveZ = 1;
          input.yaw = Math.atan2(
            x! - controller.state.position.x,
            -(z! - controller.state.position.z),
          );
          input.sequenceNumber++;
          controller.step(input);
        }
        expect(ticks).toBeLessThan(600);
      }
    });
});
describe('FPS presentation', () => {
  it('interpolates camera position without interpolating input aim or status', () => {
    const p = new PosePresentation(),
      a = new Float64Array(24);
    a[10] = 100;
    p.push(a, 100);
    a[1] = 1;
    a[8] = 0.7;
    a[12] = 20;
    p.push(a, 100 + 1000 / 60);
    expect(p.sample(100 + 1000 / 60)[1]).toBeCloseTo(0);
    expect(p.sample(100 + 1000 / 60 + 1000 / 120)[1]).toBeCloseTo(0.5);
    expect(p.sample(250)[1]).toBe(1);
    expect(p.sample(210)[8]).toBe(0.7);
    expect(p.sample(210)[12]).toBe(20);
  });
  it('snaps respawns/teleports without sweeping across the arena', () => {
    const p = new PosePresentation(),
      a = new Float64Array(24);
    a[10] = 100;
    p.push(a, 1);
    a[1] = 40;
    expect(p.push(a, 2)).toBe(true);
    expect(p.sample(2)[1]).toBe(40);
    a[10] = 0;
    a[1] = 39;
    expect(p.push(a, 3)).toBe(true);
    expect(p.sample(3)[1]).toBe(39);
  });
  it('reduces only supersampling under load, ignores suspended tabs, and recovers slowly', () => {
    const p = new RenderBudget(1, 1.5, 1.25);
    let time = 1;
    for (let n = 0; n < 100; n++) {
      time += 33;
      p.sample(33, time);
    }
    expect(p.scale).toBeLessThan(1.25);
    expect(p.scale).toBeGreaterThanOrEqual(1);
    const scale = p.scale;
    for (let n = 0; n < 30; n++) {
      time += 1000;
      p.sample(1000, time);
    }
    expect(p.scale).toBe(scale);
    for (let n = 0; n < 1500; n++) {
      time += 8;
      p.sample(8, time);
    }
    expect(p.scale).toBeGreaterThan(scale);
    expect(p.scale).toBeLessThanOrEqual(1.5);
  });
  it('uses simulation timestamps across coalesced frames and ignores stale delivery', () => {
    const p = new PosePresentation(),
      a = new Float64Array(24);
    a[10] = 100;
    p.push(a, 100);
    a[1] = 0.4;
    p.push(a, 150);
    expect(p.sample(150)[1]).toBeCloseTo((0.4 * 2) / 3);
    expect(p.sample(150 + 1000 / 60)[1]).toBeCloseTo(0.4);
    a[1] = 0.2;
    p.push(a, 120);
    expect(p.sample(200)[1]).toBeCloseTo(0.4);
  });
  it('never scales a native-resolution budget below one pixel per CSS pixel', () => {
    const p = new RenderBudget(1, 1, 1);
    for (let n = 1; n < 500; n++) p.sample(50, n * 50);
    expect(p.scale).toBe(1);
  });
  it('batches static material siblings while retaining animated pivots and bounds', () => {
    const root = new THREE.Group(),
      pivot = new THREE.Group(),
      material = new THREE.MeshStandardMaterial();
    for (let n = 0; n < 10; n++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.position.x = n;
      root.add(mesh);
    }
    pivot.position.y = 2;
    root.add(pivot);
    pivot.add(new THREE.Mesh(new THREE.SphereGeometry(0.5), material));
    const before = new THREE.Box3().setFromObject(root);
    batchStaticMeshes(root);
    const after = new THREE.Box3().setFromObject(root);
    expect(before.min.distanceTo(after.min)).toBeLessThan(1e-6);
    expect(before.max.distanceTo(after.max)).toBeLessThan(1e-6);
    expect(root.children).toHaveLength(2);
    expect(root.children).toContain(pivot);
    pivot.position.y = 5;
    expect(new THREE.Box3().setFromObject(root).max.y).toBeGreaterThan(5);
  });
  it('builds finite atmospheric terrain and instanced cutout foliage on every map', () => {
    const factory = new ProceduralWeaponFactory();
    for (const map of ARENA_NAMES) {
      const scene = new WorldBackdrop(map, true, factory.surfaces);
      scene.update(10, 3, 1.6, 2);
      let meshes = 0;
      scene.root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          meshes++;
          const positions = o.geometry.getAttribute('position');
          for (let n = 0; n < positions.count; n++) {
            expect(Number.isFinite(positions.getX(n))).toBe(true);
            expect(Number.isFinite(positions.getY(n))).toBe(true);
          }
        }
      });
      expect(meshes).toBeLessThanOrEqual(5);
      scene.dispose();
    }
    factory.surfaces.dispose();
  });
  it('tiles architectural surfaces in world units instead of stretching tiny textures', () => {
    const factory = new ProceduralWeaponFactory(),
      root = factory.buildArena(createArena('depot'));
    const floor = root.children.find(
      (o) =>
        o instanceof THREE.Mesh &&
        o.material instanceof THREE.MeshLambertMaterial &&
        o.material.color.getHex() === 0x737b80,
    ) as THREE.Mesh;
    expect(floor).toBeDefined();
    const uv = floor.geometry.getAttribute('uv');
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      min = Math.min(min, uv.getX(i));
      max = Math.max(max, uv.getX(i));
    }
    expect(max - min).toBeCloseTo(21.5);
    factory.surfaces.dispose();
  });
  it('batches character palettes without losing animated limbs or team armor', () => {
    const factory = new ProceduralWeaponFactory(),
      rig = factory.createCharacter(0);
    let draws = 0;
    rig.root.traverse((o) => {
      if (o instanceof THREE.Mesh) draws++;
    });
    expect(draws).toBeLessThan(28);
    expect(rig.root.children).toContain(rig.leftLeg);
    expect(rig.leftLeg.children.length).toBeGreaterThan(0);
    rig.armor.color.setHex(0x82715c);
    expect(rig.armor.color.getHex()).toBe(0x82715c);
    factory.surfaces.dispose();
  });
  it('builds all textured weapons and all arenas within a static draw budget', () => {
    const factory = new ProceduralWeaponFactory();
    for (let id = 0; id < 6; id++) {
      const gun = factory.create(id);
      let draws = 0;
      gun.root.traverse((object) => {
        if (object instanceof THREE.Mesh) draws++;
      });
      expect(draws).toBeLessThan(18);
      expect(new THREE.Box3().setFromObject(gun.root).isEmpty()).toBe(false);
      expect(gun.root.children).toContain(gun.muzzle);
    }
    for (const map of ARENA_NAMES) {
      const root = factory.buildArena(createArena(map));
      let draws = 0;
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) draws++;
      });
      expect(draws).toBeLessThan(24);
    }
    expect(factory.metal.normalMap).toBeTruthy();
    expect(factory.metal.roughnessMap).toBeTruthy();
    factory.surfaces.dispose();
  });
});
