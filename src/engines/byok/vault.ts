import type { ProviderId } from './providers';

/**
 * API keys live only in this browser. Plain mode keeps them in localStorage;
 * locked mode encrypts them with a passphrase (PBKDF2 → AES-GCM) and keeps
 * the decrypted copy in memory for this tab only.
 */

const STORAGE_KEY = 'forsakeai.keys.v1';
const PBKDF2_ITERATIONS = 600_000;

type Keys = Partial<Record<ProviderId, string>>;

interface PlainRecord {
  mode: 'plain';
  keys: Keys;
}

interface LockedRecord {
  mode: 'locked';
  salt: string;
  iv: string;
  data: string;
}

type VaultRecord = PlainRecord | LockedRecord;

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function read(): VaultRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VaultRecord) : null;
  } catch {
    return null;
  }
}

function write(record: VaultRecord | null): boolean {
  try {
    if (record) localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

let unlocked: { keys: Keys; passphrase: string } | null = null;

export type VaultState = 'empty' | 'plain' | 'locked' | 'unlocked';

export function vaultState(): VaultState {
  const record = read();
  if (!record) return 'empty';
  if (record.mode === 'plain') return 'plain';
  return unlocked ? 'unlocked' : 'locked';
}

export function getKey(provider: ProviderId): string | undefined {
  const record = read();
  if (record?.mode === 'plain') return record.keys[provider];
  return unlocked?.keys[provider];
}

async function encrypt(keys: Keys, passphrase: string): Promise<LockedRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(keys)));
  return { mode: 'locked', salt: b64(salt), iv: b64(iv), data: b64(data) };
}

export async function saveKey(provider: ProviderId, value: string): Promise<boolean> {
  const record = read();
  if (record?.mode === 'locked') {
    if (!unlocked) return false;
    unlocked.keys[provider] = value;
    return write(await encrypt(unlocked.keys, unlocked.passphrase));
  }
  const keys = record?.mode === 'plain' ? record.keys : {};
  keys[provider] = value;
  return write({ mode: 'plain', keys });
}

export async function lockWithPassphrase(passphrase: string): Promise<boolean> {
  const record = read();
  const keys = record?.mode === 'plain' ? record.keys : (unlocked?.keys ?? {});
  unlocked = { keys, passphrase };
  return write(await encrypt(keys, passphrase));
}

export async function unlock(passphrase: string): Promise<boolean> {
  const record = read();
  if (record?.mode !== 'locked') return false;
  try {
    const key = await deriveKey(passphrase, unb64(record.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(record.iv) }, key, unb64(record.data));
    unlocked = { keys: JSON.parse(new TextDecoder().decode(plain)) as Keys, passphrase };
    return true;
  } catch {
    return false;
  }
}

export function forgetAll(): void {
  unlocked = null;
  write(null);
}
