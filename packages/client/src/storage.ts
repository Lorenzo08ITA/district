import type { EngineSnapshot } from '@district/rts-engine';
import { encodeWire, decodeWire, WireKind } from '@district/rts-shared';
export interface SavedGame {
  snapshot: EngineSnapshot;
  layout: string;
  updatedAt: number;
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('district-rts-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('saves');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readSave(owner: string): Promise<SavedGame | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('saves').objectStore('saves').get(owner);
      request.onsuccess = () => {
        try {
          resolve(
            request.result ? (decodeWire(request.result as ArrayBuffer).value as SavedGame) : null,
          );
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function writeSave(owner: string, value: SavedGame | null): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('saves', 'readwrite'),
        store = transaction.objectStore('saves');
      if (value) store.put(encodeWire(WireKind.Snapshot, value), owner);
      else {
        store.delete(owner);
        store.put(Date.now(), owner + ':completed');
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function readCompletion(owner: string): Promise<number> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction('saves')
        .objectStore('saves')
        .get(owner + ':completed');
      request.onsuccess = () => resolve(typeof request.result === 'number' ? request.result : 0);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
