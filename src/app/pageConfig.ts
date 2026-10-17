import type { PageConfig } from '../pages/languages';

export function readPageConfig(): PageConfig | null {
  const el = document.getElementById('page-config');
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as PageConfig;
  } catch {
    return null;
  }
}
