'use client';
import { useEffect, useRef, useState } from 'react';
import {
  BuildingKind,
  CommandKind,
  UnitKind,
  WeaponKind,
  encodeCommands,
  encodeWire,
  decodeWire,
  WireKind,
  BUILDING_RULES,
  WORLD_BALANCE,
  type CommandPayload,
} from '@district/rts-shared';
import type { MapName, EngineSnapshot } from '@district/rts-engine';
import { Renderer, compact } from '../packages/client/dist/Renderer.js';
import type {
  RenderFrame,
  WorkerRequest,
  WorkerResponse,
  TickFrame,
} from '../packages/client/src/messages';
import {
  readSave,
  readCompletion,
  writeSave,
  type SavedGame,
} from '../packages/client/dist/storage.js';
import type { GameProps } from './types';
import type { Result } from '../lib/catalog';
const labels: Record<number, string> = {
  1: 'Città',
  2: 'Fabbrica',
  3: 'Porto',
  4: 'Difesa',
  5: 'Silo',
  6: 'SAM',
};
const reasons: Record<string, string> = {
  INSUFFICIENT_GOLD: 'Oro insufficiente',
  INSUFFICIENT_TROOPS: 'Truppe insufficienti',
  NOT_ADJACENT: 'Scegli un confine adiacente oppure una costa per lo sbarco',
  NOT_COASTAL: 'Serve un tile costiero',
  NO_COAST: 'Conquista prima una costa',
  NO_PATH: 'Nessun percorso disponibile',
  PATH_BUDGET: 'Percorso complesso: riprova',
  ALLIED_TARGET: 'Territorio alleato',
  OCCUPIED: 'Tile già occupato',
  CONTAMINATED: 'Territorio contaminato',
  ATTACK_LIMIT: 'Troppe offensive attive',
  COOLDOWN: 'Armamento in ricarica',
  NO_AMMUNITION: 'Tutte le munizioni sono in volo',
  NOT_OWNER: 'Non controlli questa struttura',
  MAX_LEVEL: 'Livello massimo raggiunto',
  ENTITY_LIMIT: 'Limite di unità o strutture raggiunto',
  OWN_TERRITORY: 'Territorio già tuo',
};
interface Lobby {
  code: string;
  host: string;
  members: { accountId: string; name: string; connected: boolean }[];
  bots: number;
  started: boolean;
}
export default function Frontier({ owner, online, onEnd, onAuthoritativeResult }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    renderer = useRef<Renderer | null>(null),
    worker = useRef<Worker | null>(null),
    socket = useRef<WebSocket | null>(null),
    latest = useRef<RenderFrame | null>(null),
    sequence = useRef(0),
    sessionCode = useRef(''),
    finished = useRef(false),
    mapLayout = useRef<MapName>('world');
  const diagnostic = useRef({ tick: 0, hash: 0 });
  const [frame, setFrame] = useState<RenderFrame | null>(null),
    [layout, setLayout] = useState<MapName>('world'),
    [saved, setSaved] = useState<SavedGame | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(online ? 'Connessione…' : 'Preparazione…'),
    [notice, setNotice] = useState(''),
    [lobby, setLobby] = useState<Lobby | null>(null),
    [code, setCode] = useState(''),
    [bots, setBots] = useState(3),
    [allocation, setAllocation] = useState(30),
    [tool, setTool] = useState(0),
    [selection, setSelection] = useState<{ kind: 'building' | 'ship'; id: number } | null>(null),
    [weapon, setWeapon] = useState<WeaponKind | null>(null),
    [paused, setPaused] = useState(false),
    [saveStatus, setSaveStatus] = useState('');
  const sendWorker = (message: WorkerRequest) => worker.current?.postMessage(message);
  const sendControl = (message: unknown) => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setNotice('Connessione non disponibile');
      return;
    }
    socket.current.send(encodeWire(WireKind.Control, message));
  };
  useEffect(() => {
    let disposed = false,
      started = false,
      requestId = 0,
      lastCloud = 0,
      retry = 0,
      reconnect: ReturnType<typeof setTimeout> | undefined;
    let saveChain = Promise.resolve();
    const pendingSaves = new Set<number>();
    finished.current = false;
    sessionCode.current = online ? (sessionStorage.getItem('rts-room:' + owner) ?? '') : '';
    const simulation = new Worker('/generated/rts-worker.js', { type: 'module' });
    worker.current = simulation;
    const save = () => {
      if (finished.current || !started || online || pendingSaves.size) return;
      const id = ++requestId;
      pendingSaves.add(id);
      simulation.postMessage({ type: 'save', requestId: id } satisfies WorkerRequest);
    };
    const persist = (snapshot: EngineSnapshot) => {
      const value: SavedGame = { snapshot, layout: mapLayout.current, updatedAt: Date.now() };
      saveChain = saveChain
        .then(async () => {
          if (finished.current) return;
          await writeSave(owner, value);
          if (!disposed) setSaveStatus('Salvato sul dispositivo');
          if (owner !== 'guest' && navigator.onLine && Date.now() - lastCloud > 10000) {
            lastCloud = Date.now();
            try {
              const response = await fetch('/api/rts/checkpoint', {
                signal: AbortSignal.timeout(5000),
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream', 'X-Player-Id': owner },
                body: encodeWire(WireKind.Snapshot, value),
              });
              if (!response.ok) throw new Error('cloud');
              if (!disposed) setSaveStatus('Salvato su account');
            } catch {
              if (!disposed) setSaveStatus('Salvato sul dispositivo · cloud da riprovare');
            }
          }
        })
        .catch(() => {
          if (!disposed) setNotice('Salvataggio locale fallito. Libera spazio prima di uscire.');
        });
    };
    simulation.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'save') {
        pendingSaves.delete(message.requestId);
        persist(message.snapshot);
        if (disposed) void saveChain.finally(() => simulation.terminate());
        return;
      }
      if (disposed) return;
      if (message.type === 'error') {
        setBusy(false);
        setNotice(reasons[message.message] ?? message.message);
        return;
      }
      if (message.type === 'desync') {
        setStatus(message.message);
        sendControl({ type: 'resync' });
        return;
      }
      started = true;
      latest.current = message;
      sequence.current =
        message.indices.length === message.width * message.height
          ? message.sequence
          : Math.max(sequence.current, message.sequence);
      if (!renderer.current && canvas.current && overlay.current) {
        try {
          renderer.current = new Renderer(
            canvas.current,
            overlay.current,
            message.width,
            message.height,
            setNotice,
          );
        } catch (error) {
          setNotice(error instanceof Error ? error.message : 'Errore grafico');
          return;
        }
      }
      renderer.current?.update(message);
      if (message.hash !== null) diagnostic.current = { tick: message.tick, hash: message.hash };
      setFrame(message);
      setStatus(online ? 'Online · server autoritativo' : 'Offline · simulazione locale');
      for (const event of message.events)
        if (event.kind === 'commandRejected' && event.playerId === message.playerId)
          setNotice(reasons[event.reason] ?? event.reason);
      if (!online && message.tick % 20 === 0) save();
      if (
        !online &&
        (message.winnerId !== null ||
          message.players.find((p) => p.id === message.playerId)?.eliminated)
      )
        finishOffline(message, false);
    };
    simulation.onerror = () =>
      setNotice('Worker non disponibile. Ricarica; i salvataggi restano conservati.');
    async function finishOffline(current: RenderFrame, abandoned: boolean) {
      if (finished.current) return;
      finished.current = true;
      const player = current.players.find((p) => p.id === current.playerId)!;
      await saveChain;
      await writeSave(owner, null).catch(() => {});
      if (owner !== 'guest')
        void fetch('/api/rts/checkpoint', {
          method: 'DELETE',
          headers: { 'X-Player-Id': owner },
        }).catch(() => {});
      onEnd({
        score: player.landSize,
        won:
          !abandoned &&
          (current.winnerId === player.id ||
            (current.winnerId === null &&
              current.players.every((p) => p.landSize <= player.landSize))),
        durationMs: current.tick * 100,
        stats: {
          engineVersion: 2,
          ticks: current.tick,
          land: player.landSize,
          troops: player.troops,
          gold: player.gold,
          buildings: current.world.buildings.filter((b) => b.ownerId === player.id).length,
          map: mapLayout.current,
          abandoned,
        },
      });
      simulation.postMessage({ type: 'pause', paused: true });
    }
    const finishListener = () => {
      if (latest.current) void finishOffline(latest.current, true);
    };
    window.addEventListener('rts-finish', finishListener);
    const visibility = () => {
      if (document.hidden) save();
    };
    document.addEventListener('visibilitychange', visibility);
    if (!online) {
      void (async () => {
        try {
          let value = await readSave(owner);
          const completedAt = await readCompletion(owner);
          if (owner !== 'guest' && navigator.onLine) {
            try {
              const response = await fetch('/api/rts/checkpoint', {
                headers: { 'X-Player-Id': owner },
              });
              if (response.ok && response.status !== 204) {
                const cloud = decodeWire(await response.arrayBuffer()).value as SavedGame & {
                  completed?: boolean;
                };
                if (cloud?.completed && (!value || cloud.updatedAt >= value.updatedAt)) {
                  value = null;
                  await writeSave(owner, null);
                } else if (
                  cloud?.snapshot &&
                  completedAt >= cloud.updatedAt &&
                  (!value || completedAt >= value.updatedAt)
                ) {
                  await fetch('/api/rts/checkpoint', {
                    method: 'DELETE',
                    headers: { 'X-Player-Id': owner },
                    signal: AbortSignal.timeout(5000),
                  });
                  value = null;
                } else if (
                  cloud?.snapshot &&
                  cloud.updatedAt > completedAt &&
                  (!value || cloud.updatedAt > value.updatedAt)
                ) {
                  value = cloud;
                  await writeSave(owner, cloud);
                }
              }
            } catch {
              setSaveStatus('Cloud non disponibile · salvataggi locali disponibili');
            }
          }
          if (!disposed) {
            setSaved(value);
            setReady(true);
            setStatus('Scegli una mappa');
          }
        } catch {
          if (!disposed) {
            setReady(true);
            setNotice('Salvataggio locale non leggibile. Puoi iniziare una nuova partita.');
          }
        }
      })();
    } else {
      const connect = () => {
        if (disposed) return;
        setStatus(retry ? 'Riconnessione…' : 'Connessione…');
        const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/rts/socket');
        ws.binaryType = 'arraybuffer';
        socket.current = ws;
        ws.onmessage = (event) => {
          if (disposed) return;
          try {
            const packet = decodeWire(event.data as ArrayBuffer);
            if (packet.kind === WireKind.Control) {
              const value = packet.value as { type: string; message?: string; result?: Result };
              switch (value.type) {
                case 'ready':
                  retry = 0;
                  setReady(true);
                  setStatus('Connesso · crea o raggiungi una lobby');
                  if (sessionCode.current)
                    ws.send(
                      encodeWire(WireKind.Control, { type: 'join', code: sessionCode.current }),
                    );
                  break;
                case 'lobby': {
                  const room = packet.value as Lobby;
                  sessionCode.current = room.code;
                  sessionStorage.setItem('rts-room:' + owner, room.code);
                  setLobby(room);
                  setBusy(false);
                  break;
                }
                case 'error':
                  setNotice(value.message ?? 'Errore di rete');
                  setBusy(false);
                  break;
                case 'result':
                  if (value.result && !finished.current) {
                    finished.current = true;
                    sessionStorage.removeItem('rts-room:' + owner);
                    onAuthoritativeResult?.(value.result);
                  }
                  break;
              }
            } else if (packet.kind === WireKind.Snapshot) {
              const value = packet.value as {
                snapshot: EngineSnapshot;
                playerId: number;
                hash: number;
                code: string;
              };
              sessionCode.current = value.code;
              mapLayout.current = layout;
              simulation.postMessage({
                type: 'snapshot',
                snapshot: value.snapshot,
                playerId: value.playerId,
                hash: value.hash,
              } satisfies WorkerRequest);
              setBusy(false);
            } else if (packet.kind === WireKind.Tick)
              simulation.postMessage({
                type: 'tick',
                frame: packet.value as TickFrame,
              } satisfies WorkerRequest);
            else if (packet.kind === WireKind.TileDelta)
              simulation.postMessage({
                type: 'delta',
                data: packet.value as Uint8Array,
              } satisfies WorkerRequest);
          } catch {
            setNotice('Pacchetto di rete non valido. Richiedo una nuova sincronizzazione.');
            ws.send(encodeWire(WireKind.Control, { type: 'resync' }));
          }
        };
        ws.onclose = (event) => {
          if (disposed || finished.current) return;
          setReady(false);
          setStatus(
            event.code === 1008
              ? 'Sessione terminata. Accedi nuovamente.'
              : 'Rete interrotta · partita conservata',
          );
          if (event.code !== 1008)
            reconnect = setTimeout(connect, Math.min(5000, 500 * 2 ** Math.min(4, retry++)));
        };
        ws.onerror = () => setStatus('Connessione al server non disponibile');
      };
      connect();
    }
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      window.removeEventListener('rts-finish', finishListener);
      document.removeEventListener('visibilitychange', visibility);
      socket.current?.close();
      renderer.current?.destroy();
      renderer.current = null;
      save();
      if (!pendingSaves.size) simulation.terminate();
      else setTimeout(() => simulation.terminate(), 3000);
      worker.current = null;
    };
    // Owner and mode define an independent game session; changing HUD settings must not recreate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, online]);
  function command(payload: CommandPayload) {
    if (finished.current) return;
    setNotice('');
    if (online) {
      const current = latest.current;
      if (!current || socket.current?.readyState !== WebSocket.OPEN) {
        setNotice('Attendi la riconnessione');
        return;
      }
      socket.current.send(
        encodeWire(
          WireKind.Commands,
          new Uint8Array(
            encodeCommands([
              {
                ...payload,
                playerId: current.playerId,
                sequence: sequence.current++,
                executeTick: current.tick + 1,
              },
            ]),
          ),
        ),
      );
    } else sendWorker({ type: 'command', command: payload });
  }
  function start(resume: boolean) {
    setBusy(true);
    mapLayout.current = resume && saved ? (saved.layout as MapName) : layout;
    sendWorker({
      type: 'offline',
      seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
      layout: mapLayout.current,
      ...(resume && saved ? { snapshot: saved.snapshot } : {}),
    });
  }
  function click(tile: number) {
    const view = renderer.current,
      current = latest.current;
    if (!view || !current || tile < 0) return;
    const building = current.world.buildings.find((b) => b.id === view.buildings[tile]),
      ship = current.world.units.find(
        (u) => u.kind === UnitKind.Warship && u.ownerId === current.playerId && u.tile === tile,
      );
    if (tool) {
      command({ kind: CommandKind.Build, tile, building: tool as BuildingKind });
      return;
    }
    if (weapon && selection?.kind === 'building') {
      command({ kind: CommandKind.LaunchNuke, siloId: selection.id, targetTile: tile, weapon });
      setWeapon(null);
      return;
    }
    if (ship) {
      setSelection({ kind: 'ship', id: ship.id });
      view.selected = tile;
      return;
    }
    if (selection?.kind === 'ship' && view.terrain[tile]! < 2) {
      command({ kind: CommandKind.Patrol, shipId: selection.id, targetTile: tile });
      return;
    }
    if (building?.ownerId === current.playerId) {
      setSelection({ kind: 'building', id: building.id });
      view.selected = tile;
      return;
    }
    setSelection(null);
    view.selected = -1;
    if (view.owners[tile] === current.playerId) {
      setNotice('Scegli un edificio oppure un confine da espandere');
      return;
    }
    const x = tile % current.width,
      y = Math.floor(tile / current.width),
      adjacent = [
        x > 0 ? tile - 1 : -1,
        x < current.width - 1 ? tile + 1 : -1,
        y > 0 ? tile - current.width : -1,
        y < current.height - 1 ? tile + current.width : -1,
      ].some((t) => t >= 0 && view.owners[t] === current.playerId);
    command(
      adjacent
        ? { kind: CommandKind.Attack, targetTile: tile, allocationBps: allocation * 100 }
        : {
            kind: CommandKind.Transport,
            targetTile: tile,
            allocationBps: Math.min(20, allocation) * 100,
          },
    );
  }
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let previous = { x: 0, y: 0 },
      origin = { x: 0, y: 0 },
      dragged = false,
      pinch = 0;
    const point = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const down = (event: PointerEvent) => {
      const p = point(event);
      element.focus({ preventScroll: true });
      element.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, p);
      previous = origin = p;
      dragged = false;
      if (pointers.size === 2) {
        const a = [...pointers.values()];
        pinch = Math.hypot(a[0]!.x - a[1]!.x, a[0]!.y - a[1]!.y);
        dragged = true;
      }
    };
    const move = (event: PointerEvent) => {
      const p = point(event),
        view = renderer.current;
      if (!view) return;
      view.hovered = view.tileAt(p.x, p.y);
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, p);
      if (pointers.size === 2) {
        const a = [...pointers.values()],
          distance = Math.hypot(a[0]!.x - a[1]!.x, a[0]!.y - a[1]!.y);
        if (pinch > 0)
          view.camera.zoomAt((a[0]!.x + a[1]!.x) / 2, (a[0]!.y + a[1]!.y) / 2, distance / pinch);
        pinch = distance;
        dragged = true;
      } else {
        if (Math.hypot(p.x - origin.x, p.y - origin.y) > 5) dragged = true;
        if (dragged) view.camera.pan(p.x - previous.x, p.y - previous.y);
        previous = p;
      }
    };
    const up = (event: PointerEvent) => {
      const p = point(event);
      if (!dragged && event.button === 0) click(renderer.current?.tileAt(p.x, p.y) ?? -1);
      pointers.delete(event.pointerId);
      if (pointers.size) dragged = true;
    };
    const cancel = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      dragged = true;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const b = element.getBoundingClientRect();
      renderer.current?.camera.zoomAt(
        event.clientX - b.left,
        event.clientY - b.top,
        Math.exp(-event.deltaY * 0.0015),
      );
    };
    const key = (event: KeyboardEvent) => {
      const view = renderer.current;
      if (!view) return;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [60, 0],
        ArrowRight: [-60, 0],
        ArrowUp: [0, 60],
        ArrowDown: [0, -60],
      };
      const delta = moves[event.key];
      if (delta) {
        event.preventDefault();
        view.camera.pan(...delta);
      }
      if (event.key === 'Escape') {
        setTool(0);
        setWeapon(null);
        setSelection(null);
        view.selected = -1;
      }
      if (event.key === '+' || event.key === '-') {
        event.preventDefault();
        view.camera.zoomAt(
          view.camera.viewWidth / 2,
          view.camera.viewHeight / 2,
          event.key === '+' ? 1.2 : 1 / 1.2,
        );
      }
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('keydown', key);
    };
  }, [tool, allocation, selection, weapon, online]);
  useEffect(() => {
    if (renderer.current)
      renderer.current.radius =
        tool === BuildingKind.DefensePost
          ? 30
          : tool === BuildingKind.SamLauncher
            ? 70
            : weapon === WeaponKind.Hydrogen
              ? 100
              : weapon === WeaponKind.Atom
                ? 30
                : 0;
  }, [tool, weapon]);
  const player = frame?.players.find((p) => p.id === frame.playerId),
    building =
      selection?.kind === 'building'
        ? frame?.world.buildings.find((b) => b.id === selection.id)
        : undefined;
  return (
    <div
      className="rts-game"
      data-tick={frame?.tick ?? 0}
      data-hash-tick={diagnostic.current.tick}
      data-checksum={diagnostic.current.hash}
    >
      <div className="rts-map">
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label="Mappa Frontier"
          onContextMenu={(event) => event.preventDefault()}
        />
        <canvas ref={overlay} aria-hidden="true" className="rts-overlay" />
      </div>
      {!frame ? (
        <div className="rts-setup">
          <div className="eyebrow">FRONTIER / 2.0</div>
          <h2>Il mondo cambia confine.</h2>
          <p>
            Espandi il territorio. Costruisci città, commerci e difese. Conquista l’80% della terra.
          </p>
          {!online ? (
            <>
              <label>
                Mappa
                <select
                  aria-label="Mappa RTS"
                  value={layout}
                  onChange={(event) => setLayout(event.target.value as MapName)}
                >
                  <option value="world">Mondo reale</option><option value="continents">Continenti</option>
                  <option value="archipelago">Arcipelago</option>
                  <option value="strait">Lo stretto</option>
                </select>
              </label>
              <div className="rts-actions">
                {saved && (
                  <button className="primary" disabled={!ready || busy} onClick={() => start(true)}>
                    Riprendi mondo · {Math.floor(saved.snapshot.tick / 10)}s
                  </button>
                )}
                <button disabled={!ready || busy} onClick={() => start(false)}>
                  Nuova partita
                </button>
              </div>
              <small>3 nazioni bot · dominio all’80% · salvataggio automatico</small>
            </>
          ) : !lobby ? (
            <>
              <label>
                Mappa
                <select
                  aria-label="Mappa RTS"
                  value={layout}
                  onChange={(event) => setLayout(event.target.value as MapName)}
                >
                  <option value="world">Mondo reale</option><option value="continents">Continenti</option>
                  <option value="archipelago">Arcipelago</option>
                  <option value="strait">Lo stretto</option>
                </select>
              </label>
              <label>
                Bot
                <select
                  aria-label="Numero bot"
                  value={bots}
                  onChange={(event) => setBots(Number(event.target.value))}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={!ready || busy}
                onClick={() => {
                  setBusy(true);
                  sendControl({ type: 'create', layout, bots });
                }}
              >
                Crea lobby
              </button>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setBusy(true);
                  sendControl({ type: 'join', code });
                }}
              >
                <input
                  aria-label="Codice lobby"
                  placeholder="CODICE LOBBY"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))
                  }
                />
                <button disabled={!ready || busy || code.length !== 6}>Entra</button>
              </form>
            </>
          ) : (
            <>
              <div className="rts-code">
                {lobby.code}
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(lobby.code)
                      .then(() => setNotice('Codice copiato. Invialo agli amici.'))
                      .catch(() => setNotice('Codice invito: ' + lobby.code))
                  }
                >
                  Copia invito
                </button>
              </div>
              <ul>
                {lobby.members.map((m) => (
                  <li key={m.accountId}>
                    {m.name} · {m.connected ? 'pronto' : 'disconnesso'}
                  </li>
                ))}
              </ul>
              <p>{lobby.bots} nazioni bot</p>
              {lobby.host === owner ? (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    sendControl({ type: 'start' });
                  }}
                >
                  Avvia partita
                </button>
              ) : (
                <p>Il creatore avvia la partita.</p>
              )}
            </>
          )}
          <p className="rts-status" role="status">
            {status}
          </p>
          {notice && (
            <p role="alert" className="rts-notice">
              {notice}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="rts-hud">
            <div>
              <b>{compact(player?.troops ?? 0)}</b>
              <small>truppe / {compact(player?.maxTroops ?? 0)}</small>
            </div>
            <div>
              <b>{compact(player?.gold ?? 0)}</b>
              <small>oro</small>
            </div>
            <div>
              <b>{player?.landSize ?? 0}</b>
              <small>territorio</small>
            </div>
            <div>
              <b>
                {Math.floor(frame.tick / 600)}:
                {String(Math.floor(frame.tick / 10) % 60).padStart(2, '0')}
              </b>
              <small>{online ? lobby?.code : 'LOCALE'}</small>
            </div>
          </div>
          <div className="rts-tools">
            <button
              className={tool === 0 ? 'active' : ''}
              onClick={() => {
                setTool(0);
                setWeapon(null);
              }}
            >
              Espandi
            </button>
            {[1, 2, 3, 4, 5, 6].map((kind) => {
              const count = frame.world.buildings.filter(
                  (b) => b.ownerId === frame.playerId && b.kind === kind,
                ).length,
                price =
                  kind === 4
                    ? Math.min(
                        250000,
                        50000 *
                          ((frame.world.defenseBuilt.find(([id]) => id === frame.playerId)?.[1] ??
                            0) +
                            1),
                      )
                    : BUILDING_RULES[kind as BuildingKind].gold * (count + 1);
              return (
                <button
                  key={kind}
                  className={tool === kind ? 'active' : ''}
                  title={labels[kind] + ' · ' + compact(price) + ' oro'}
                  onClick={() => {
                    setTool(kind);
                    setSelection(null);
                    setWeapon(null);
                  }}
                >
                  {labels[kind]}
                  <small>{compact(price)}</small>
                </button>
              );
            })}
          </div>
          <div className="rts-side">
            <label>
              Truppe inviate <b>{allocation}%</b>
              <input
                aria-label="Percentuale truppe"
                type="range"
                min={10}
                max={100}
                step={5}
                value={allocation}
                onChange={(event) => setAllocation(Number(event.target.value))}
              />
            </label>
            {building && (
              <div className="rts-selection">
                <b>
                  {labels[building.kind]} · livello {building.level}
                </b>
                <span>{building.hp} HP</span>
                {building.kind !== BuildingKind.DefensePost && (
                  <button
                    onClick={() => command({ kind: CommandKind.Upgrade, buildingId: building.id })}
                  >
                    Potenzia ·{' '}
                    {compact(BUILDING_RULES[building.kind].gold * (building.level + 1) ** 2)}
                  </button>
                )}
                {building.kind === BuildingKind.Port && (
                  <button
                    onClick={() => {
                      const current = latest.current!,
                        view = renderer.current!;
                      const candidates = [
                          building.tile - 1,
                          building.tile + 1,
                          building.tile - current.width,
                          building.tile + current.width,
                        ],
                        water = candidates.find(
                          (t) => t >= 0 && t < view.terrain.length && view.terrain[t]! < 2,
                        );
                      if (water === undefined) {
                        setNotice('Nessuna acqua adiacente');
                        return;
                      }
                      command({
                        kind: CommandKind.ProduceWarship,
                        portId: building.id,
                        patrolTile: water,
                      });
                    }}
                  >
                    Nave da guerra · {compact(WORLD_BALANCE.warshipGold)}
                  </button>
                )}
                {building.kind === BuildingKind.MissileSilo && (
                  <>
                    <small>
                      Ricarica {building.cooldownTicks / 10}s · munizioni {building.ammunition}
                    </small>
                    {[WeaponKind.Atom, WeaponKind.Hydrogen, WeaponKind.Mirv].map((w) => (
                      <button
                        key={w}
                        className={weapon === w ? 'active' : ''}
                        onClick={() => {
                          setWeapon(w);
                          setTool(0);
                        }}
                      >
                        {w === 1
                          ? 'Atom · 750K'
                          : w === 2
                            ? 'Idrogeno · 5M'
                            : 'MIRV · ' + compact(25000000 + frame.world.mirvLaunches * 15000000)}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            {selection?.kind === 'ship' && (
              <p>Nave selezionata. Clic sull’acqua per pattugliare.</p>
            )}
            <details>
              <summary>Nazioni e diplomazia</summary>
              {frame.players
                .filter((p) => p.id !== frame.playerId && !p.eliminated)
                .map((other) => {
                  const ally = player?.alliances.includes(other.id),
                    request = frame.world.allianceRequests.some(
                      (r) => r.from === other.id && r.to === frame.playerId,
                    );
                  return (
                    <div className="rts-nation" key={other.id}>
                      <span>
                        {other.name}
                        <small>
                          {compact(other.landSize)} tile · {compact(other.troops)}
                        </small>
                      </span>
                      <button
                        onClick={() =>
                          command({
                            kind: ally
                              ? CommandKind.BreakAlliance
                              : request
                                ? CommandKind.AcceptAlliance
                                : CommandKind.RequestAlliance,
                            otherPlayerId: other.id,
                          })
                        }
                      >
                        {ally ? 'Rompi' : request ? 'Accetta' : 'Alleanza'}
                      </button>
                    </div>
                  );
                })}
            </details>
            {frame.attacks
              .filter((a) => a.attackerId === frame.playerId)
              .map((attack) => (
                <button
                  key={attack.id}
                  onClick={() => command({ kind: CommandKind.CancelAttack, attackId: attack.id })}
                >
                  Ritira offensiva #{attack.id}
                </button>
              ))}
            <div className="rts-actions">
              <button
                onClick={() => {
                  renderer.current?.camera.fit(
                    frame.width,
                    frame.height,
                    renderer.current.camera.viewWidth,
                    renderer.current.camera.viewHeight,
                  );
                }}
              >
                Centra
              </button>
              {!online && (
                <button
                  onClick={() => {
                    setPaused(!paused);
                    sendWorker({ type: 'pause', paused: !paused });
                  }}
                >
                  {paused ? 'Riprendi' : 'Pausa'}
                </button>
              )}
              <button
                onClick={() =>
                  online
                    ? sendControl({ type: 'finish' })
                    : window.dispatchEvent(new Event('rts-finish'))
                }
              >
                Concludi
              </button>
            </div>
          </div>
          <div className="rts-bottom">
            <span>
              {weapon
                ? 'Seleziona il bersaglio nucleare'
                : tool
                  ? 'Seleziona un tile del tuo territorio'
                  : paused
                    ? 'Partita in pausa'
                    : 'Clic: espandi · trascina: muovi · rotella / pizzico: zoom · Esc: annulla'}
            </span>
            <small role="status">
              {online ? status : saveStatus || 'Salvataggio automatico ogni 2s'}
            </small>
            {notice && (
              <button className="rts-notice" role="alert" onClick={() => setNotice('')}>
                {notice} ×
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
