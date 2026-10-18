import { DEFAULT_LOCAL_URL, isLoopbackUrl, providerInfo, type ByokConfig, type ProviderId } from './byok/providers';
import { getKey, saveKey } from './byok/vault';

export type EngineMode = 'device' | 'key';

interface Stored {
  mode?: EngineMode;
  provider?: ProviderId;
  models?: Partial<Record<ProviderId, string>>;
  baseUrl?: string;
  remember?: boolean;
}

const KEY = 'forsakeai.prefs';

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

/** How the user wants rewrites done. Survives reloads, except unsaved API keys. */
export class EnginePrefs {
  mode = $state<EngineMode>('key');
  provider = $state<ProviderId>('gemini');
  model = $state('');
  baseUrl = $state(DEFAULT_LOCAL_URL);
  key = $state('');
  remember = $state(false);
  /** True once the user has picked an engine, so the panel can offer it directly. */
  chosen = $state(false);

  constructor() {
    const s = read();
    // On-device models fix stock phrases but don't change how detectors score text, so new users start on a key.
    this.mode = s.mode ?? 'key';
    this.provider = s.provider ?? 'gemini';
    this.baseUrl = s.baseUrl ?? DEFAULT_LOCAL_URL;
    this.remember = s.remember ?? false;
    this.chosen = s.mode !== undefined;
    this.loadProvider();
  }

  /** Pulls the saved key and model for the current provider. */
  loadProvider(): void {
    const s = read();
    this.key = getKey(this.provider) ?? '';
    this.model = s.models?.[this.provider] ?? providerInfo(this.provider).defaultModel ?? '';
  }

  get info() {
    return providerInfo(this.provider);
  }

  /** What's missing before an API-key rewrite can run, or null when ready. */
  get keyProblem(): string | null {
    if (this.provider === 'local' && !isLoopbackUrl(this.baseUrl)) return 'Local server URLs must point to localhost or 127.0.0.1.';
    if (this.info.keyRequired && !this.key) return `Add your ${this.info.label} key.`;
    if (!this.model) return 'Pick a model.';
    return null;
  }

  byok(): ByokConfig {
    return { provider: this.provider, key: this.key, model: this.model, baseUrl: this.provider === 'local' ? this.baseUrl : undefined };
  }

  async save(): Promise<boolean> {
    this.chosen = true;
    try {
      const s = read();
      localStorage.setItem(
        KEY,
        JSON.stringify({ ...s, mode: this.mode, provider: this.provider, baseUrl: this.baseUrl, remember: this.remember, models: { ...s.models, [this.provider]: this.model } }),
      );
    } catch {
      // Preferences are a convenience; private windows may block storage.
    }
    if (this.mode === 'key' && this.remember && this.key) return saveKey(this.provider, this.key);
    return true;
  }
}
