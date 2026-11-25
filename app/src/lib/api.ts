// Talks to the local server. If the server is not running (for example the page was opened from
// a static host), the same data engine runs directly in the browser - every source allows that.
import type { DataEngine } from '../shared/engine';
import type { HistoryResponse, PointInfo, Snapshot, StationDetail } from '../shared/types';

type Mode = 'server' | 'direct';
let mode: Mode | null = null;
let engine: DataEngine | null = null;
let detecting: Promise<Mode> | null = null;

async function getJson<T>(path: string, timeoutMs = 90000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(path, { signal: ctrl.signal, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as any)?.error ?? `HTTP ${r.status}`);
    return j as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Request timed out');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export function detectMode(): Promise<Mode> {
  if (mode) return Promise.resolve(mode);
  if (detecting) return detecting;
  detecting = (async () => {
    try {
      const h = await getJson<{ ok: boolean; name?: string }>('api/health', 4000);
      if (h.ok && h.name) return (mode = 'server');
    } catch {
      /* no server */
    }
    const { DataEngine } = await import('../shared/engine');
    engine = new DataEngine({ warmupWaitMs: 8000 });
    return (mode = 'direct');
  })();
  return detecting;
}

export const currentMode = () => mode;

export async function getSnapshot(): Promise<Snapshot> {
  const m = await detectMode();
  if (m === 'server') return getJson<Snapshot>('api/snapshot');
  return { ...(await engine!.snapshot()), mode: 'direct' };
}

export async function getHistory(id: string, hours: number): Promise<HistoryResponse> {
  const m = await detectMode();
  if (m === 'server') return getJson(`api/station/${encodeURIComponent(id)}/history?hours=${hours}`);
  return engine!.history(id, hours);
}

export async function getDetail(id: string): Promise<StationDetail> {
  const m = await detectMode();
  if (m === 'server') return getJson(`api/station/${encodeURIComponent(id)}/detail`);
  return engine!.stationDetail(id);
}

export async function getLayer(id: string, bbox: [number, number, number, number] | null, zoom: number): Promise<GeoJSON.FeatureCollection> {
  const m = await detectMode();
  if (m === 'server') return getJson(`api/layer/${id}?zoom=${zoom.toFixed(1)}${bbox ? `&bbox=${bbox.map((n) => n.toFixed(4)).join(',')}` : ''}`);
  return engine!.layer(id, bbox, zoom);
}

export async function getMainStem(): Promise<GeoJSON.FeatureCollection> {
  const m = await detectMode();
  if (m === 'server') return getJson('api/mainstem', 120000);
  return engine!.mainStem();
}

export async function getPoint(lat: number, lon: number): Promise<PointInfo> {
  const m = await detectMode();
  if (m === 'server') return getJson(`api/point?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
  return engine!.point(lat, lon);
}
