import { it, expect, vi, beforeEach } from 'vitest';
import { recordLocal, syncResults, readLocal, localRuns } from '../lib/client';
import type { Result } from '../lib/catalog';
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) || null,
    setItem: (k: string, v: string) => memory.set(k, v),
  });
});
const result: Result = {
  id: 'f430d184-5414-47d5-8dce-2cff98a703b7',
  game: 'pulse',
  mode: 'offline',
  score: 15,
  durationMs: 5000,
  won: false,
  stats: {},
};
it('offline: conserva coda su errore e ritenta senza duplicati', async () => {
  recordLocal('a', result);
  recordLocal('a', result);
  expect(localRuns('a')).toHaveLength(1);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'a' }) })
      .mockRejectedValueOnce(new Error('offline')),
  );
  await expect(syncResults('a')).rejects.toThrow('Rete');
  expect(readLocal<any[]>('arcade:queue:a', [])).toHaveLength(1);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'a' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ duplicate: false }) }),
  );
  await syncResults('a');
  expect(readLocal<any[]>('arcade:queue:a', [])).toHaveLength(0);
  expect(localRuns('a')).toHaveLength(1);
});
it('non invia risultati di account diverso', async () => {
  recordLocal('a', result);
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'b' }) });
  vi.stubGlobal('fetch', fetch);
  await expect(syncResults('a')).rejects.toThrow('stesso account');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(localRuns('b')).toHaveLength(0);
});
