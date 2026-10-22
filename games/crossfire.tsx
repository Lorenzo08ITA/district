'use client';
import { useEffect, useRef, useState } from 'react';
import { ARENA_NAMES, ARENA_LABELS, type ArenaName } from '@district/rts-shared/fps';
import { FpsRuntime } from '../packages/client/dist/fps/Runtime.js';
import type { GameProps } from './types';
import type { Result } from '../lib/catalog';
type Player = {
  id: number;
  name: string;
  team: number;
  bot: boolean;
  kills?: number;
  deaths?: number;
  hp?: number;
  score?: number;
  respawn?: number;
  carrying?: number;
  radar?: boolean;
};
type Lobby = {
  code: string;
  map: ArenaName;
  mode: string;
  debug: boolean;
  started: boolean;
  host: string;
  players: Player[];
};
const weapons = ['Vanguard AR', 'Kraber', 'Vector', 'Cerberus', 'Sheriff', 'Karambit'];
const modes: Record<string, string> = {
  ffa: 'Deathmatch',
  tdm: 'Team Deathmatch',
  ctf: 'Cattura la bandiera',
  hardpoint: 'Hardpoint',
};
export default function Crossfire({ owner, paused, onAuthoritativeResult }: GameProps) {
  const arenaElement = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null),
    worker = useRef<Worker | null>(null),
    runtime = useRef<FpsRuntime | null>(null),
    keys = useRef(new Set<string>()),
    roster = useRef<Player[]>([]),
    input = useRef({ moveX: 0, moveZ: 0, buttons: 0, weapon: 0 }),
    frame = useRef(new Float64Array(24)),
    identity = useRef({ id: 0, key: '' }),
    finished = useRef(false),
    qualityChoice = useRef<'auto' | 'performance' | 'quality'>('auto'),
    resultCallback = useRef(onAuthoritativeResult);
  resultCallback.current = onAuthoritativeResult;
  const [quality, setQuality] = useState<'auto' | 'performance' | 'quality'>('auto'),
    [map, setMap] = useState<ArenaName>('depot'),
    [mode, setMode] = useState('ffa'),
    [debug, setDebug] = useState(
      () => new URLSearchParams(location.search).get('debug') === 'true',
    ),
    [bots, setBots] = useState(2),
    [code, setCode] = useState(''),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [lobby, setLobby] = useState<Lobby | null>(null),
    [connecting, setConnecting] = useState(false),
    [locked, setLocked] = useState(false),
    [debugPanel, setDebugPanel] = useState(false),
    [scoreboard, setScoreboard] = useState(false),
    [reaction, setReaction] = useState(300),
    [feed, setFeed] = useState<string[]>([]),
    [hit, setHit] = useState({ at: 0, damage: 0, head: false }),
    [hud, setHud] = useState({
      hp: 100,
      ammo: 30,
      reserve: 120,
      weapon: 0,
      reload: 0,
      speed: 0,
      fps: 0,
      queue: 0,
      tick: 0,
      frameMs: 0,
      drawCalls: 0,
      scale: 1,
    }),
    [state, setState] = useState<{
      teamScores: number[];
      remaining: number;
      players: Player[];
    } | null>(null);
  qualityChoice.current = quality;
  const isGuest = owner === 'guest' || owner.startsWith('guest:');
  function control(value: unknown) {
    worker.current?.postMessage({ type: 'control', value });
  }
  function sendInput() {
    const k = keys.current,
      i = input.current;
    i.moveX = Number(k.has('KeyD')) - Number(k.has('KeyA'));
    i.moveZ = Number(k.has('KeyW')) - Number(k.has('KeyS'));
    i.buttons =
      (i.buttons & 24) |
      (k.has('Space') ? 1 : 0) |
      (k.has('ControlLeft') || k.has('KeyC') ? 2 : 0) |
      (k.has('ShiftLeft') ? 4 : 0) |
      (k.has('KeyR') ? 32 : 0) |
      (k.has('KeyF') ? 64 : 0);
    runtime.current?.inspect(!!(i.buttons & 64));
    worker.current?.postMessage({ type: 'input', ...i });
  }
  function release() {
    keys.current.clear();
    input.current.buttons = 0;
    sendInput();
    worker.current?.postMessage({ type: 'release' });
  }
  function dispose() {
    release();
    worker.current?.postMessage({ type: 'stop' });
    worker.current?.terminate();
    worker.current = null;
    runtime.current?.destroy();
    runtime.current = null;
  }
  function connect(kind: 'quick' | 'create' | 'join') {
    if (isGuest) {
      setError('Accedi a un account per entrare nel multiplayer.');
      return;
    }
    dispose();
    setError('');
    setConnecting(true);
    finished.current = false;
    const tabId = crypto.randomUUID(),
      next = new Worker('/generated/fps-worker.js?v=native-4');
    sessionStorage.setItem('district-fps-tab', tabId);
    worker.current = next;
    next.onerror = () => {
      setError('Motore FPS non disponibile. Ricarica la pagina.');
      setConnecting(false);
    };
    const initializeArena = (map: ArenaName) => {
      if (runtime.current || !host.current) return;
      try {
        runtime.current = new FpsRuntime(host.current, map);
        runtime.current.identify(identity.current.id);
        runtime.current.setQuality(qualityChoice.current);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'WebGL non disponibile');
        next.postMessage({ type: 'stop' });
        setConnecting(false);
      }
    };
    next.onmessage = (event) => {
      if (worker.current !== next) return;
      const message = event.data,
        value = message.value;
      switch (message.type) {
        case 'welcome':
          identity.current = { id: value.playerId, key: value.sessionKey };
          if (value.started) initializeArena(value.map);
          setStatus('Connesso');
          setConnecting(false);
          break;
        case 'lobby':
          roster.current = value.players;
          setLobby(value);
          if (value.started) initializeArena(value.map);
          break;
        case 'state':
          roster.current = value.players;
          setState(value);
          runtime.current?.state(value);
          break;
        case 'frame':
          frame.current.set(message.values);
          runtime.current?.frame(
            message.values,
            message.lookSequence ?? 0,
            message.sampledAt - performance.timeOrigin,
          );
          break;
        case 'remote':
          runtime.current?.remote(message.tick, message.values);
          break;
        case 'hit':
          setHit({ at: performance.now(), damage: value.damage, head: value.head });
          break;
        case 'localShot':
          runtime.current?.localShot(message.values);
          break;
        case 'events':
          runtime.current?.events(value.data);
          for (let o = 0; o < value.data.length; o += 16) {
            if (value.data[o] === 3) {
              const actor = roster.current.find((p) => p.id === value.data[o + 1]),
                target = roster.current.find((p) => p.id === value.data[o + 2]);
              setFeed((old) =>
                [`${actor?.name ?? 'Arena'} · ${target?.name ?? 'Giocatore'}`, ...old].slice(0, 4),
              );
            }
          }
          break;
        case 'status':
          setStatus(String(value));
          break;
        case 'error':
          setError(String(value));
          setConnecting(false);
          break;
        case 'result':
          if (!finished.current) {
            finished.current = true;
            document.exitPointerLock();
            release();
            dispose();
            resultCallback.current?.(value as Result);
          }
          break;
      }
    };
    next.postMessage({
      type: 'connect',
      origin: location.origin,
      debug,
      tabId,
      join:
        kind === 'join'
          ? { type: kind, code: code.trim().toUpperCase(), debug, tabId }
          : { type: kind, map, mode, debug, tabId, bots },
    });
  }
  useEffect(() => {
    const timer = setInterval(() => {
      const v = frame.current;
      setHud({
        hp: v[10] || 0,
        ammo: v[12] || 0,
        reserve: v[13] || 0,
        weapon: v[11] || 0,
        reload: v[17] || 0,
        speed: Math.hypot(v[4] || 0, v[6] || 0),
        fps: runtime.current?.fps || 0,
        queue: v[22] || 0,
        tick: v[20] || 0,
        frameMs: runtime.current?.frameMs ?? 0,
        drawCalls: runtime.current?.drawCalls ?? 0,
        scale: runtime.current?.resolutionScale ?? 1,
      });
    }, 100);
    return () => {
      clearInterval(timer);
      dispose();
    };
  }, []);
  useEffect(() => {
    if (paused) {
      release();
      document.exitPointerLock();
    }
  }, [paused]);
  useEffect(() => {
    const change = () => {
      setLocked(document.pointerLockElement === runtime.current?.renderer.domElement);
      if (!document.pointerLockElement) release();
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        document.exitPointerLock();
        release();
        return;
      }
      if (e.code === 'F3') {
        e.preventDefault();
        document.exitPointerLock();
        release();
        setDebugPanel((v) => !v);
        if (!worker.current) setDebug(true);
        return;
      }
      if (document.pointerLockElement !== runtime.current?.renderer.domElement) return;
      if (e.code === 'Tab') {
        e.preventDefault();
        setScoreboard(true);
        return;
      }
      if (['Space', 'ControlLeft', 'ShiftLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code))
        e.preventDefault();
      if (/^Digit[1-6]$/.test(e.code)) input.current.weapon = Number(e.code.slice(-1)) - 1;
      keys.current.add(e.code);
      sendInput();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Tab') setScoreboard(false);
      keys.current.delete(e.code);
      sendInput();
    };
    const move = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      const sequence = runtime.current?.look(e.movementX, e.movementY) ?? 0;
      worker.current?.postMessage({ type: 'look', dx: e.movementX, dy: e.movementY, sequence });
    };
    const mouse = (e: MouseEvent) => {
      if (document.pointerLockElement !== runtime.current?.renderer.domElement) return;
      if (e.button === 0) input.current.buttons |= 8;
      if (e.button === 2) input.current.buttons |= 16;
      sendInput();
    };
    const mouseup = (e: MouseEvent) => {
      if (e.button === 0) input.current.buttons &= ~8;
      if (e.button === 2) input.current.buttons &= ~16;
      sendInput();
    };
    document.addEventListener('pointerlockchange', change);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('mousemove', move);
    window.addEventListener('mousedown', mouse);
    window.addEventListener('mouseup', mouseup);
    window.addEventListener('blur', release);
    return () => {
      document.removeEventListener('pointerlockchange', change);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mousedown', mouse);
      window.removeEventListener('mouseup', mouseup);
      window.removeEventListener('blur', release);
    };
  }, []);
  async function enter() {
    setError('');
    try {
      await runtime.current?.audio.resume();
      await runtime.current?.renderer.domElement.requestPointerLock();
    } catch {
      setError('Clicca di nuovo per abilitare mouse e audio.');
    }
  }
  const players = state?.players ?? lobby?.players ?? [],
    own = players.find((p) => p.id === identity.current.id),
    isHost = lobby?.host === identity.current.key;
  return (
    <div
      ref={arenaElement}
      className="fps-game"
      data-fps={Math.round(hud.fps)}
      data-draw-calls={hud.drawCalls}
      data-render-scale={hud.scale.toFixed(2)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={host}
        className="fps-canvas"
        onClick={() => {
          if (lobby?.started && !locked) void enter();
        }}
      />
      {!lobby && (
        <div className="fps-setup">
          <div className="eyebrow">CROSSFIRE / ARENA</div>
          <h2>Entra. Muoviti. Colpisci.</h2>
          <p>6 armi · 5 mappe · server a 60 Hz</p>
          <div className="fps-fields">
            <label>
              Mappa
              <select
                aria-label="Mappa FPS"
                value={map}
                onChange={(e) => setMap(e.target.value as typeof map)}
              >
                {ARENA_NAMES.map((id) => (
                  <option key={id} value={id}>
                    {ARENA_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Modalità
              <select
                aria-label="Modalità FPS"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                {Object.entries(modes).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bot iniziali
              <select
                aria-label="Bot iniziali"
                value={bots}
                onChange={(e) => setBots(Number(e.target.value))}
              >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="fps-check">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
            Debug · due schede, identità separate sullo stesso account
          </label>
          <div className="fps-actions">
            <button className="primary" disabled={connecting} onClick={() => connect('quick')}>
              Partita rapida
            </button>
            <button disabled={connecting} onClick={() => connect('create')}>
              Crea lobby
            </button>
          </div>
          <div className="fps-join">
            <input
              aria-label="Codice lobby FPS"
              placeholder="CODICE LOBBY"
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button disabled={connecting || code.length !== 6} onClick={() => connect('join')}>
              Entra con codice
            </button>
          </div>
          <p className="fps-help">
            WASD · Spazio salta · Ctrl scivola · Shift corre
            <br />
            Mouse spara / mira · 1–6 armi · R ricarica · Tab classifica · F3 debug
          </p>
          {isGuest && <p>Per giocare serve un account.</p>}
          {connecting && (
            <p role="status">
              {status || 'Collegamento…'}{' '}
              <button
                onClick={() => {
                  dispose();
                  setConnecting(false);
                }}
              >
                Annulla
              </button>
            </p>
          )}
        </div>
      )}
      {lobby && (
        <>
          <div className="fps-top">
            <span>
              {lobby.map.toUpperCase()} / {modes[lobby.mode]}
            </span>
            <button
              title="Copia invito"
              onClick={() => {
                void navigator.clipboard
                  .writeText(lobby.code)
                  .then(() => setStatus('Codice copiato'))
                  .catch(() => setStatus('Invito: ' + lobby.code));
              }}
            >
              Lobby <strong data-testid="fps-code">{lobby.code}</strong> ↗
            </button>
            <span>
              {state
                ? `${state.teamScores[0]} : ${state.teamScores[1]} · ${Math.floor(state.remaining / 3600)}:${String(Math.floor(state.remaining / 60) % 60).padStart(2, '0')}`
                : ''}
            </span>
          </div>
          {!lobby.started && (
            <div className="fps-center">
              <h2>Lobby {lobby.code}</h2>
              <p>
                Condividi il codice. {players.filter((p) => !p.bot).length} giocatori collegati.
              </p>
              {isHost ? (
                <button className="primary" onClick={() => control({ type: 'start' })}>
                  Avvia partita
                </button>
              ) : (
                <p>In attesa del creatore.</p>
              )}
            </div>
          )}
          {lobby.started && (
            <>
              <div
                className="fps-crosshair"
                style={{
                  opacity: hud.hp > 0 ? 1 : 0,
                  transform: `translate(-50%,-50%) scale(${hit.at && performance.now() - hit.at < 140 ? 1.6 : 1})`,
                }}
              >
                +
              </div>
              <div className="hud fps-hud">
                <div>
                  <b>{Math.ceil(hud.hp)}</b> HP <span>{hud.speed.toFixed(1)} m/s</span>
                </div>
                <div>
                  <small>{weapons[hud.weapon]}</small>
                  <b>
                    {hud.ammo}
                    <i> / {hud.reserve}</i>
                  </b>
                  {hud.reload > 0 && <small>Ricarica · {hud.reload.toFixed(1)} s</small>}
                </div>
              </div>
              {hit.at > 0 && performance.now() - hit.at < 400 && (
                <div className="fps-hit" style={{ color: hit.head ? '#ffcf70' : '#fff' }}>
                  ×{' '}
                  <span>
                    {hit.damage}
                    {hit.head ? ' · TESTA' : ''}
                  </span>
                </div>
              )}
              <div className="fps-feed">
                {feed.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
              {!locked && hud.hp > 0 && !paused && (
                <div className="fps-center">
                  <button className="primary" onClick={() => void enter()}>
                    Entra nell’arena
                  </button>
                  <p>Esc libera il mouse</p>
                </div>
              )}
              {hud.hp <= 0 && (
                <div className="fps-center">
                  <h2>Rientro in campo</h2>
                  <p>{((own?.respawn ?? 90) / 60).toFixed(1)} s · nuovo punto di spawn</p>
                </div>
              )}
              <div className={`leaderboard fps-roster ${scoreboard ? 'fps-expanded' : ''}`}>
                {players.map((p) => (
                  <div key={p.id} style={{ color: p.team ? '#ff8eaa' : '#8eefff' }}>
                    <span>
                      {p.id === identity.current.id ? '● ' : ''}
                      {p.name}
                      {p.bot ? ' / BOT' : ''}
                    </span>
                    <b>
                      {p.kills ?? 0} / {p.deaths ?? 0}
                    </b>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="fps-toolbar">
            <span role="status">{status}</span>
            <select
              aria-label="Qualità grafica FPS"
              value={quality}
              onChange={(e) => {
                const value = e.target.value as typeof quality;
                setQuality(value);
                runtime.current?.setQuality(value);
              }}
            >
              <option value="auto">Grafica · automatica</option>
              <option value="performance">Fluidità</option>
              <option value="quality">Qualità alta</option>
            </select>
            <button
              onClick={() => {
                release();
                const operation = document.fullscreenElement
                  ? document.exitFullscreen()
                  : arenaElement.current?.requestFullscreen();
                void operation?.catch(() =>
                  setStatus('Schermo intero non disponibile nel browser.'),
                );
              }}
            >
              Schermo intero
            </button>
            <button onClick={() => setDebugPanel((v) => !v)}>F3 · Debug</button>
            <button
              onClick={() => {
                release();
                document.exitPointerLock();
                control({ type: 'finish' });
              }}
            >
              Concludi e salva
            </button>
          </div>
        </>
      )}
      {debugPanel && (
        <aside className="fps-debug">
          <h3>Sessione #{identity.current.id || '—'}</h3>
          <p>{lobby?.debug ? 'DEBUG · risultati non classificati' : 'Sessione normale'}</p>
          <p>
            {Math.round(hud.fps)} FPS · {hud.frameMs.toFixed(1)} ms · {hud.drawCalls} draw call ·
            risoluzione {Math.round(hud.scale * 100)}% · tick {hud.tick} · input in attesa{' '}
            {hud.queue}
          </p>
          {lobby?.debug && isHost && (
            <>
              <label>
                Reazione bot: {reaction} ms
                <input
                  aria-label="Reazione bot"
                  type="range"
                  min={100}
                  max={2000}
                  step={100}
                  value={reaction}
                  onChange={(e) => setReaction(Number(e.target.value))}
                />
              </label>
              <button onClick={() => control({ type: 'bots', count: 1, reactionMs: reaction })}>
                Aggiungi Strafe Bot
              </button>
            </>
          )}
          <p>
            Per due schede: abilita Debug in entrambe, crea una lobby, entra nell’altra con lo
            stesso codice.
          </p>
        </aside>
      )}
      {error && (
        <div className="fps-error" role="alert">
          {error}
          <button aria-label="Chiudi errore" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
