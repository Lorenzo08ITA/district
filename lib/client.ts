'use client';
import type { Result, Progress } from './catalog';
export type Player = { id: string; name: string; email?: string; preferences?: Preferences };
export type Preferences = {
  theme: 'dark' | 'light';
  accent: 'lime' | 'peach' | 'blue';
  layout: 'grid' | 'compact';
  favorites: string[];
};
export const defaultPreferences: Preferences = {
  theme: 'dark',
  accent: 'lime',
  layout: 'grid',
  favorites: [],
};
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error('Rete non disponibile. I risultati restano sul dispositivo.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Richiesta non riuscita');
  return data;
}
export function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('Spazio locale esaurito. Esporta i risultati prima di chiudere.');
  }
}
export function localRuns(owner: string): Result[] {
  return readLocal(`arcade:runs:${owner}`, []);
}
export function recordLocal(owner: string, result: Result) {
  const runs = localRuns(owner);
  if (!runs.some((r) => r.id === result.id)) {
    runs.push(result);
    writeLocal(`arcade:runs:${owner}`, runs);
  }
  const queue = readLocal<Result[]>(`arcade:queue:${owner}`, []);
  if (!queue.some((r) => r.id === result.id)) {
    queue.push(result);
    writeLocal(`arcade:queue:${owner}`, queue);
  }
}
let syncing: Promise<void> | null = null;
export function syncResults(owner: string) {
  if (owner === 'guest') return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    const me = await api<Player | null>('me');
    if (me?.id !== owner) throw new Error('Accedi allo stesso account per sincronizzare.');
    for (const result of readLocal<Result[]>(`arcade:queue:${owner}`, [])) {
      await api('results', {
        method: 'POST',
        headers: { 'X-Player-Id': owner },
        body: JSON.stringify(result),
      });
      const pending = readLocal<Result[]>(`arcade:queue:${owner}`, []);
      writeLocal(
        `arcade:queue:${owner}`,
        pending.filter((r) => r.id !== result.id),
      );
    }
  })().finally(() => (syncing = null));
  return syncing;
}
export function summarize(runs: Result[]): Progress[] {
  const map = new Map<string, Progress>();
  for (const r of runs) {
    const p = map.get(r.game) || {
      game_id: r.game,
      best: 0,
      plays: 0,
      wins: 0,
      total_ms: 0,
      stats: {},
    };
    p.best = Math.max(p.best, r.score);
    p.plays++;
    p.wins += r.won ? 1 : 0;
    p.total_ms += r.durationMs;
    p.stats = r.stats;
    map.set(r.game, p);
  }
  return [...map.values()];
}
