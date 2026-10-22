'use client';
import { z } from 'zod';
import { loadCheckpoint, saveCheckpoint } from '../lib/checkpoints';
import { useEffect, useRef, useState } from 'react';
import {
  botTerritory,
  conquer,
  createTerritory,
  stepTerritory,
  type Territory,
} from './simulation';
import type { GameProps } from './types';
type Kind = 'pulse' | 'wing' | 'orbit' | 'frontier' | 'flux';
const colors = [
  '#cfeb80',
  '#f2a28c',
  '#87bfd5',
  '#c5a1df',
  '#e7c879',
  '#8fc8a8',
  '#c6ab90',
  '#95a8d7',
];
export function flipGrid(cells: boolean[], i: number) {
  const next = [...cells];
  for (const p of [i, i % 5 ? i - 1 : -1, i % 5 < 4 ? i + 1 : -1, i - 5, i + 5])
    if (p >= 0 && p < 25) next[p] = !next[p];
  return next;
}
export default function CanvasGame(props: GameProps & { kind: Kind }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    latest = useRef(props);
  latest.current = props;
  const [hud, setHud] = useState(''),
    [score, setScore] = useState(0),
    [leaders, setLeaders] = useState<{ id: string; name: string; score: number }[]>([]);
  useEffect(() => {
    const node = canvas.current!,
      context = node.getContext('2d');
    if (!context) return;
    const ctx = context;
    let running = true,
      frame = 0,
      last = performance.now(),
      time = 0,
      netTime = 0,
      ended = false,
      points = 0,
      jumps = 0,
      moves = 0,
      level = 1,
      spawn = 0,
      v = 0,
      y = 400,
      aliveTime = 0,
      mouse = { x: 480, y: 270 },
      fish = { x: 555, y: 210, size: 10 },
      obstacles: { x: number; y: number; w: number; h: number; scored?: boolean }[] = [],
      pellets = Array.from({ length: 100 }, () => ({
        x: Math.random() * 900 + 30,
        y: Math.random() * 470 + 30,
      })),
      territory = createTerritory(4),
      tickAccum = 0;
    let cells = Array(25).fill(false);
    for (let i = 0; i < 15; i++) cells = flipGrid(cells, Math.floor(Math.random() * 25));
    if (!cells.some(Boolean)) cells = flipGrid(cells, 12);
    const kind = props.kind;
    const schema = z.object({
      kind: z.literal(kind),
      time: z.number().min(0).max(86400),
      points: z.number().min(0).max(1000000),
      jumps: z.number(),
      moves: z.number(),
      level: z.number(),
      spawn: z.number(),
      v: z.number(),
      y: z.number(),
      fish: z.object({ x: z.number(), y: z.number(), size: z.number().min(5).max(100) }),
      obstacles: z
        .array(
          z.object({
            x: z.number(),
            y: z.number(),
            w: z.number(),
            h: z.number(),
            scored: z.boolean().optional(),
          }),
        )
        .max(50),
      pellets: z.array(z.object({ x: z.number(), y: z.number() })).length(100),
      cells: z.array(z.boolean()).length(25),
      territory: z.object({
        owners: z.array(z.number().int().min(-2).max(7)).length(576),
        armies: z.array(z.number().min(0).max(999)).length(576),
        capitals: z.array(z.number().int().min(0).max(575)).max(8),
        alive: z.array(z.boolean()).max(8),
        tick: z.number(),
      }),
    });
    const restored = props.online
      ? null
      : schema.safeParse(loadCheckpoint(props.owner, props.game.id)?.data);
    if (restored?.success) {
      const s = restored.data;
      time = s.time;
      aliveTime = s.time;
      points = s.points;
      jumps = s.jumps;
      moves = s.moves;
      level = s.level;
      spawn = s.spawn;
      v = s.v;
      y = s.y;
      fish = s.fish;
      obstacles = s.obstacles;
      pellets = s.pellets;
      cells = s.cells;
      territory = s.territory;
    }
    let savedAt = time;
    function save() {
      if (!props.online && !ended && time > 0)
        saveCheckpoint(props.owner, props.game.id, {
          kind,
          time,
          points,
          jumps,
          moves,
          level,
          spawn,
          v,
          y,
          fish,
          obstacles,
          pellets,
          cells,
          territory,
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
          jumps,
          moves,
          level,
          obstacles: points,
          aliveSeconds: Math.floor(aliveTime),
          territories: kind === 'frontier' ? territory.owners.filter((o) => o === 0).length : 0,
          fishSize: Math.round(fish.size),
          completed: won,
        },
      });
    }
    function point(event: PointerEvent) {
      const rect = node.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * 960,
        y: ((event.clientY - rect.top) / rect.height) * 540,
      };
    }
    function jump() {
      if (ended || latest.current.paused) return;
      if (kind === 'pulse' && y >= 399) {
        v = -610;
        jumps++;
      }
      if (kind === 'wing') {
        v = -340;
        jumps++;
      }
    }
    function click(event: PointerEvent) {
      mouse = point(event);
      node.focus();
      if (kind === 'pulse' || kind === 'wing') jump();
      if (kind === 'flux' && !ended) {
        const col = Math.floor((mouse.x - 315) / 66),
          row = Math.floor((mouse.y - 88) / 66);
        if (col >= 0 && col < 5 && row >= 0 && row < 5) {
          cells = flipGrid(cells, row * 5 + col);
          moves++;
          if (!cells.some(Boolean)) {
            points = Math.max(100, 2000 - moves * 35);
            finish(true);
          }
        }
      }
      if (kind === 'frontier' && !ended) {
        const col = Math.floor((mouse.x - 240) / 20),
          row = Math.floor((mouse.y - 30) / 20);
        if (col >= 0 && col < 24 && row >= 0 && row < 24) {
          const target = row * 24 + col;
          if (latest.current.online)
            latest.current.network.socket.current?.emit('input', { target });
          else if (conquer(territory, 0, target)) moves++;
        }
      }
    }
    function key(event: KeyboardEvent) {
      if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) jump();
      }
    }
    const move = (event: PointerEvent) => (mouse = point(event));
    node.addEventListener('pointerdown', click);
    node.addEventListener('pointermove', move);
    window.addEventListener('keydown', key);
    function bg() {
      ctx.fillStyle = '#101718';
      ctx.fillRect(0, 0, 960, 540);
      ctx.strokeStyle = '#ffffff07';
      ctx.lineWidth = 1;
      for (let x = -((time * 20) % 48); x < 960; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 540);
        ctx.stroke();
      }
      for (let y = 0; y < 540; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(960, y);
        ctx.stroke();
      }
    }
    function draw() {
      if (!running) return;
      frame = requestAnimationFrame(draw);
      const now = performance.now();
      let dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      if (ended || latest.current.paused) dt = 0;
      time += dt;
      aliveTime += dt;
      const ratio = Math.min(devicePixelRatio || 1, 2),
        rect = node.getBoundingClientRect();
      if (
        node.width !== Math.round(rect.width * ratio) ||
        node.height !== Math.round(rect.height * ratio)
      ) {
        node.width = Math.round(rect.width * ratio);
        node.height = Math.round(rect.height * ratio);
      }
      ctx.setTransform(node.width / 960, 0, 0, node.height / 540, 0, 0);
      bg();
      const snapshot = latest.current.network.state.current;
      const me = snapshot?.actors.find((a) => a.id === latest.current.network.playerId);
      if (kind === 'pulse' || kind === 'wing') {
        level = 1 + Math.floor(time / 15);
        const speed =
          kind === 'pulse' ? Math.min(620, 310 + time * 3) : Math.min(350, 205 + time * 1.8);
        spawn -= dt;
        if (spawn <= 0) {
          spawn = kind === 'pulse' ? 1.15 + Math.random() * 0.5 : 1.65;
          obstacles.push(
            kind === 'pulse'
              ? { x: 1000, y: 400, w: 30 + Math.random() * 18, h: 32 + Math.random() * 18 }
              : {
                  x: 1000,
                  y: 100 + Math.random() * 230,
                  w: 65,
                  h: Math.max(125, 195 - time * 0.7),
                },
          );
        }
        if (kind === 'pulse') {
          v += 1700 * dt;
          y = Math.min(400, y + v * dt);
          if (y === 400) v = 0;
        } else {
          if (time < 0.05 && y === 400) y = 245;
          v += 880 * dt;
          y += v * dt;
          if (y < 15 || y > 515) finish();
        }
        ctx.fillStyle = kind === 'pulse' ? '#748344' : '#568899';
        ctx.fillRect(0, 432, 960, 108);
        ctx.fillStyle = kind === 'pulse' ? '#cfeb80' : '#8dccdf';
        ctx.fillRect(0, 430, 960, 2);
        for (const o of obstacles) {
          o.x -= speed * dt;
          ctx.fillStyle = kind === 'pulse' ? '#edb986' : '#80b6bd';
          if (kind === 'pulse') {
            ctx.beginPath();
            ctx.moveTo(o.x, 432);
            ctx.lineTo(o.x + o.w / 2, 432 - o.h);
            ctx.lineTo(o.x + o.w, 432);
            ctx.fill();
            if (155 + 27 > o.x + 5 && 155 < o.x + o.w - 5 && y + 30 > 432 - o.h + 6) finish();
          } else {
            ctx.fillRect(o.x, 0, o.w, o.y);
            ctx.fillRect(o.x, o.y + o.h, o.w, 540 - o.y - o.h);
            ctx.fillStyle = '#afd4cd';
            ctx.fillRect(o.x - 5, o.y - 12, o.w + 10, 12);
            ctx.fillRect(o.x - 5, o.y + o.h, o.w + 10, 12);
            if (155 + 26 > o.x && 155 < o.x + o.w && (y < o.y || y + 26 > o.y + o.h)) finish();
          }
          if (o.x + o.w < 155 && !o.scored) {
            o.scored = true;
            points += kind === 'pulse' ? 10 : 1;
          }
        }
        obstacles = obstacles.filter((o) => o.x > -100);
        ctx.save();
        ctx.translate(170, y + 15);
        if (kind === 'pulse' && y < 400) ctx.rotate(time * 6);
        ctx.fillStyle = kind === 'pulse' ? '#d0eb83' : '#eea8c4';
        ctx.fillRect(-15, -15, 30, 30);
        ctx.strokeStyle = '#1c352a';
        ctx.lineWidth = 3;
        ctx.strokeRect(-8, -8, 16, 16);
        ctx.restore();
        if (time > 120) finish(true);
      }
      if (kind === 'orbit') {
        const dx = mouse.x - fish.x,
          dy = mouse.y - fish.y,
          d = Math.hypot(dx, dy);
        const step = Math.min(d, Math.max(90, 180 - fish.size) * dt);
        if (d > 1) {
          fish.x += (dx / d) * step;
          fish.y += (dy / d) * step;
        }
        ctx.fillStyle = '#719a77';
        for (const p of pellets) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
          if (Math.hypot(p.x - fish.x, p.y - fish.y) < fish.size + 4) {
            points += 1;
            fish.size = Math.min(90, fish.size + 0.12);
            p.x = Math.random() * 900 + 30;
            p.y = Math.random() * 470 + 30;
          }
        }
        function drawFish(x: number, y: number, size: number, color: string, name: string) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.ellipse(x, y, size * 1.3, size, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(x - size, y);
          ctx.lineTo(x - size * 2, y - size * 0.8);
          ctx.lineTo(x - size * 2, y + size * 0.8);
          ctx.fill();
          ctx.fillStyle = '#122323';
          ctx.beginPath();
          ctx.arc(x + size * 0.6, y - size * 0.25, Math.max(2, size * 0.14), 0, 7);
          ctx.fill();
          ctx.fillStyle = '#deeadc';
          ctx.textAlign = 'center';
          ctx.font = '11px Arial';
          ctx.fillText(name, x, y + size + 16);
        }
        for (const a of snapshot?.actors || []) {
          if (a.id === latest.current.network.playerId) continue;
          const x = 480 + a.x * 5,
            y = 270 + a.z * 5;
          drawFish(x, y, a.size, '#e7b595', a.name);
          if (a.size > fish.size * 1.3 && Math.hypot(x - fish.x, y - fish.y) < a.size) finish();
        }
        drawFish(fish.x, fish.y, fish.size, '#9dd9cb', 'Tu');
      }
      if (kind === 'flux') {
        ctx.font = '14px Arial';
        ctx.fillStyle = '#a5b4ac';
        ctx.textAlign = 'center';
        ctx.fillText('Spegni tutte le luci. Ogni clic cambia anche i vicini.', 480, 54);
        cells.forEach((on, i) => {
          const x = 315 + (i % 5) * 66,
            y = 88 + Math.floor(i / 5) * 66;
          ctx.fillStyle = on ? '#cfe88a' : '#263735';
          ctx.beginPath();
          ctx.roundRect(x, y, 58, 58, 7);
          ctx.fill();
          if (on) {
            ctx.fillStyle = '#eaf5c7';
            ctx.beginPath();
            ctx.arc(x + 29, y + 29, 5, 0, 7);
            ctx.fill();
          }
        });
        points = moves;
      }
      if (kind === 'frontier') {
        if (latest.current.online && snapshot?.territory)
          territory = snapshot.territory as Territory;
        if (!latest.current.online && dt > 0) {
          tickAccum += dt;
          while (tickAccum >= 1 / 30) {
            stepTerritory(territory);
            tickAccum -= 1 / 30;
          }
          if (Math.floor((time - dt) * 2) !== Math.floor(time * 2))
            for (let i = 1; i < 4; i++) botTerritory(territory, i);
          if (!territory.alive[0]) finish(false);
          if (territory.alive.filter(Boolean).length === 1 && territory.alive[0]) {
            points = territory.owners.filter((o) => o === 0).length * 10;
            finish(true);
          }
          if (time > 180)
            finish(
              territory.owners.filter((o) => o === 0).length >=
                Math.max(...[1, 2, 3].map((p) => territory.owners.filter((o) => o === p).length)),
            );
        }
        const playerIndex = latest.current.online
          ? (snapshot?.actors.findIndex((a) => a.id === latest.current.network.playerId) ?? 0)
          : 0;
        territory.owners.forEach((owner, i) => {
          const x = 240 + (i % 24) * 20,
            y = 30 + Math.floor(i / 24) * 20;
          ctx.fillStyle =
            owner === -2 ? '#101a24' : owner < 0 ? '#3a4440' : colors[owner % colors.length];
          ctx.globalAlpha = owner >= 0 ? 0.8 : 1;
          ctx.fillRect(x + 1, y + 1, 18, 18);
          ctx.globalAlpha = 1;
          if (territory.capitals.includes(i)) {
            ctx.fillStyle = '#152421';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('◆', x + 10, y + 15);
          } else if (owner === playerIndex && territory.armies[i] > 0) {
            ctx.fillStyle = '#243123';
            ctx.font = '8px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(String(territory.armies[i]), x + 10, y + 13);
          }
        });
        ctx.textAlign = 'left';
        ctx.fillStyle = colors[Math.max(0, playerIndex) % 8];
        ctx.font = '13px Arial';
        ctx.fillText('IL TUO COLORE', 35, 100);
        ctx.fillRect(35, 120, 28, 28);
        ctx.fillStyle = '#aab8ac';
        ctx.font = '12px Arial';
        for (const [n, text] of [
          'Le montagne sono invalicabili.',
          'Attacca una casella vicina.',
          'Le truppe crescono da sole.',
          'La capitale vale tutto.',
        ].entries())
          ctx.fillText(text, 35, 210 + n * 25);
        points = territory.owners.filter((o) => o === playerIndex).length * 10;
      }
      if (time - savedAt > 5) {
        savedAt = time;
        save();
      }
      netTime += dt;
      if (netTime > 0.1) {
        netTime = 0;
        setScore(Math.floor(points));
        setHud(
          kind === 'frontier'
            ? `Territori ${Math.floor(points / 10)}`
            : kind === 'flux'
              ? `${moves} mosse`
              : kind === 'orbit'
                ? `Taglia ${Math.floor(fish.size)}`
                : `Livello ${level}`,
        );
        if (snapshot)
          setLeaders(
            snapshot.actors
              .map((a) => ({ id: a.id, name: a.name, score: a.score }))
              .sort((a, b) => b.score - a.score),
          );
        if (latest.current.online && kind !== 'frontier')
          latest.current.network.socket.current?.emit('input', {
            score: points,
            px: kind === 'orbit' ? (fish.x - 480) / 5 : me?.x,
            pz: kind === 'orbit' ? (fish.y - 270) / 5 : me?.z,
            size: kind === 'orbit' ? fish.size : undefined,
          });
      }
    }
    frame = requestAnimationFrame(draw);
    return () => {
      save();
      running = false;
      cancelAnimationFrame(frame);
      node.removeEventListener('pointerdown', click);
      node.removeEventListener('pointermove', move);
      window.removeEventListener('keydown', key);
    };
  }, [props.kind]);
  return (
    <div className="canvas-holder">
      <canvas ref={canvas} tabIndex={0} aria-label={props.game.title} />
      <div className="hud">
        <strong>{score}</strong>
        <span>{hud}</span>
      </div>
      {props.online && (
        <div className="leaderboard">
          <b>CLASSIFICA LIVE</b>
          {leaders.map((p) => (
            <div key={p.id}>
              <span>{p.name}</span>
              <span>{Math.floor(p.score)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
