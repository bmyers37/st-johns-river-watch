import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { BellPlus, ExternalLink, Info, ShieldAlert, Star, X } from 'lucide-react';
import type { HistoryResponse, Snapshot, Station, StationDetail } from '../shared/types';
import { getDetail, getHistory } from '../lib/api';
import { FRESHNESS, GROUP_LABEL, SEVERITY, THRESHOLD_COLORS, TREND, cfs, floodStageDistance, localTime, signed, timeAgo } from '../lib/format';
import type { LevelRule } from '../lib/alerts';
import HistoryChart from './HistoryChart';
import { useNow } from './TopBar';

interface Props {
  station: Station;
  snapshot: Snapshot;
  favorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  onAddLevelRule: (r: LevelRule) => void;
}

const RANGES: [number, string][] = [
  [24, '24 h'],
  [48, '48 h'],
  [168, '7 d'],
  [720, '30 d'],
  [2160, '90 d'],
];

export function PanelShell({ title, sub, onClose, children, actions }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="glass slide-in absolute bottom-3 right-3 top-3 z-20 flex w-[min(468px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl" aria-label="Details panel">
      <header className="flex items-start gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold leading-snug">{title}</h2>
          {sub && <div className="muted mt-0.5 text-[11.5px]">{sub}</div>}
        </div>
        {actions}
        <button className="icon-btn h-8 w-8" onClick={onClose} aria-label="Close panel">
          <X size={16} />
        </button>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
    </section>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="label-xs">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function StationPanel({ station: s, snapshot, favorite, onToggleFavorite, onClose, onSelect, onAddLevelRule }: Props) {
  const now = useNow(10000);
  const [range, setRange] = useState(() => (s.lid ? 168 : 48));
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<StationDetail | null>(null);
  const [showFlow, setShowFlow] = useState(false);
  const [showForecast, setShowForecast] = useState(true);
  const [ruleValue, setRuleValue] = useState<string>(() => String(s.thresholds?.minor ?? (s.stage ? (s.stage.value + 0.5).toFixed(1) : '')));
  const [ruleMsg, setRuleMsg] = useState<string | null>(null);
  const theme = document.documentElement.classList.contains('light') ? 'light' : 'dark';

  // reload the chart when the range changes and on every data refresh (snapshot time)
  useEffect(() => {
    let alive = true;
    setHistErr(null);
    getHistory(s.id, range)
      .then((h) => alive && setHistory(h))
      .catch((e) => alive && setHistErr(e.message));
    return () => {
      alive = false;
    };
  }, [s.id, range, snapshot.generatedAt]);

  useEffect(() => {
    let alive = true;
    getDetail(s.id)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail({ stationId: s.id, historicCrests: [], recentCrests: [], impacts: [], datums: [] }));
    return () => {
      alive = false;
    };
  }, [s.id]);

  const sev = SEVERITY[s.severity];
  const dist = floodStageDistance(s);
  const alerts = snapshot.alerts.filter((a) => s.officialAlertIds.includes(a.id));
  const neighbors = [detail?.upstream, detail?.downstream].map((lid) => snapshot.stations.find((x) => x.lid === lid));
  const relevantImpacts = (detail?.impacts ?? []).filter((i) => !s.stage || i.stage <= s.stage.value + 2).slice(0, 4);

  return (
    <PanelShell
      onClose={onClose}
      title={s.name}
      sub={
        <>
          {s.lid && <span>NWS {s.lid}</span>}
          {s.lid && s.usgsId && ' · '}
          {s.usgsId && <span>USGS {s.usgsId}</span>} · {GROUP_LABEL[s.group]}
          {s.county && ` · ${s.county} County`}
          <br />
          {s.lat.toFixed(4)}°N, {Math.abs(s.lon).toFixed(4)}°W
        </>
      }
      actions={
        <button className="icon-btn h-8 w-8" onClick={onToggleFavorite} aria-pressed={favorite} aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} title="Favorite">
          <Star size={16} className={favorite ? 'fill-amber-400 text-amber-400' : ''} />
        </button>
      }
    >
      {alerts.map((a) => (
        <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="mb-3 block rounded-xl border px-3 py-2 text-[12px]" style={{ background: 'rgba(127,29,29,0.35)', borderColor: 'rgba(248,113,113,0.5)' }}>
          <div className="flex items-center gap-1.5 font-semibold text-red-300">
            <ShieldAlert size={14} /> OFFICIAL NWS {a.event.toUpperCase()}
          </div>
          <div className="mt-0.5 text-red-100/90">{a.headline}</div>
          <div className="faint mt-0.5 text-[10.5px]">Linked by name match in the warning text · {a.sender}</div>
        </a>
      ))}

      {/* current reading */}
      <div className="card mb-3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="label-xs">Current stage</div>
            {s.stage ? (
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-[34px] font-semibold leading-none tabular-nums">{s.stage.value.toFixed(2)}</span>
                <span className="muted text-sm">ft</span>
                <span className="text-lg" style={{ color: s.trend === 'rising' ? '#f87171' : s.trend === 'falling' ? '#34d399' : 'var(--muted)' }}>
                  {TREND[s.trend].glyph}
                </span>
              </div>
            ) : (
              <div className="mt-1 text-lg font-semibold text-slate-400">No stage reading</div>
            )}
            <div className="faint mt-1 text-[11px]">Datum: {s.stageDatum}</div>
          </div>
          <div className="text-right">
            <span className="pill" style={{ background: sev.color, color: sev.text }}>
              {sev.label}
            </span>
            <div className="faint mt-1 max-w-[170px] text-[10.5px] leading-snug">{s.severityBasis}</div>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          <div className="muted">Measured</div>
          <div className="text-right tabular-nums">
            {s.stage ? localTime(s.stage.time) : '—'}{' '}
            <span className={FRESHNESS[s.freshness].cls}>
              ({s.stage ? timeAgo(s.stage.time, now) : FRESHNESS[s.freshness].label}
              {s.freshness !== 'fresh' && s.stage ? ` · ${FRESHNESS[s.freshness].label}` : ''})
            </span>
          </div>
          <div className="muted">Trend / rate</div>
          <div className="text-right">
            {TREND[s.trend].label}
            {s.ratePerHour !== undefined && ` · ${signed(s.ratePerHour, 2, ' ft/h')}`}
          </div>
          <div className="muted">Flood stage</div>
          <div className="text-right font-medium" style={{ color: dist ? (dist.value >= 0 ? '#fb923c' : '#34d399') : undefined }}>
            {dist ? dist.label : 'No published flood stage'}
          </div>
          <div className="muted">Source</div>
          <div className="text-right">
            {s.stage?.source ?? '—'}
            {s.stage?.qualifiers?.includes('P') && ' · provisional'}
            {s.stage?.qualifiers?.includes('e') && ' · estimated'}
          </div>
        </div>
        {s.flags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {s.flags.map((f) => (
              <span key={f} className="pill" style={{ background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-[12px]">
        <div className="card p-2.5">
          <div className="label-xs">Streamflow</div>
          <div className="mt-0.5 text-[16px] font-semibold tabular-nums">{cfs(s.flow?.value)}</div>
          <div className="faint text-[10.5px]">{s.flow ? `${s.flow.source} · ${timeAgo(s.flow.time, now)}${s.flow.qualifiers?.includes('e') ? ' · estimated' : ''}` : 'Not measured here'}</div>
        </div>
        <div className="card p-2.5">
          <div className="label-xs">Water-surface elevation</div>
          <div className="mt-0.5 text-[16px] font-semibold tabular-nums">{s.wse ? `${s.wse.value.toFixed(2)} ft` : '—'}</div>
          <div className="faint text-[10.5px] leading-snug">{s.wse ? `${s.wse.datum} · ${s.wse.method}` : 'Not available - no published gauge-datum offset'}</div>
        </div>
        <div className="card p-2.5">
          <div className="label-xs">Official forecast</div>
          {s.forecast?.crest ? (
            <>
              <div className="mt-0.5 text-[16px] font-semibold tabular-nums">
                Crest {s.forecast.crest.value.toFixed(1)} ft
              </div>
              <div className="faint text-[10.5px]">
                {localTime(s.forecast.crest.time)} · issued {timeAgo(s.forecast.issued, now)}
                {s.forecast.category && ` · ${SEVERITY[s.forecast.category].label}`}
              </div>
            </>
          ) : (
            <div className="faint mt-1 text-[11px]">{s.lid ? 'No current NWS forecast for this gauge' : 'NWS does not forecast this site'}</div>
          )}
        </div>
        <div className="card p-2.5">
          <div className="label-xs">Flood thresholds (NWS)</div>
          {s.thresholds ? (
            <div className="mt-1 space-y-0.5 text-[11.5px] tabular-nums">
              {(['action', 'minor', 'moderate', 'major'] as const).map(
                (k) =>
                  s.thresholds![k] !== undefined && (
                    <div key={k} className="flex justify-between">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ background: THRESHOLD_COLORS[k] }} />
                        {k[0].toUpperCase() + k.slice(1)}
                      </span>
                      <span>{s.thresholds![k]!.toFixed(1)} ft</span>
                    </div>
                  ),
              )}
            </div>
          ) : (
            <div className="faint mt-1 text-[11px]">None published</div>
          )}
        </div>
      </div>

      {s.secondaryStage && (
        <div className="faint mb-3 flex gap-1.5 text-[11px]">
          <Info size={13} className="mt-0.5 shrink-0" /> {s.secondaryStage.source} gauge height {s.secondaryStage.value.toFixed(2)} ft. {s.secondaryStage.note}
        </div>
      )}

      <Section title="Change in water level">
        <div className="grid grid-cols-5 gap-1.5 text-center">
          {(['h1', 'h6', 'h12', 'h24', 'h48'] as const).map((k) => {
            const v = s.changes[k];
            return (
              <div key={k} className="card px-1 py-1.5">
                <div className="faint text-[10px]">{k.slice(1)} h</div>
                <div className={`text-[12.5px] font-semibold tabular-nums ${v === undefined ? 'faint' : v > 0.05 ? 'text-rose-400' : v < -0.05 ? 'text-emerald-400' : ''}`}>{signed(v, 2, '')}</div>
              </div>
            );
          })}
        </div>
        {s.flags.includes('tidal') && <div className="faint mt-1 text-[10.5px]">Tidal gauge: short-term changes mostly reflect tides and wind.</div>}
      </Section>

      <Section
        title="Water level history & forecast"
        right={
          <div className="flex gap-0.5" role="group" aria-label="Time range">
            {RANGES.map(([h, l]) => (
              <button key={h} className={`btn px-1.5 py-0.5 text-[10.5px] ${range === h ? 'btn-active' : ''}`} onClick={() => setRange(h)} aria-pressed={range === h}>
                {l}
              </button>
            ))}
          </div>
        }
      >
        <div className="card p-1.5">
          {history ? <HistoryChart history={history} showFlow={showFlow} showForecast={showForecast} theme={theme} /> : histErr ? <div className="p-6 text-center text-sm text-amber-400">History unavailable: {histErr}</div> : <div className="skeleton h-[260px]" />}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px]">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-cyan-500" checked={showForecast} onChange={(e) => setShowForecast(e.target.checked)} /> Official forecast
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-cyan-500" checked={showFlow} onChange={(e) => setShowFlow(e.target.checked)} disabled={!history?.flow} /> Discharge {history && !history.flow && '(not measured)'}
          </label>
          {history?.forecast && <span className="faint">Forecast issued {localTime(history.forecast.issued)}</span>}
        </div>
        {history?.notes.map((n) => (
          <div key={n} className="faint mt-1 text-[10.5px]">
            • {n}
          </div>
        ))}
      </Section>

      {relevantImpacts.length > 0 && (
        <Section title="NWS flood impacts near this level">
          <div className="space-y-1.5">
            {relevantImpacts.map((i) => (
              <div key={i.stage} className="card p-2 text-[11.5px] leading-snug">
                <span className="font-semibold">{i.stage.toFixed(1)} ft:</span> {i.statement}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Historical flood records">
        {!detail ? (
          <div className="skeleton h-24" />
        ) : detail.historicCrests.length === 0 ? (
          <div className="faint text-[11.5px]">No historic crests published for this site.</div>
        ) : (
          <table className="w-full text-[11.5px] tabular-nums">
            <thead className="faint text-left text-[10px] uppercase">
              <tr>
                <th className="py-1">#</th>
                <th>Date</th>
                <th className="text-right">Crest</th>
                <th className="text-right">vs now</th>
              </tr>
            </thead>
            <tbody>
              {detail.historicCrests.slice(0, 10).map((c, i) => (
                <tr key={c.time + c.stage} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="faint py-1">{i + 1}</td>
                  <td>
                    {new Date(c.time).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    {c.oldDatum && <span className="faint"> (old datum)</span>}
                    {c.preliminary && <span className="faint"> (prelim.)</span>}
                  </td>
                  <td className="text-right font-semibold">{c.stage.toFixed(2)} ft</td>
                  <td className="text-right">{s.stage ? signed(s.stage.value - c.stage, 2, '') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {detail && detail.recentCrests.length > 0 && (
          <div className="faint mt-1.5 text-[10.5px]">
            Recent crests: {detail.recentCrests.slice(0, 5).map((c) => `${new Date(c.time).getFullYear()} ${c.stage.toFixed(2)} ft`).join(' · ')}
          </div>
        )}
      </Section>

      {(neighbors[0] || neighbors[1]) && (
        <Section title="Along the river (NWS)">
          <div className="flex gap-2 text-[11.5px]">
            {neighbors.map(
              (n, i) =>
                n && (
                  <button key={n.id} className="card flex-1 p-2 text-left hover:border-[var(--border-strong)]" onClick={() => onSelect(n.id)}>
                    <div className="faint text-[10px]">{i === 0 ? 'Upstream' : 'Downstream'}</div>
                    <div className="truncate font-medium">{n.name}</div>
                    <div className="tabular-nums">
                      {n.stage ? `${n.stage.value.toFixed(2)} ft ${TREND[n.trend].glyph}` : '—'} <span style={{ color: SEVERITY[n.severity].color }}>●</span>
                    </div>
                  </button>
                ),
            )}
          </div>
        </Section>
      )}

      <Section title="Alert me (app alert)">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="muted">When stage exceeds</span>
          <input
            type="number"
            step="0.1"
            value={ruleValue}
            onChange={(e) => setRuleValue(e.target.value)}
            className="w-20 rounded-lg border bg-transparent px-2 py-1 tabular-nums outline-none focus:border-[var(--accent)]"
            style={{ borderColor: 'var(--border)' }}
            aria-label="Stage threshold in feet"
          />
          <span className="muted">ft</span>
          <button
            className="btn ml-auto"
            onClick={() => {
              const v = parseFloat(ruleValue);
              if (!isFinite(v)) return setRuleMsg('Enter a number');
              onAddLevelRule({ id: `${Date.now()}`, stationId: s.id, stationName: s.name, measure: 'stage', above: v });
              setRuleMsg(`Added - you will be alerted above ${v.toFixed(2)} ft`);
            }}
          >
            <BellPlus size={14} /> Add
          </button>
        </div>
        {ruleMsg && <div className="accent mt-1 text-[11px]">{ruleMsg}</div>}
      </Section>

      <Section title="Official sources">
        <div className="space-y-1">
          {s.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[12px] hover:text-[var(--accent)]">
              <ExternalLink size={12} /> {l.label}
            </a>
          ))}
        </div>
        {detail?.datums && detail.datums.length > 0 && (
          <div className="faint mt-2 text-[10.5px]">Published gauge-zero elevations: {detail.datums.map((d) => `${d.abbrev} ${d.value} ft`).join(' · ')}</div>
        )}
        {detail?.forecastReliability && <div className="faint mt-1 text-[10.5px]">Forecast note: {detail.forecastReliability}</div>}
      </Section>
    </PanelShell>
  );
}
