
import { raw } from '@/db/client';
import { randomUUID } from 'node:crypto';
import { SEED_NOTE, SEED_PRICING } from './pricing/seed';

export const DEFAULT_SETTINGS: Record<string, string> = {
  'general.baseCurrency': 'USD',
  'general.displayCurrency': 'USD',
  'general.usdToMyr': '4.70',
  'general.dateFormat': 'yyyy-MM-dd',
  'general.weekStart': 'monday',
  'general.defaultRange': '30d',
  'appearance.wallpaper': 'default',
  'appearance.wallpaperOpacity': '0.35',
  'appearance.panelOpacity': '0.94',
  'appearance.compact': 'false',
  'appearance.reduceMotion': 'false',
  'privacy.promptPolicy': 'preview',
  'privacy.showSourceFiles': 'true',
  'scan.auto': 'true',
  'scan.autoRefreshMinutes': '0',
  'scan.maxFileSizeMb': '256',
  'costBasis': 'api_equivalent',
  'dataset': 'real',
};

export function getSetting(key: string): string | null {
  try {
    const r = raw().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value?: string } | undefined;
    return r?.value ?? DEFAULT_SETTINGS[key] ?? null;
  } catch {
    return DEFAULT_SETTINGS[key] ?? null;
  }
}

export function getAllSettings(): Record<string, string> {
  const out = { ...DEFAULT_SETTINGS };
  try {
    for (const r of raw().prepare(`SELECT key, value FROM settings`).all() as any[]) out[r.key] = r.value;
  } catch {
    /* pre-migration */
  }
  return out;
}

export function setSetting(key: string, value: string): void {
  raw()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

/** Insert bundled pricing rows once. Never overwrites user edits. */
export function seedPricingIfEmpty(): number {
  const d = raw();
  const n = (d.prepare(`SELECT COUNT(*) c FROM pricing`).get() as any).c as number;
  if (n > 0) return 0;
  const ins = d.prepare(
    `INSERT INTO pricing (id, provider, model_id, aliases, effective_from, effective_to,
       input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok,
       reasoning_per_mtok, currency, source_note, user_override, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, 'USD', ?, 0, ?)`,
  );
  const tx = d.transaction(() => {
    for (const p of SEED_PRICING) {
      ins.run(
        randomUUID(),
        p.provider,
        p.modelId,
        JSON.stringify(p.aliases),
        p.effectiveFrom,
        p.input,
        p.output,
        p.cacheRead,
        p.cacheWrite,
        SEED_NOTE,
        new Date().toISOString(),
      );
    }
  });
  tx();
  return SEED_PRICING.length;
}
