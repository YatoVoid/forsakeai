/** Settings saved under the project's earlier name move to the current keys once. */
export function migrateStorage(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('plainhand.')) continue;
      const next = `forsakeai.${key.slice('plainhand.'.length)}`;
      if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key)!);
      localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked; nothing to move.
  }
}
