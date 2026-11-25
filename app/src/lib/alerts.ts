// App-generated alerts. These come from St. Johns River Watch comparing one data refresh with the
// next; they are NOT official warnings. Official NWS warnings are kept separate everywhere.
import type { Snapshot, Station } from '../shared/types';
import { SEVERITY, severityRank } from './format';

export interface LevelRule {
  id: string;
  stationId: string;
  stationName: string;
  measure: 'stage' | 'wse';
  above: number;
}

export interface AlertSettings {
  scope: 'favorites' | 'main' | 'all';
  levelRules: LevelRule[];
  floodStage: boolean;
  rapidRise: boolean;
  rapidRiseFtPerHour: number;
  ignoreTidal: boolean;
  forecastChanges: boolean;
  forecastChangeFt: number;
  newWarnings: boolean;
  staleData: boolean;
  browserNotifications: boolean;
  sound: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  scope: 'main',
  levelRules: [],
  floodStage: true,
  rapidRise: true,
  rapidRiseFtPerHour: 0.2,
  ignoreTidal: true,
  forecastChanges: true,
  forecastChangeFt: 0.2,
  newWarnings: true,
  staleData: true,
  browserNotifications: false,
  sound: false,
};

export type AppAlertKind = 'level' | 'flood-stage' | 'rapid-rise' | 'forecast' | 'official-warning' | 'stale';

export interface AppAlert {
  id: string;
  kind: AppAlertKind;
  time: string;
  title: string;
  body: string;
  stationId?: string;
  level: 'info' | 'warn' | 'critical';
  read?: boolean;
}

const inScope = (s: Station, settings: AlertSettings, favorites: string[]) =>
  settings.scope === 'all' ? s.group !== 'other' : settings.scope === 'main' ? s.group === 'main' || favorites.includes(s.id) : favorites.includes(s.id);

/** Compare two snapshots and list what changed that the person asked to hear about. */
export function evaluateAlerts(prev: Snapshot | null, next: Snapshot, settings: AlertSettings, favorites: string[]): AppAlert[] {
  const out: AppAlert[] = [];
  const now = next.generatedAt;
  const prevById = new Map(prev?.stations.map((s) => [s.id, s]) ?? []);
  const mk = (a: Omit<AppAlert, 'id' | 'time'>): AppAlert => ({ ...a, id: `${a.kind}:${a.stationId ?? ''}:${now}:${Math.random().toString(36).slice(2, 7)}`, time: now });

  // Water level above a chosen value: fires when it crosses (or on first check if already above).
  for (const r of settings.levelRules) {
    const s = next.stations.find((x) => x.id === r.stationId);
    if (!s) continue;
    const cur = r.measure === 'wse' ? s.wse?.value : s.stage?.value;
    const p = prevById.get(r.stationId);
    const was = p ? (r.measure === 'wse' ? p.wse?.value : p.stage?.value) : undefined;
    if (cur !== undefined && cur > r.above && (was === undefined ? !prev : was <= r.above))
      out.push(
        mk({
          kind: 'level',
          stationId: s.id,
          level: 'warn',
          title: `${s.name}: above ${r.above.toFixed(2)} ft`,
          body: `${r.measure === 'wse' ? `Water surface ${cur.toFixed(2)} ft ${s.wse?.datum}` : `Stage ${cur.toFixed(2)} ft`} (measured ${new Date(s.stage!.time).toLocaleTimeString()}).`,
        }),
      );
  }

  if (!prev) return out; // other rules need a previous refresh to compare with

  for (const s of next.stations) {
    if (!inScope(s, settings, favorites)) continue;
    const p = prevById.get(s.id);
    if (!p) continue;
    if (settings.floodStage && severityRank(s.severity) >= severityRank('minor') && severityRank(s.severity) > severityRank(p.severity) && p.severity !== 'unknown')
      out.push(
        mk({
          kind: 'flood-stage',
          stationId: s.id,
          level: severityRank(s.severity) >= severityRank('moderate') ? 'critical' : 'warn',
          title: `${s.name}: now ${SEVERITY[s.severity].label}`,
          body: `Stage ${s.stage?.value.toFixed(2)} ft (was ${SEVERITY[p.severity].label}). Category basis: ${s.severityBasis}.`,
        }),
      );
    if (settings.rapidRise && s.ratePerHour !== undefined && s.ratePerHour >= settings.rapidRiseFtPerHour && !(settings.ignoreTidal && s.flags.includes('tidal'))) {
      const wasRapid = p.ratePerHour !== undefined && p.ratePerHour >= settings.rapidRiseFtPerHour;
      if (!wasRapid)
        out.push(
          mk({
            kind: 'rapid-rise',
            stationId: s.id,
            level: 'warn',
            title: `${s.name}: rising fast`,
            body: `Rising ${s.ratePerHour.toFixed(2)} ft/hour (alert threshold ${settings.rapidRiseFtPerHour} ft/hour).`,
          }),
        );
    }
    if (settings.forecastChanges && s.forecast?.crest && p.forecast?.crest) {
      const d = s.forecast.crest.value - p.forecast.crest.value;
      if (s.forecast.issued !== p.forecast.issued && Math.abs(d) >= settings.forecastChangeFt)
        out.push(
          mk({
            kind: 'forecast',
            stationId: s.id,
            level: d > 0 ? 'warn' : 'info',
            title: `${s.name}: forecast crest ${d > 0 ? 'raised' : 'lowered'}`,
            body: `New official forecast crest ${s.forecast.crest.value.toFixed(1)} ft (previous ${p.forecast.crest.value.toFixed(1)} ft).`,
          }),
        );
    }
    if (settings.staleData && (s.freshness === 'stale' || s.freshness === 'old' || s.freshness === 'none') && p.freshness === 'fresh')
      out.push(
        mk({
          kind: 'stale',
          stationId: s.id,
          level: 'info',
          title: `${s.name}: data is ${s.freshness === 'stale' ? 'stale' : 'unavailable'}`,
          body: s.stage ? `Last reading ${new Date(s.stage.time).toLocaleString()}.` : 'No current reading from the source.',
        }),
      );
  }

  if (settings.newWarnings) {
    const before = new Set(prev.alerts.map((a) => a.id));
    for (const a of next.alerts)
      if (!before.has(a.id) && (a.isFlood || a.isWarning))
        out.push(mk({ kind: 'official-warning', level: a.isWarning ? 'critical' : 'warn', title: `New official NWS ${a.event}`, body: a.areaDesc }));
  }

  if (settings.staleData)
    for (const src of next.sources) {
      const was = prev.sources.find((x) => x.name === src.name);
      if (was?.ok && !src.ok) out.push(mk({ kind: 'stale', level: 'info', title: `${src.name} unavailable`, body: src.error ?? 'Source did not respond; last good data is kept and marked stale.' }));
    }
  return out;
}

let audioCtx: AudioContext | null = null;
export function chime() {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.6);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.65);
  } catch {
    /* audio blocked */
  }
}

export function notify(a: AppAlert) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(a.kind === 'official-warning' ? `NWS: ${a.title}` : `River Watch (app alert): ${a.title}`, { body: a.body, tag: a.id });
  } catch {
    /* some browsers need a service worker */
  }
}
