'use client';
import { Component, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import type { Game, Result } from '../lib/catalog';
import { useMultiplayer } from '../lib/multiplayer';
import { clearCheckpoint, hydrateCheckpoint, loadCheckpoint } from '../lib/checkpoints';
import type { GameProps } from '../games/types';
const modules: Record<string, ComponentType<GameProps>> = {
  pulse: dynamic(() => import('../games/pulse')),
  wing: dynamic(() => import('../games/wing')),
  orbit: dynamic(() => import('../games/orbit')),
  frontier: dynamic(() => import('../games/frontier')),
  flux: dynamic(() => import('../games/flux')),
  crossfire: dynamic(() => import('../games/crossfire'), { ssr: false }),
  drift: dynamic(() => import('../games/drift'), { ssr: false }),
  prism: dynamic(() => import('../games/prism'), { ssr: false }),
  trivia: dynamic(() => import('../games/trivia')),
  geography: dynamic(() => import('../games/geography')),
  flags: dynamic(() => import('../games/flags')),
  parola: dynamic(() => import('../games/parola')),
};
class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="warning" role="alert">
        Gioco non disponibile. Torna al catalogo e riprova. Per i giochi 3D serve WebGL.
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function GameShell({
  owner,
  game,
  online,
  onExit,
  onFinish,
}: {
  owner: string;
  game: Game;
  online: boolean;
  onExit: () => void;
  onFinish: (r: Result) => void;
}) {
  const [round, setRound] = useState(0),
    [result, setResult] = useState<Result | null>(null),
    [complete, setComplete] = useState(false),
    [begun, setBegun] = useState(false);
  const started = useRef(Date.now());
  const network = useMultiplayer(
    game.id,
    online && game.id !== 'frontier' && game.id !== 'crossfire',
    (r) => {
      setResult(r);
      setComplete(true);
      onFinish(r);
    },
  );
  const GameModule = modules[game.id];
  const [checkpointReady, setCheckpointReady] = useState(online);
  useEffect(() => {
    if (game.id === 'frontier') setCheckpointReady(true);
    else if (!online)
      void hydrateCheckpoint(owner, game.id).finally(() => setCheckpointReady(true));
  }, [owner, game.id, online]);
  function end(data: {
    durationMs?: number;
    score: number;
    won: boolean;
    stats: Record<string, number | string | boolean>;
  }) {
    const r: Result = {
      id: crypto.randomUUID(),
      game: game.id,
      mode: online ? 'online' : 'offline',
      durationMs: Math.min(86400000, Math.max(0, Date.now() - started.current)),
      ...data,
    };
    setResult(r);
    if (!online) {
      clearCheckpoint(owner, game.id);
      setComplete(true);
      onFinish(r);
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' && result && (!online || !complete)) {
        e.preventDefault();
        restart();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [result, online, complete]);
  function restart() {
    setRound((r) => r + 1);
    setResult(null);
    started.current = Date.now();
  }
  return (
    <section className="game-page">
      <div className="game-header">
        <button onClick={onExit}>← Catalogo</button>
        <h1>{game.title}</h1>
        <span className="mode">
          {online ? 'ONLINE' : 'OFFLINE'} · {game.dimension}
        </span>
      </div>
      <div className="game-stage">
        <Boundary key={round}>
          {begun &&
            (!online ||
              game.id === 'frontier' ||
              game.id === 'crossfire' ||
              !!network.playerId) && (
              <GameModule
                owner={owner}
                game={game}
                online={online}
                network={network}
                onEnd={end}
                onAuthoritativeResult={(r) => {
                  setResult(r);
                  setComplete(true);
                  onFinish(r);
                }}
                paused={!!result}
              />
            )}
        </Boundary>
        {!begun && (
          <div className="game-overlay">
            <div>
              <h2>{game.title}</h2>
              <p>{game.controls}</p>
              <button
                disabled={!checkpointReady}
                className="primary"
                onClick={() => {
                  started.current = Date.now();
                  setBegun(true);
                }}
              >
                {checkpointReady
                  ? game.id !== 'frontier' && loadCheckpoint(owner, game.id)
                    ? 'Riprendi ↗'
                    : 'Inizia ↗'
                  : 'Caricamento…'}
              </button>
            </div>
          </div>
        )}
        {begun &&
          online &&
          game.id !== 'frontier' &&
          game.id !== 'crossfire' &&
          !network.playerId && (
            <div className="game-overlay">
              <p>{network.status}</p>
            </div>
          )}
        {result && (
          <div className="game-overlay">
            <div>
              <div className="eyebrow">{result.won ? 'BEN GIOCATO' : 'UN ALTRO GIRO?'}</div>
              <h2>{Math.floor(result.score)} punti</h2>
              <p>
                {online
                  ? complete
                    ? 'Partita conclusa. Risultato salvato.'
                    : 'Round concluso. La sfida online continua.'
                  : 'Partita conclusa. Dettagli nei tuoi progressi.'}
              </p>
              {(!online || !complete) && (
                <button className="primary" onClick={restart}>
                  Rigioca ↗
                </button>
              )}
              <button className="text-button" onClick={onExit}>
                Torna al catalogo
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="game-controls">
        <span>{game.controls}</span>
        <span>
          {online
            ? game.id === 'frontier' || game.id === 'crossfire'
              ? 'Lobby · salvataggio server'
              : network.status
            : 'Ospite o account · salvataggio locale automatico'}
        </span>
        <button onClick={onExit}>Esci</button>
      </div>
    </section>
  );
}
