import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsLeft, CloudRain, MapPin, Search, ShieldAlert, Star, Trash2 } from 'lucide-react';
import type { Severity, Snapshot, Station } from '../shared/types';
import { FRESHNESS, GROUP_LABEL, SEVERITY, TREND, cfs, localTime, severityRank, signed, timeAgo } from '../lib/format';
import type { SavedLocation } from '../lib/prefs';
import { RefreshRing, useNow } from './TopBar';

interface Props {
  snapshot: Snapshot | null;
  lastSuccess: number | null;
  nextAt: number;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  locations: SavedLocation[];
  onLocation: (l: SavedLocation) => void;
  onRemoveLocation: (id: string) => void;
  onCollapse: () => void;
  onShowAlerts: () => void;
  refreshCount: number;
}

type SortKey = 'name' | 'stage' | 'change' | 'severity' | 'flow' | 'age';
type Tab = 'all' | 'favorites' | 'main' | 'flooding';

export function SeverityDot({ s, size = 10 }: { s: Severity; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: SEVERITY[s].color }} aria-hidden />;
}

export function TrendGlyph({ st }: { st: Station }) {
  const color = st.trend === 'rising' ? '#f87171' : st.trend === 'falling' ? '#34d399' : 'var(--faint)';
  return (
    <span style={{ color }} title={TREND[st.trend].label} aria-label={TREND[st.trend].label}>
      {TREND[st.trend].glyph}
    </span>
  );
}

function Kpi({ label, value, sub, color, onClick }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className="card px-3 py-2.5 text-left transition hover:brightness-110">
      <div className="label-xs">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold leading-none tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="faint mt-1 text-[10.5px]">{sub}</div>}
    </Tag>
  );
}

export default function Dashboard(p: Props) {
  const now = useNow(5000);
  const [kpiOpen, setKpiOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'severity', dir: -1 });

  const stats = useMemo(() => {
    const st = p.snapshot?.stations.filter((s) => s.group !== 'other') ?? [];
    const active = st.filter((s) => s.inService && (s.freshness === 'fresh' || s.freshness === 'stale'));
    const flooding = active.filter((s) => severityRank(s.severity) >= severityRank('minor'));
    const highest = active.reduce<Severity>((m, s) => (severityRank(s.severity) > severityRank(m) ? s.severity : m), 'unknown');
    const warnings = p.snapshot?.alerts.filter((a) => a.isFlood && a.isWarning) ?? [];
    return {
      total: st.length,
      active: active.length,
      flooding: flooding.length,
      action: active.filter((s) => s.severity === 'action').length,
      rising: active.filter((s) => s.trend === 'rising').length,
      falling: active.filter((s) => s.trend === 'falling').length,
      highest,
      highestStation: active.filter((s) => s.severity === highest && highest !== 'unknown').map((s) => s.name),
      warnings: warnings.length,
      stale: st.filter((s) => s.freshness === 'stale' || s.freshness === 'old').length,
    };
  }, [p.snapshot]);

  const rows = useMemo(() => {
    let list = p.snapshot?.stations ?? [];
    if (tab === 'favorites') list = list.filter((s) => p.favorites.includes(s.id));
    else if (tab === 'main') list = list.filter((s) => s.group === 'main');
    else if (tab === 'flooding') list = list.filter((s) => severityRank(s.severity) >= severityRank('action'));
    else list = list.filter((s) => s.group !== 'other' || p.favorites.includes(s.id));
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q) || s.lid?.toLowerCase().includes(q) || s.usgsId?.includes(q));
    }
    const val = (s: Station): number | string => {
      switch (sort.key) {
        case 'name':
          return s.name;
        case 'stage':
          return s.stage?.value ?? -Infinity;
        case 'change':
          return s.changes.h24 ?? s.changes.h6 ?? -Infinity;
        case 'severity':
          return severityRank(s.severity) * 1000 + (s.stage && s.thresholds?.minor ? s.stage.value - s.thresholds.minor : -999) / 100;
        case 'flow':
          return s.flow?.value ?? -Infinity;
        case 'age':
          return -(s.ageMinutes ?? 1e9);
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
    });
  }, [p.snapshot, tab, query, sort, p.favorites]);

  const th = (key: SortKey, label: string, cls = '') => (
    <th className={`px-1.5 py-1.5 font-semibold ${cls}`} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button
        className="inline-flex items-center gap-0.5 hover:text-[var(--text)]"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))}
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </button>
    </th>
  );

  const loading = !p.snapshot;
  const rain = [...(p.snapshot?.rain ?? [])].sort((a, b) => (b.totals.h24 ?? 0) - (a.totals.h24 ?? 0));
  const rainSource = p.snapshot?.sources.find((s) => s.name === 'USGS rain gauges');

  return (
    <aside className="absolute inset-y-0 left-0 z-10 flex w-[min(392px,100%)] shrink-0 flex-col border-r md:relative md:w-[392px]" style={{ borderColor: 'var(--border)', background: 'var(--bg2)' }} aria-label="Dashboard">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <button className="label-xs flex items-center gap-1 hover:text-[var(--text)]" onClick={() => setKpiOpen(!kpiOpen)} aria-expanded={kpiOpen}>
          Overview {kpiOpen ? '▾' : '▸'}
        </button>
        <button className="icon-btn h-7 w-7" onClick={p.onCollapse} aria-label="Collapse dashboard" title="Collapse dashboard">
          <ChevronsLeft size={16} />
        </button>
      </div>

      {kpiOpen && (
        <div className="grid grid-cols-2 gap-2 px-3 pb-2">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-[66px]" />)
          ) : (
            <>
              <Kpi label="Active stations" value={stats.active} sub={`${stats.total} in basin · ${stats.stale} stale/old`} color="var(--accent)" />
              <Kpi label="Above flood stage" value={stats.flooding} sub={`${stats.action} more at action stage`} color={stats.flooding ? '#fb923c' : undefined} onClick={() => setTab('flooding')} />
              <Kpi label="Rising" value={<span className="text-rose-400">▲ {stats.rising}</span>} sub="3-hour change > 0.05 ft" />
              <Kpi label="Falling" value={<span className="text-emerald-400">▼ {stats.falling}</span>} sub="3-hour change < −0.05 ft" />
              <Kpi
                label="Highest severity"
                value={<span className="text-[15px]">{SEVERITY[stats.highest].label}</span>}
                sub={stats.highestStation.slice(0, 2).join(', ') + (stats.highestStation.length > 2 ? ` +${stats.highestStation.length - 2}` : '') || '—'}
                color={stats.highest === 'unknown' ? undefined : SEVERITY[stats.highest].color}
              />
              <Kpi
                label="NWS flood warnings"
                value={
                  <span className="inline-flex items-center gap-1.5" style={{ color: stats.warnings ? '#f87171' : undefined }}>
                    <ShieldAlert size={18} /> {stats.warnings}
                  </span>
                }
                sub="Official · basin counties"
                onClick={p.onShowAlerts}
              />
              <Kpi label="Last refresh" value={<span className="text-[15px]">{p.lastSuccess ? new Date(p.lastSuccess).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—'}</span>} sub={p.lastSuccess ? timeAgo(p.lastSuccess, now) : 'waiting'} />
              <div className="card flex items-center gap-3 px-3 py-2.5">
                <RefreshRing nextAt={p.nextAt} fetching={false} size={40} />
                <div>
                  <div className="label-xs">Next refresh</div>
                  <div className="faint text-[10.5px]">every 120 s · sources update every 15–60 min</div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 px-3 pt-1" role="tablist">
        {(
          [
            ['all', 'All'],
            ['main', 'Main stem'],
            ['flooding', 'Flooding'],
            ['favorites', `★ ${p.favorites.length}`],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn px-2 py-1 text-[11.5px] ${tab === k ? 'btn-active' : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={13} className="faint absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search stations"
            className="w-[104px] rounded-lg border bg-transparent py-1 pl-6 pr-2 text-[12px] outline-none focus:border-[var(--accent)]"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>
      </div>

      <div className="scroll-thin mt-1 min-h-0 flex-1 overflow-y-auto px-1.5">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead className="sticky top-0 z-10" style={{ background: 'var(--bg2)' }}>
            <tr className="faint text-left text-[10.5px] uppercase tracking-wide">
              <th className="w-5" />
              {th('name', 'Station')}
              {th('stage', 'Stage', 'text-right')}
              {th('change', '24 h', 'text-right')}
              {th('severity', 'Status')}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 12 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={5} className="p-1">
                    <div className="skeleton h-7" />
                  </td>
                </tr>
              ))}
            {rows.map((s) => (
              <tr
                key={s.id}
                className={`cursor-pointer transition-colors hover:bg-[var(--panel-2)] ${p.selectedId === s.id ? 'bg-[var(--panel-2)]' : ''}`}
                onClick={() => p.onSelect(s.id)}
                onKeyDown={(e) => e.key === 'Enter' && p.onSelect(s.id)}
                tabIndex={0}
                aria-label={`${s.name}, ${SEVERITY[s.severity].label}`}
              >
                <td className="border-b py-1.5 pl-1" style={{ borderColor: 'var(--border)' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onToggleFavorite(s.id);
                    }}
                    aria-label={p.favorites.includes(s.id) ? 'Remove from favorites' : 'Add to favorites'}
                    aria-pressed={p.favorites.includes(s.id)}
                  >
                    <Star size={13} className={p.favorites.includes(s.id) ? 'fill-amber-400 text-amber-400' : 'faint'} />
                  </button>
                </td>
                <td className="max-w-[150px] border-b px-1.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
                  <div className="truncate font-medium" title={s.name}>
                    {s.name}
                  </div>
                  <div className="faint truncate text-[10px]">
                    {s.lid ?? `USGS ${s.usgsId}`} · <span className={FRESHNESS[s.freshness].cls}>{s.ageMinutes !== undefined ? timeAgo(Date.now() - s.ageMinutes * 60000, now) : FRESHNESS[s.freshness].label}</span>
                    {s.flags.includes('tidal') && ' · tidal'}
                  </div>
                </td>
                <td className="border-b px-1.5 py-1.5 text-right tabular-nums" style={{ borderColor: 'var(--border)' }}>
                  {s.stage ? (
                    <>
                      <span className="font-semibold">{s.stage.value.toFixed(2)}</span> <TrendGlyph st={s} />
                    </>
                  ) : s.flow ? (
                    <span className="faint text-[10.5px]">{cfs(s.flow.value)}</span>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </td>
                <td className="border-b px-1.5 py-1.5 text-right tabular-nums" style={{ borderColor: 'var(--border)' }}>
                  <span className={s.changes.h24 === undefined ? 'faint' : s.changes.h24 > 0.05 ? 'text-rose-400' : s.changes.h24 < -0.05 ? 'text-emerald-400' : ''}>{signed(s.changes.h24, 2, '')}</span>
                </td>
                <td className="border-b px-1.5 py-1.5" style={{ borderColor: 'var(--border)' }}>
                  <span className="inline-flex items-center gap-1.5 text-[11px]">
                    <SeverityDot s={s.severity} />
                    <span className="truncate">{s.severity === 'unknown' ? (s.thresholds ? 'No data' : 'No threshold') : SEVERITY[s.severity].label.replace(' flooding', '')}</span>
                  </span>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="faint p-4 text-center text-xs">
                  {tab === 'favorites' ? 'No favorites yet - click ☆ next to a station to add it.' : 'No stations match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="faint px-2 py-2 text-[10px]">
          Stage in feet above each gauge's own datum - values from different gauges are not comparable. {rows.length} shown · {GROUP_LABEL.other} hidden in "All".
        </div>
      </div>

      <div className="border-t px-3 py-2" style={{ borderColor: 'var(--border)' }}>
        <div className="label-xs mb-1 flex items-center gap-1">
          <CloudRain size={12} /> Rainfall · USGS gauges (24 h / 7 d)
        </div>
        <div className="scroll-thin max-h-[86px] overflow-y-auto text-[11.5px]">
          {rain.length === 0 && (
            <div className="faint">
              {rainSource?.error ? 'USGS rainfall data is temporarily unavailable.' : loading || !rainSource?.lastSuccess ? 'Loading USGS rain gauges…' : 'No rain gauge reported in the last 7 days.'}
            </div>
          )}
          {rain.map((r) => (
            <div key={r.id} className="flex justify-between gap-2 py-0.5" title={`${r.source} · last report ${localTime(r.lastTime)}`}>
              <span className="truncate">{r.name.replace(/,? FL\.?$/i, '')}</span>
              <span className={`shrink-0 tabular-nums ${r.freshness !== 'fresh' ? 'text-amber-400' : ''}`}>
                {r.totals.h24 === undefined ? '—' : r.totals.h24.toFixed(2) + '″'} / {r.totals.d7 === undefined ? '—' : r.totals.d7.toFixed(2) + '″'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t px-3 py-2" style={{ borderColor: 'var(--border)' }}>
        <div className="label-xs mb-1 flex items-center gap-1">
          <MapPin size={12} /> Saved locations
        </div>
        {p.locations.length === 0 && <div className="faint text-[11px]">Drop a pin on the map and save it to keep it here.</div>}
        {p.locations.map((l) => (
          <div key={l.id} className="flex items-center justify-between py-0.5 text-[12px]">
            <button className="truncate text-left hover:text-[var(--accent)]" onClick={() => p.onLocation(l)}>
              {l.name}
            </button>
            <button className="icon-btn h-6 w-6" onClick={() => p.onRemoveLocation(l.id)} aria-label={`Remove ${l.name}`}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
