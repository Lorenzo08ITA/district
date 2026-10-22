'use client';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { GameId, Result } from '../lib/catalog';
export type Snapshot = {
  id: string;
  game: GameId;
  actors: any[];
  territory?: any;
  remaining: number;
  started: number;
};
export function useMultiplayer(game: GameId, enabled: boolean, onFinish: (result: Result) => void) {
  const socket = useRef<Socket | null>(null),
    state = useRef<Snapshot | null>(null);
  const [status, setStatus] = useState('Connessione…');
  const [playerId, setPlayerId] = useState('');
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useEffect(() => {
    if (!enabled) return;
    const connection = io({
      autoConnect: false,
      transports: ['websocket'],
      reconnectionAttempts: 10,
    });
    socket.current = connection;
    connection.on('connect', () => {
      setStatus('Ingresso…');
      connection.timeout(10000).emit('join', { game }, (error: any, data: any) => {
        if (error || data?.error) {
          setStatus(data?.error || 'Server non disponibile');
          return;
        }
        setPlayerId(data.playerId);
        setStatus('Online');
      });
    });
    connection.on('snapshot', (data: Snapshot) => {
      state.current = data;
    });
    connection.on('finished', (result: Result) => {
      setStatus('Partita conclusa · salvata');
      finish.current(result);
    });
    connection.on('notice', setStatus);
    connection.on('connect_error', (error: Error) => setStatus(error.message));
    connection.on('disconnect', () => setStatus('Connessione persa · riconnessione…'));
    connection.connect();
    return () => {
      connection.emit('leave');
      connection.disconnect();
      socket.current = null;
      state.current = null;
    };
  }, [game, enabled]);
  return { state, socket, status, playerId };
}
