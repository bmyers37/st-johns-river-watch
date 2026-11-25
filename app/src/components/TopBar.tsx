import { useEffect, useState } from 'react';
import { Bell, Database, Maximize2, MapPin, Moon, PanelLeft, RefreshCw, ShieldAlert, Sun, Waves, WifiOff } from 'lucide-react';
import type { Snapshot } from '../shared/types';
import { REFRESH_SECONDS } from '../shared/config';
import { localTime, timeAgo } from '../lib/format';

interface Props {
  snapshot: Snapshot | null;
  lastSuccess: number | null;
  nextAt: number;
  fetching: boolean;
  fetchError: string | null;
  theme: 'dark' | 'light';
  onTheme: () => void;
  onRefresh: () => void;
  dashboardOpen: boolean;
  onDashboard: () => void;
  onAlerts: () => void;
  onSources: () => void;
  alertCount: number;
  officialCount: number;
  pinMode: boolean;
  onPinMode: () => void;
  onMapOnly: () => void;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function RefreshRing({ nextAt, fetching, size = 30 }: { nextAt: number; fetching: boolean; size?: number }) {
  const now = useNow();
  const left = Math.max(0, Math.round((nextAt - now) / 1000));
  const frac = Math.min(1, left / REFRESH_SECONDS);
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }} aria-label={`Next refresh in ${left} seconds`} role="timer">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth="3" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--accent)" strokeWidth="3" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9.5px] font-semibold tabular-nums">{fetching ? '…' : left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : left}</span>
    </div>
  );
}

export default function TopBar(p: Props) {
  const now = useNow();
  const connectionStale = p.fetchError && p.lastSuccess;
  const sourcesDown = p.snapshot?.sources.filter((s) => !s.ok && !s.note).length ?? 0;
  return (
    <header className="z-20 flex h-14 shrink-0 items-center gap-3 border-b px-3" style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }}>
      <button className="icon-btn" onClick={p.onDashboard} aria-label={p.dashboardOpen ? 'Hide dashboard' : 'Show dashboard'} title="Dashboard">
        <PanelLeft size={18} />
      </button>
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'linear-gradient(135deg, #0891b2, #2563eb)' }}>
          <Waves size={18} color="white" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">St. Johns River Watch</div>
          <div className="faint text-[10.5px]">Live hydrological monitoring · Florida</div>
        </div>
      </div>

      {p.officialCount > 0 && (
        <button onClick={p.onAlerts} className="pill ml-2 hidden border border-red-400/50 bg-red-600/20 text-red-200 md:inline-flex light:border-red-300 light:bg-red-50 light:text-red-700">
          <ShieldAlert size={13} /> {p.officialCount} official NWS flood product{p.officialCount === 1 ? '' : 's'}
        </button>
      )}

      <div className="flex-1" />

      <div className="hidden items-center gap-3 text-xs lg:flex">
        {connectionStale ? (
          <span className="pill" style={{ color: '#fcd34d', background: 'rgba(245,158,11,0.14)' }} title={p.fetchError ?? ''}>
            <WifiOff size={12} /> Connection problem · showing data from {timeAgo(p.lastSuccess!, now)} (stale)
          </span>
        ) : p.fetchError ? (
          <span className="pill" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.14)' }}>
            <WifiOff size={12} /> {p.fetchError}
          </span>
        ) : null}
        <div className="text-right leading-tight">
          <div className="faint text-[10px] uppercase tracking-wider">Last successful refresh</div>
          <div className="font-medium tabular-nums">{p.lastSuccess ? `${localTime(p.lastSuccess)} · ${timeAgo(p.lastSuccess, now)}` : p.fetching ? 'Loading live data…' : '—'}</div>
        </div>
        <RefreshRing nextAt={p.nextAt} fetching={p.fetching} />
      </div>

      <div className="flex items-center gap-1">
        <button className="icon-btn" onClick={p.onRefresh} aria-label="Refresh now" title="Refresh now">
          <RefreshCw size={17} className={p.fetching ? 'animate-spin' : ''} />
        </button>
        <button className={`icon-btn ${p.pinMode ? 'btn-active' : ''}`} onClick={p.onPinMode} aria-pressed={p.pinMode} aria-label="Drop an analysis pin" title="Drop an analysis pin (then click the map)">
          <MapPin size={17} />
        </button>
        <button className="icon-btn relative" onClick={p.onAlerts} aria-label="Alerts" title="Alerts">
          <Bell size={17} />
          {p.alertCount > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-cyan-500 px-1 text-[9px] font-bold text-slate-950">{p.alertCount > 99 ? '99+' : p.alertCount}</span>}
        </button>
        <button className="icon-btn relative" onClick={p.onSources} aria-label="Data sources" title="Data sources and health">
          <Database size={17} />
          {sourcesDown > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400" />}
        </button>
        <button className="icon-btn" onClick={p.onTheme} aria-label="Toggle light or dark theme" title="Light / dark theme">
          {p.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button className="icon-btn" onClick={p.onMapOnly} aria-label="Full-screen map" title="Full-screen map (Esc to exit)">
          <Maximize2 size={17} />
        </button>
      </div>
    </header>
  );
}
