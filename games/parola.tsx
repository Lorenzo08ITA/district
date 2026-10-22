'use client';
import { useEffect, useRef, useState } from 'react';
import { loadCheckpoint, saveCheckpoint } from '../lib/checkpoints';
import { z } from 'zod';
import { evaluateGuess, words } from './words';
import type { GameProps } from './types';
export default function Parola({ onEnd, paused, owner }: GameProps) {
  const [saved] = useState(() => {
    const parsed = z
      .object({
        target: z.string().refine((v) => words.includes(v)),
        guesses: z.array(z.string().regex(/^[a-z]{5}$/)).max(5),
        input: z.string().regex(/^[a-z]{0,5}$/),
        elapsedMs: z.number().min(0).max(86400000).optional(),
      })
      .safeParse(loadCheckpoint(owner, 'parola')?.data);
    return parsed.success ? parsed.data : null;
  });
  const [target] = useState(() => saved?.target || words[Math.floor(Math.random() * words.length)]),
    [guesses, setGuesses] = useState<string[]>(saved?.guesses || []),
    [input, setInput] = useState(saved?.input || ''),
    [message, setMessage] = useState(''),
    [over, setOver] = useState(false);
  const current = useRef({ guesses, input, over });
  current.current = { guesses, input, over };
  const ended = useRef(false);
  const began = useRef(Date.now());
  useEffect(() => {
    const save = () => {
      if (!over && !ended.current)
        saveCheckpoint(owner, 'parola', {
          target,
          guesses,
          input,
          elapsedMs: (saved?.elapsedMs || 0) + Date.now() - began.current,
        });
    };
    save();
    const timer = setInterval(save, 5000);
    return () => {
      clearInterval(timer);
      save();
    };
  }, [target, guesses, input, over]);
  function key(key: string) {
    const { guesses, input, over } = current.current;
    if (over || paused) return;
    if (key === 'Backspace') {
      setInput(input.slice(0, -1));
      return;
    }
    if (key === 'Enter') {
      if (input.length !== 5) {
        setMessage('Servono cinque lettere.');
        return;
      }
      if (!words.includes(input)) {
        setMessage('Parola fuori dal dizionario.');
        return;
      }
      const next = [...guesses, input];
      setGuesses(next);
      setInput('');
      setMessage('');
      if (input === target || next.length === 6) {
        setOver(true);
        if (!ended.current) {
          ended.current = true;
          onEnd({
            score: input === target ? (7 - next.length) * 100 : 0,
            durationMs: (saved?.elapsedMs || 0) + Date.now() - began.current,
            won: input === target,
            stats: {
              attempts: next.length,
              word: target,
              guesses: next.join(','),
              dictionarySize: words.length,
            },
          });
        }
      }
      return;
    }
    if (/^[a-zA-Z]$/.test(key) && input.length < 5) setInput(input + key.toLowerCase());
  }
  const handler = useRef(key);
  handler.current = key;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Backspace' || event.key === 'Enter' || /^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        handler.current(event.key);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  return (
    <div className="wordle">
      <h2>Parola</h2>
      <div className="save-hint">Nuova parola a ogni partita · {words.length} parole italiane</div>
      <div className="word-grid">
        {Array.from({ length: 6 }, (_, row) => {
          const guess = guesses[row];
          const letters = guess || (row === guesses.length ? input : '');
          const result = guess ? evaluateGuess(guess, target) : [];
          return (
            <div className="word-row" key={row}>
              {Array.from({ length: 5 }, (_, col) => (
                <div
                  key={col}
                  className={`letter ${result[col] || ''}`}
                  aria-label={letters[col] ? `${letters[col]} ${result[col] || ''}` : 'Vuoto'}
                >
                  {letters[col]}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="wordle-status" aria-live="polite">
        {message || 'Verde: posto giusto · Oro: lettera presente'}
      </div>
      <div className="keyboard">
        {'QWERTYUIOPASDFGHJKLZXCVBNM'.split('').map((letter) => (
          <button key={letter} onClick={() => key(letter)} disabled={over || paused}>
            {letter}
          </button>
        ))}
        <button onClick={() => key('Backspace')}>⌫</button>
        <button onClick={() => key('Enter')}>Invio</button>
      </div>
    </div>
  );
}
