import { franc } from 'franc-min';

export function detectLang(text: string, only?: string[]): string {
  const sample = text.length > 4000 ? text.slice(0, 4000) : text;
  return franc(sample, only ? { minLength: 20, only } : { minLength: 20 });
}
