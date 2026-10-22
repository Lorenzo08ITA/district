import { api, readLocal, writeLocal } from './client';
export type Checkpoint = { data: Record<string, any>; updatedAt: number };
export const checkpointKey = (owner: string, game: string) => `arcade:checkpoint:${owner}:${game}`;
export function loadCheckpoint(owner: string, game: string) {
  return readLocal<Checkpoint | null>(checkpointKey(owner, game), null);
}
let reported = false;
export function saveCheckpoint(owner: string, game: string, data: Record<string, any>) {
  const checkpoint = { data, updatedAt: Date.now() };
  try {
    writeLocal(checkpointKey(owner, game), checkpoint);
  } catch (e) {
    if (!reported) {
      reported = true;
      window.dispatchEvent(new CustomEvent('arcade-error', { detail: (e as Error).message }));
    }
    return;
  }
  if (owner !== 'guest' && navigator.onLine)
    void api(`checkpoints/${game}`, {
      method: 'PUT',
      headers: { 'X-Player-Id': owner },
      body: JSON.stringify(checkpoint),
    }).catch((error) => {
      if (!reported) {
        reported = true;
        window.dispatchEvent(new CustomEvent('arcade-error', { detail: error.message }));
      }
    });
}
export async function hydrateCheckpoint(owner: string, game: string) {
  if (owner === 'guest' || !navigator.onLine) return;
  try {
    const remote = await api<Checkpoint | null>(`checkpoints/${game}`, {
        headers: { 'X-Player-Id': owner },
      }),
      local = loadCheckpoint(owner, game);
    if (remote && (!local || remote.updatedAt > local.updatedAt)) {
      if (remote.data.completed) localStorage.removeItem(checkpointKey(owner, game));
      else writeLocal(checkpointKey(owner, game), remote);
    } else if (local)
      await api(`checkpoints/${game}`, {
        method: 'PUT',
        headers: { 'X-Player-Id': owner },
        body: JSON.stringify(local),
      });
  } catch {
    /* Local checkpoint remains available. */
  }
}
export function clearCheckpoint(owner: string, game: string) {
  try {
    localStorage.removeItem(checkpointKey(owner, game));
  } catch {}
  if (owner !== 'guest')
    void api(`checkpoints/${game}`, { method: 'DELETE', headers: { 'X-Player-Id': owner } }).catch(
      () => {},
    );
}
