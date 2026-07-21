export function compactNumber(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(digits)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)}k`;
  return String(Math.round(n));
}

export function fullNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

const group = (n: number, min = 2, max = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });

/**
 * Money for cards, tables and tooltips: grouped with thousand separators, and
 * never shown with more precision than the input justifies.
 */
export function money(n: number | null | undefined, currency = 'USD', rate = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = n * rate;
  const sym = currency === 'MYR' ? 'RM' : '$';
  const abs = Math.abs(v);
  if (abs === 0) return `${sym}0.00`;
  // Above a million, full digits stop being readable; abbreviate instead.
  if (abs >= 1_000_000) return `${sign(v)}${sym}${group(abs / 1e6)}M`;
  if (abs >= 1) return `${sign(v)}${sym}${group(abs)}`;
  return `${sign(v)}${sym}${abs.toFixed(abs < 0.01 ? 4 : 3)}`;
}

/**
 * Money for chart axes: deliberately compact and separator-free so tick labels
 * stay narrow and the plot area keeps its width.
 */
export function moneyAxis(n: number | null | undefined, currency = 'USD'): string {
  if (n == null || !Number.isFinite(n)) return '';
  const sym = currency === 'MYR' ? 'RM' : '$';
  const abs = Math.abs(n);
  if (abs === 0) return `${sym}0`;
  if (abs >= 1_000_000) return `${sign(n)}${sym}${trim(abs / 1e6)}M`;
  if (abs >= 1_000) return `${sign(n)}${sym}${trim(abs / 1e3)}k`;
  if (abs >= 1) return `${sign(n)}${sym}${trim(abs)}`;
  return `${sign(n)}${sym}${abs.toFixed(2)}`;
}

/** Drop a trailing ".0" so axes read "$2k" rather than "$2.0k". */
const trim = (n: number) => {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
};

const sign = (v: number) => (v < 0 ? '-' : '');

/** ROI percentages routinely reach five figures, so they are grouped too. */
export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function multiple(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}×`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function deltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function truncateMid(s: string, max = 44): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}
