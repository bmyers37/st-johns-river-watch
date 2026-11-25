import type { Freshness, Severity, Station, Trend } from '../shared/types';

export const SEVERITY_ORDER: Severity[] = ['unknown', 'normal', 'action', 'minor', 'moderate', 'major'];
export const severityRank = (s: Severity) => SEVERITY_ORDER.indexOf(s);

export const SEVERITY: Record<Severity, { label: string; color: string; text: string }> = {
  normal: { label: 'Normal', color: '#22c55e', text: '#052e16' },
  action: { label: 'Action stage', color: '#facc15', text: '#422006' },
  minor: { label: 'Minor flooding', color: '#fb923c', text: '#431407' },
  moderate: { label: 'Moderate flooding', color: '#ef4444', text: '#fff' },
  major: { label: 'Major flooding', color: '#a855f7', text: '#fff' },
  unknown: { label: 'No data / no threshold', color: '#6b7280', text: '#fff' },
};

export const THRESHOLD_COLORS = { action: '#facc15', minor: '#fb923c', moderate: '#ef4444', major: '#a855f7' } as const;

export const TREND: Record<Trend, { label: string; glyph: string }> = {
  rising: { label: 'Rising', glyph: '▲' },
  falling: { label: 'Falling', glyph: '▼' },
  steady: { label: 'Steady', glyph: '■' },
  unknown: { label: 'Trend unknown', glyph: '?' },
};

export const FRESHNESS: Record<Freshness, { label: string; cls: string }> = {
  fresh: { label: 'Current', cls: 'text-emerald-400' },
  stale: { label: 'Stale', cls: 'text-amber-400' },
  old: { label: 'Out of date', cls: 'text-rose-400' },
  none: { label: 'Unavailable', cls: 'text-slate-400' },
};

export const GROUP_LABEL: Record<Station['group'], string> = {
  main: 'St. Johns main stem',
  tributary: 'Tributaries & lakes',
  coastal: 'Coastal / Indian River Lagoon',
  other: 'Outside the basin',
};

export const ft = (v: number | undefined | null, digits = 2) => (v === undefined || v === null || !isFinite(v) ? '—' : `${v.toFixed(digits)} ft`);
export const signed = (v: number | undefined | null, digits = 2, unit = ' ft') =>
  v === undefined || v === null || !isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}${unit}`;
export const cfs = (v: number | undefined | null) =>
  v === undefined || v === null || !isFinite(v) ? '—' : `${Math.round(v).toLocaleString()} cfs`;

export function timeAgo(iso: string | number | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!isFinite(t)) return '—';
  const s = Math.round((now - t) / 1000);
  if (s < 0) return `in ${humanDur(-s)}`;
  if (s < 45) return 'just now';
  return `${humanDur(s)} ago`;
}

export function humanDur(s: number) {
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${Math.round(h / 24)} d`;
}

export const localTime = (iso: string | number | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Distance from the current stage to the next official threshold. */
export function floodStageDistance(st: Station): { label: string; value: number } | null {
  if (!st.stage || !st.thresholds) return null;
  const flood = st.thresholds.minor ?? st.thresholds.moderate ?? st.thresholds.major;
  if (flood === undefined) return null;
  const d = st.stage.value - flood;
  return { label: d >= 0 ? `${d.toFixed(2)} ft above flood stage` : `${Math.abs(d).toFixed(2)} ft below flood stage`, value: d };
}

export const bearingName = (b: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((b % 360) + 360) % 360 / 45) % 8];
