import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Register } from '../pipeline/prompt';
import type { Doc } from '../pipeline/types';

export type JobStatus = 'reviewing' | 'rewriting' | 'paused' | 'done';

export type EngineChoice =
  | { kind: 'local'; model: string }
  | { kind: 'byok'; provider: string; model: string; baseUrl?: string };

export interface Job {
  id: string;
  createdAt: number;
  updatedAt: number;
  input: string;
  doc: Doc;
  register: Register;
  status: JobStatus;
  engine?: EngineChoice;
  chunksTotal: number;
  chunksDone: number;
}

interface Schema extends DBSchema {
  jobs: { key: string; value: Job; indexes: { updatedAt: number } };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>('plainhand', 1, {
    upgrade(d) {
      const store = d.createObjectStore('jobs', { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt');
    },
  });
  return dbPromise;
}

const MAX_JOBS = 20;

export async function saveJob(job: Job): Promise<boolean> {
  try {
    const d = await db();
    job.updatedAt = Date.now();
    await d.put('jobs', structuredClone(job));
    return true;
  } catch {
    return false;
  }
}

export async function latestUnfinishedJob(): Promise<Job | undefined> {
  try {
    const d = await db();
    let cursor = await d.transaction('jobs').store.index('updatedAt').openCursor(null, 'prev');
    while (cursor) {
      if (cursor.value.status === 'rewriting' || cursor.value.status === 'paused') return cursor.value;
      cursor = await cursor.continue();
    }
  } catch {
    // Storage unavailable (private window, blocked site data): resume is a convenience.
  }
  return undefined;
}

export async function deleteJob(id: string): Promise<void> {
  try {
    await (await db()).delete('jobs', id);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

export async function pruneJobs(): Promise<void> {
  try {
    const d = await db();
    const keys = await d.getAllKeysFromIndex('jobs', 'updatedAt');
    const excess = keys.length - MAX_JOBS;
    for (const key of keys.slice(0, Math.max(0, excess))) await d.delete('jobs', key);
  } catch {
    // Best effort.
  }
}

/**
 * Holds a Web Lock for the job so a second tab can't run it at the same time.
 * Resolves to a release function, or null if another tab already holds it.
 */
export function claimJob(id: string): Promise<(() => void) | null> {
  if (!('locks' in navigator)) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    void navigator.locks.request(`plainhand-job-${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(null);
        return;
      }
      return new Promise<void>((release) => resolve(release));
    });
  });
}

export const newJobId = () => crypto.randomUUID();
