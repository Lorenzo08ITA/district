'use client';
import { useEffect, useRef, useState } from 'react';
import { loadCheckpoint, saveCheckpoint } from '../lib/checkpoints';
import { z } from 'zod';
import * as THREE from 'three';
import { blocked, walls, clamp } from './simulation';
import type { GameProps } from './types';
export default function ThreeGame(props: GameProps & { kind: 'crossfire' | 'drift' | 'prism' }) {
  const holder = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const keys = useRef(new Set<string>()),
    [hud, setHud] = useState(''),
    [error, setError] = useState(''),
    [locked, setLocked] = useState(false),
    [scores, setScores] = useState<any[]>([]);
  const look = useRef({ yaw: 0, pitch: 0, fire: false });
  useEffect(() => {
    const container = holder.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      setError('WebGL non disponibile. Attiva l’accelerazione hardware o prova un altro browser.');
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor('#141d24');
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#141d24', props.kind === 'prism' ? 0.018 : 0.012);
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 180);
    scene.add(camera);
    const ambient = new THREE.HemisphereLight('#e1f0f0', '#71816b', 3);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight('#f5d9a1', 3);
    sun.position.set(20, 40, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    scene.add(sun);
    function box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.75 }),
      );
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    }
    const ground = box(200, 0.3, 200, '#23342f', 0, -0.2, 0);
    ground.receiveShadow = true;
    const grid = new THREE.GridHelper(120, 60, '#537164', '#2a4039');
    grid.position.y = 0.01;
    scene.add(grid);
    let car: THREE.Group | undefined;
    function makeCar(color: string) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.55, 3.2),
        new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.3 }),
      );
      body.position.y = 0.6;
      body.castShadow = true;
      group.add(body);
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.35, 0.5, 1.5),
        new THREE.MeshStandardMaterial({ color: '#273844', metalness: 0.6, roughness: 0.2 }),
      );
      cabin.position.set(0, 1.1, -0.2);
      group.add(cabin);
      for (const x of [-0.85, 0.85])
        for (const z of [-1, 1]) {
          const wheel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.36, 0.36, 0.25, 12),
            new THREE.MeshStandardMaterial({ color: '#14181a' }),
          );
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x, 0.36, z);
          group.add(wheel);
        }
      for (const x of [-0.55, 0.55]) {
        const lamp = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.15, 0.05),
          new THREE.MeshBasicMaterial({ color: '#e8f3ba' }),
        );
        lamp.position.set(x, 0.65, -1.62);
        group.add(lamp);
      }
      scene.add(group);
      return group;
    }
    let weapon: THREE.Group | undefined, muzzle: THREE.Mesh | undefined;
    if (props.kind === 'crossfire') {
      for (const wall of walls) {
        box(wall.w, 3.5, wall.d, '#667963', wall.x, 1.75, wall.z);
        box(wall.w + 0.08, 0.12, wall.d + 0.08, '#bfce8f', wall.x, 3.55, wall.z);
      }
      for (const x of [-20, 20]) box(1, 4, 41, '#41534b', x, 2, 0);
      for (const z of [-20, 20]) box(41, 4, 1, '#41534b', 0, 2, z);
      for (let i = 0; i < 12; i++) {
        const x = Math.cos((i / 12) * Math.PI * 2) * 30,
          z = Math.sin((i / 12) * Math.PI * 2) * 30;
        box(4, 6 + (i % 4) * 3, 4, '#293d38', x, 3, z);
      }
      weapon = new THREE.Group();
      const main = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.2, 0.6),
        new THREE.MeshStandardMaterial({ color: '#303940', metalness: 0.8, roughness: 0.3 }),
      );
      weapon.add(main);
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.45, 8),
        new THREE.MeshStandardMaterial({ color: '#161c20' }),
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = -0.42;
      weapon.add(barrel);
      const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.25, 0.1),
        new THREE.MeshStandardMaterial({ color: '#b2c18c' }),
      );
      grip.position.set(0, -0.18, 0.08);
      weapon.add(grip);
      weapon.position.set(0.33, -0.28, -0.65);
      camera.add(weapon);
      muzzle = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 6, 6),
        new THREE.MeshBasicMaterial({ color: '#ffe5a3' }),
      );
      muzzle.position.set(0, 0, -0.65);
      muzzle.visible = false;
      weapon.add(muzzle);
    }
    if (props.kind === 'drift') {
      car = makeCar('#c4b1ec');
      car.position.set(24, 0, 0);
      const vertices: number[] = [],
        indices: number[] = [];
      for (let i = 0; i <= 128; i++) {
        const t = (i / 128) * Math.PI * 2;
        for (const side of [-1, 1])
          vertices.push(Math.cos(t) * (24 + side * 3), 0.03, Math.sin(t) * (16 + side * 3));
        if (i < 128) {
          const n = i * 2;
          indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const road = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: '#363840', side: THREE.DoubleSide }),
      );
      road.receiveShadow = true;
      scene.add(road);
      for (let i = 0; i < 72; i++) {
        const t = (i / 72) * Math.PI * 2;
        for (const side of [-1, 1]) {
          const curb = box(
            1,
            0.15,
            0.3,
            i % 2 ? '#e4b394' : '#c3cec0',
            Math.cos(t) * (24 + side * 3),
            0.09,
            Math.sin(t) * (16 + side * 3),
          );
          curb.rotation.y = -t;
        }
      }
      for (let i = 0; i < 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        const mark = box(0.12, 0.02, 0.6, '#a4a4a0', Math.cos(t) * 24, 0.06, Math.sin(t) * 16);
        mark.rotation.y = -t;
      }
      for (let i = 0; i < 30; i++) {
        const t = (i / 30) * Math.PI * 2;
        const x = Math.cos(t) * 36,
          z = Math.sin(t) * 28;
        box(0.3, 5, 0.3, '#4b6260', x, 2.5, z);
        box(1.4, 0.15, 0.4, '#d6b3ee', x, 5, z);
      }
      box(8, 0.025, 1, '#e5e4d4', 24, 0.08, 0);
    }
    const prismObstacles: THREE.Mesh[] = [];
    if (props.kind === 'prism') {
      ground.material = new THREE.MeshStandardMaterial({ color: '#1b1d32' });
      for (const x of [-6, -2, 2, 6]) box(0.07, 0.04, 200, '#8d7cac', x, 0.05, -50);
      for (let i = 0; i < 28; i++) {
        box(0.3, 1, 0.3, '#c3a6df', -8, 0.5, -i * 7);
        box(0.3, 1, 0.3, '#c3a6df', 8, 0.5, -i * 7);
      }
      car = new THREE.Group();
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.65),
        new THREE.MeshStandardMaterial({ color: '#d1eb85', metalness: 0.5, roughness: 0.25 }),
      );
      car.add(gem);
      car.position.set(0, 1, 3);
      scene.add(car);
      camera.position.set(0, 5, 12);
      camera.lookAt(0, 1, -15);
    }
    const actors = new Map<string, THREE.Group>();
    let frame = 0,
      last = performance.now(),
      time = 0,
      net = 0,
      hudTime = 0,
      speed = 0,
      heading = 0,
      pos = new THREE.Vector3(24, 0, 0),
      lane = 1,
      spawn = 0,
      points = 0,
      ended = false,
      lap = 0,
      checkpoint = 0,
      lapStart = 0,
      bestLap = 0,
      distance = 0,
      fires = 0,
      flash = 0,
      lastLane = 0;
    const predicted = new THREE.Vector3(15, 1.6, -12);
    let spawned = false;
    const restored = props.online
      ? null
      : z
          .object({
            kind: z.literal(props.kind),
            time: z.number().min(0).max(86400),
            points: z.number().min(0).max(1000000),
            speed: z.number().min(-7).max(28),
            heading: z.number().finite(),
            x: z.number().min(-55).max(55),
            z: z.number().min(-45).max(45),
            lap: z.number().int().min(0).max(2),
            checkpoint: z.number().int().min(0).max(3),
            lapStart: z.number(),
            bestLap: z.number(),
            distance: z.number().min(0),
            lane: z.number().int().min(0).max(2),
            obstacles: z.array(z.object({ x: z.number(), z: z.number() })).max(100),
          })
          .safeParse(loadCheckpoint(props.owner, props.game.id)?.data);
    if (restored?.success) {
      const s = restored.data;
      time = s.time;
      points = s.points;
      speed = s.speed;
      heading = s.heading;
      pos.set(s.x, 0, s.z);
      lap = s.lap;
      checkpoint = s.checkpoint;
      lapStart = s.lapStart;
      bestLap = s.bestLap;
      distance = s.distance;
      lane = s.lane;
      for (const o of s.obstacles) prismObstacles.push(box(1.8, 2, 1.8, '#ed968f', o.x, 1, o.z));
    }
    let savedAt = time;
    function save() {
      if (!props.online && !ended && time > 0)
        saveCheckpoint(props.owner, props.game.id, {
          kind: props.kind,
          time,
          points,
          speed,
          heading,
          x: pos.x,
          z: pos.z,
          lap,
          checkpoint,
          lapStart,
          bestLap,
          distance,
          lane,
          obstacles: prismObstacles.map((o) => ({ x: o.position.x, z: o.position.z })),
        });
    }

    function finish(won = false) {
      if (ended) return;
      ended = true;
      latest.current.onEnd({
        score: Math.floor(points),
        durationMs: Math.round(time * 1000),
        won,
        stats: {
          laps: lap,
          bestLapMs: Math.floor(bestLap * 1000),
          distance: Math.round(distance),
          shots: fires,
          survivalSeconds: Math.floor(time),
          maxSpeed: Math.round(speed * 5),
        },
      });
    }
    function resize() {
      const rect = container.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    function keyDown(event: KeyboardEvent) {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code))
        event.preventDefault();
      keys.current.add(event.code);
    }
    function keyUp(event: KeyboardEvent) {
      keys.current.delete(event.code);
    }
    function clear() {
      keys.current.clear();
      look.current.fire = false;
    }
    function mouseMove(event: MouseEvent) {
      if (document.pointerLockElement !== renderer.domElement) return;
      look.current.yaw -= event.movementX * 0.002;
      look.current.pitch = clamp(look.current.pitch - event.movementY * 0.002, -1.4, 1.4);
    }
    function down() {
      if (props.kind === 'crossfire') {
        if (document.pointerLockElement !== renderer.domElement)
          renderer.domElement.requestPointerLock?.();
        else look.current.fire = true;
      }
    }
    function up() {
      look.current.fire = false;
    }
    function lock() {
      setLocked(document.pointerLockElement === renderer.domElement);
      clear();
    }
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clear);
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', up);
    document.addEventListener('pointerlockchange', lock);
    renderer.domElement.addEventListener('mousedown', down);
    function animate() {
      frame = requestAnimationFrame(animate);
      const now = performance.now(),
        dt = latest.current.paused || ended ? 0 : Math.min(0.04, (now - last) / 1000);
      last = now;
      time += dt;
      net += dt;
      hudTime += dt;
      const k = keys.current,
        left = k.has('KeyA') || k.has('ArrowLeft'),
        right = k.has('KeyD') || k.has('ArrowRight'),
        forward = k.has('KeyW') || k.has('ArrowUp'),
        back = k.has('KeyS') || k.has('ArrowDown');
      const snapshot = latest.current.network.state.current,
        me = snapshot?.actors.find((a) => a.id === latest.current.network.playerId);
      if (props.kind === 'crossfire') {
        const yaw = look.current.yaw,
          pitch = look.current.pitch;
        const x = Number(right) - Number(left),
          z = Number(forward) - Number(back),
          norm = Math.max(1, Math.hypot(x, z));
        const dx = ((Math.cos(yaw) * x - Math.sin(yaw) * z) / norm) * 7 * dt,
          dz = ((-Math.sin(yaw) * x - Math.cos(yaw) * z) / norm) * 7 * dt;
        if (!blocked(predicted.x + dx, predicted.z)) predicted.x += dx;
        if (!blocked(predicted.x, predicted.z + dz)) predicted.z += dz;
        if (me && !spawned) {
          spawned = true;
          predicted.set(me.x, 1.6, me.z);
          look.current.yaw = Math.atan2(me.x, me.z);
        }
        if (me) {
          predicted.x += (me.x - predicted.x) * Math.min(1, dt * 8);
          predicted.z += (me.z - predicted.z) * Math.min(1, dt * 8);
          if (Math.hypot(me.x - predicted.x, me.z - predicted.z) > 5)
            predicted.set(me.x, 1.6, me.z);
        }
        camera.position.copy(predicted);
        camera.rotation.order = 'YXZ';
        camera.rotation.set(pitch, yaw, 0);
        if (net > 0.033) {
          latest.current.network.socket.current?.emit('input', {
            x,
            z,
            yaw,
            pitch,
            fire: look.current.fire && !latest.current.paused,
          });
          net = 0;
        }
        flash = Math.max(0, flash - dt);
        if (look.current.fire && flash === 0 && dt) {
          flash = 0.18;
          fires++;
        }
        if (muzzle) muzzle.visible = flash > 0.13;
        if (weapon) weapon.position.z = -0.65 + Math.max(0, flash - 0.1) * 0.6;
      }
      if (props.kind === 'drift' && car) {
        const throttle = Number(forward) - Number(back);
        speed = clamp(speed + throttle * 12 * dt, -7, 28);
        speed *= Math.exp(-(k.has('Space') ? 4 : throttle === 0 ? 0.5 : 0.08) * dt);
        heading +=
          (Number(left) - Number(right)) *
          Math.min(1, Math.abs(speed) / 4) *
          1.8 *
          dt *
          Math.sign(speed || 1);
        const previous = pos.clone();
        pos.x -= Math.sin(heading) * speed * dt;
        pos.z -= Math.cos(heading) * speed * dt;
        distance += previous.distanceTo(pos);
        const radius = Math.hypot(pos.x / 24, pos.z / 16),
          onRoad = Math.abs(radius - 1) < 0.15;
        if (!onRoad) speed *= Math.exp(-2.6 * dt);
        pos.x = clamp(pos.x, -55, 55);
        pos.z = clamp(pos.z, -45, 45);
        car.position.copy(pos);
        car.rotation.y = heading;
        const angle = (Math.atan2(-pos.z / 16, pos.x / 24) + Math.PI * 2) % (Math.PI * 2);
        const sector = Math.floor(angle / (Math.PI / 2));
        if (onRoad && sector === (checkpoint + 1) % 4) {
          checkpoint = sector;
          if (sector === 0) {
            lap++;
            const t = time - lapStart;
            bestLap = bestLap ? Math.min(t, bestLap) : t;
            lapStart = time;
            if (lap >= 3) finish(true);
          }
        }
        points = lap * 1000 + checkpoint * 200;
        const desired = new THREE.Vector3(
          pos.x + Math.sin(heading) * 7,
          5,
          pos.z + Math.cos(heading) * 7,
        );
        camera.position.lerp(desired, Math.min(1, dt * 6));
        camera.lookAt(pos.x, 1, pos.z);
        if (net > 0.08 && latest.current.online) {
          latest.current.network.socket.current?.emit('input', {
            px: pos.x,
            pz: pos.z,
            yaw: heading,
            score: points,
          });
          net = 0;
        }
      }
      if (props.kind === 'prism' && car) {
        if (time - lastLane > 0.16) {
          if (left) {
            lane = Math.max(0, lane - 1);
            lastLane = time;
          }
          if (right) {
            lane = Math.min(2, lane + 1);
            lastLane = time;
          }
        }
        car.position.x += ((lane - 1) * 4 - car.position.x) * Math.min(1, dt * 18);
        car.rotation.z += dt;
        spawn -= dt;
        if (spawn <= 0) {
          spawn = Math.max(0.45, 1.2 - time * 0.006);
          const obstacle = box(
            1.8,
            2,
            1.8,
            '#ed968f',
            (Math.floor(Math.random() * 3) - 1) * 4,
            1,
            -100,
          );
          obstacle.rotation.y = Math.PI / 4;
          prismObstacles.push(obstacle);
        }
        for (let i = prismObstacles.length - 1; i >= 0; i--) {
          const o = prismObstacles[i];
          o.position.z += Math.min(50, 22 + time * 0.3) * dt;
          o.rotation.y += dt;
          if (Math.abs(o.position.z - 3) < 1.6 && Math.abs(o.position.x - car.position.x) < 1.6)
            finish();
          if (o.position.z > 15) {
            scene.remove(o);
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
            prismObstacles.splice(i, 1);
          }
        }
        points = time * 10;
      }
      for (const a of snapshot?.actors || []) {
        if (a.id === latest.current.network.playerId) continue;
        let group = actors.get(a.id);
        if (!group) {
          group = props.kind === 'drift' ? makeCar('#e7ac8f') : new THREE.Group();
          if (props.kind === 'crossfire') {
            const body = new THREE.Mesh(
              new THREE.CapsuleGeometry(0.45, 0.8, 4, 8),
              new THREE.MeshStandardMaterial({ color: '#d8a182' }),
            );
            body.position.y = 1;
            body.castShadow = true;
            group.add(body);
            const head = new THREE.Mesh(
              new THREE.BoxGeometry(0.48, 0.4, 0.48),
              new THREE.MeshStandardMaterial({ color: '#b8c4aa' }),
            );
            head.position.y = 1.75;
            group.add(head);
            scene.add(group);
          }
          actors.set(a.id, group);
          group.position.set(a.x, 0, a.z);
        }
        group.position.lerp(new THREE.Vector3(a.x, 0, a.z), Math.min(1, dt * 14));
        group.rotation.y = a.yaw;
      }
      if (hudTime > 0.15) {
        hudTime = 0;
        setHud(
          props.kind === 'crossfire'
            ? `${me?.hp ?? 100} HP · ${me?.kills ?? 0} eliminazioni · ${Math.ceil((snapshot?.remaining ?? 90000) / 1000)}s`
            : props.kind === 'drift'
              ? `Giro ${Math.min(3, lap + 1)} / 3 · ${Math.round(Math.abs(speed) * 5)} km/h · ${Math.floor(time)}s`
              : `${Math.floor(points)} punti · ${Math.floor(time)}s`,
        );
        if (snapshot) setScores([...snapshot.actors].sort((a, b) => b.score - a.score));
      }
      if (time - savedAt > 5) {
        savedAt = time;
        save();
      }
      renderer.render(scene, camera);
    }
    animate();
    return () => {
      save();
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clear);
      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('pointerlockchange', lock);
      renderer.domElement.removeEventListener('mousedown', down);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      keys.current.clear();
    };
  }, [props.kind]);
  function touch(code: string, down: boolean) {
    if (down) keys.current.add(code);
    else keys.current.delete(code);
  }
  return (
    <div className="canvas-holder">
      <div ref={holder} style={{ width: '100%', height: '100%' }} />
      {error ? (
        <div className="game-overlay">
          <p role="alert">{error}</p>
        </div>
      ) : (
        <>
          <div className="hud">
            <strong style={{ fontSize: 16 }}>{hud}</strong>
          </div>
          {props.online && (
            <div className="leaderboard">
              <b>CLASSIFICA LIVE</b>
              {scores.map((a) => (
                <div key={a.id}>
                  <span>{a.name}</span>
                  <span>{a.score}</span>
                </div>
              ))}
            </div>
          )}
          {props.kind === 'crossfire' && (
            <>
              <div className="reticle">+</div>
              {!locked && !props.paused && (
                <div className="start-3d" style={{ pointerEvents: 'none' }}>
                  <span
                    style={{ background: '#0008', padding: 15, borderRadius: 8, color: 'white' }}
                  >
                    Clic nell’arena per mirare · Esc per uscire
                  </span>
                </div>
              )}
            </>
          )}
          <div className="touch-controls">
            <div>
              {['KeyA', 'KeyW', 'KeyS', 'KeyD'].map((code, i) => (
                <button
                  key={code}
                  aria-label={['Sinistra', 'Accelera / avanti', 'Indietro', 'Destra'][i]}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    touch(code, true);
                  }}
                  onPointerUp={() => touch(code, false)}
                  onPointerCancel={() => touch(code, false)}
                >
                  {['←', '↑', '↓', '→'][i]}
                </button>
              ))}
            </div>
            {props.kind === 'crossfire' && (
              <div>
                <button aria-label="Mira a sinistra" onClick={() => (look.current.yaw += 0.15)}>
                  ↶
                </button>
                <button aria-label="Mira a destra" onClick={() => (look.current.yaw -= 0.15)}>
                  ↷
                </button>
                <button
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    look.current.fire = true;
                  }}
                  onPointerUp={() => (look.current.fire = false)}
                  onPointerCancel={() => (look.current.fire = false)}
                >
                  ◎
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
