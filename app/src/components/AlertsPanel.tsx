import { useState } from 'react';
import { Bell, BellOff, CheckCheck, ExternalLink, ShieldAlert, Trash2 } from 'lucide-react';
import type { Snapshot } from '../shared/types';
import type { AlertSettings, AppAlert } from '../lib/alerts';
import { localTime, timeAgo } from '../lib/format';
import { PanelShell, Section } from './StationPanel';

interface Props {
  snapshot: Snapshot;
  appAlerts: AppAlert[];
  onAppAlerts: (a: AppAlert[]) => void;
  settings: AlertSettings;
  onSettings: (s: AlertSettings) => void;
  favorites: string[];
  onClose: () => void;
  onSelectStation: (id: string) => void;
}

const LEVEL_COLOR = { info: '#38bdf8', warn: '#fb923c', critical: '#f87171' };

export default function AlertsPanel({ snapshot, appAlerts, onAppAlerts, settings, onSettings, favorites, onClose, onSelectStation }: Props) {
  const [tab, setTab] = useState<'official' | 'app' | 'settings'>(snapshot.alerts.length ? 'official' : 'app');
  const [expanded, setExpanded] = useState<string | null>(null);
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const set = <K extends keyof AlertSettings>(k: K, v: AlertSettings[K]) => onSettings({ ...settings, [k]: v });
  // River flood warnings first, then other warnings, then advisories/statements
  const rank = (a: Snapshot['alerts'][number]) => (/^flood warning|flash flood warning/i.test(a.event) ? 3 : a.isWarning ? 2 : a.isFlood ? 1 : 0);
  const official = [...snapshot.alerts].sort((a, b) => rank(b) - rank(a) || b.sent.localeCompare(a.sent));

  return (
    <PanelShell onClose={onClose} title="Alerts" sub="Official NWS products are kept separate from alerts this app generates.">
      <div className="mb-3 flex gap-1" role="tablist">
        <button role="tab" aria-selected={tab === 'official'} className={`btn ${tab === 'official' ? 'btn-active' : ''}`} onClick={() => setTab('official')}>
          <ShieldAlert size={13} /> Official NWS ({official.length})
        </button>
        <button role="tab" aria-selected={tab === 'app'} className={`btn ${tab === 'app' ? 'btn-active' : ''}`} onClick={() => setTab('app')}>
          <Bell size={13} /> App alerts ({appAlerts.filter((a) => !a.read).length})
        </button>
        <button role="tab" aria-selected={tab === 'settings'} className={`btn ${tab === 'settings' ? 'btn-active' : ''}`} onClick={() => setTab('settings')}>
          Settings
        </button>
      </div>

      {tab === 'official' && (
        <>
          <div className="mb-2 rounded-lg border px-2.5 py-1.5 text-[11px]" style={{ borderColor: 'rgba(248,113,113,.4)', background: 'rgba(127,29,29,.18)' }}>
            Issued by the National Weather Service for counties in the St. Johns basin. Follow official instructions and local emergency management.
          </div>
          {official.length === 0 && <div className="faint py-6 text-center text-sm">No active flood-related NWS alerts for basin counties.</div>}
          <div className="space-y-2">
            {official.map((a) => (
              <div key={a.id} className="rounded-xl border p-2.5 text-[12px]" style={{ borderColor: a.isWarning ? 'rgba(248,113,113,.55)' : 'rgba(251,146,60,.45)', background: a.isWarning ? 'rgba(127,29,29,.25)' : 'rgba(124,45,18,.18)' }}>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-red-600 px-1.5 py-0.5 text-[9.5px] font-bold text-white">OFFICIAL NWS</span>
                  <span className="font-semibold">{a.event}</span>
                  <span className="faint ml-auto text-[10.5px]">{a.severity}</span>
                </div>
                <div className="mt-1">{a.headline}</div>
                <div className="faint mt-0.5 text-[10.5px]">
                  {a.areaDesc} · sent {localTime(a.sent)}
                  {a.expires && ` · until ${localTime(a.expires)}`}
                </div>
                <div className="mt-1 flex gap-3 text-[11px]">
                  <button className="accent" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                    {expanded === a.id ? 'Hide text' : 'Read full text'}
                  </button>
                  <a className="accent inline-flex items-center gap-1" href={a.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={11} /> Source
                  </a>
                  {snapshot.stations
                    .filter((s) => s.officialAlertIds.includes(a.id))
                    .slice(0, 2)
                    .map((s) => (
                      <button key={s.id} className="accent truncate" onClick={() => onSelectStation(s.id)}>
                        {s.name}
                      </button>
                    ))}
                </div>
                {expanded === a.id && (
                  <pre className="scroll-thin mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-[11.5px] leading-snug opacity-90">
                    {a.description}
                    {a.instruction ? `\n\n${a.instruction}` : ''}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'app' && (
        <>
          <div className="mb-2 flex items-center gap-2">
            <div className="faint flex-1 text-[11px]">Generated by St. Johns River Watch from changes between refreshes. Not official warnings.</div>
            <button className="btn px-2 py-1 text-[11px]" onClick={() => onAppAlerts(appAlerts.map((a) => ({ ...a, read: true })))}>
              <CheckCheck size={12} /> Mark read
            </button>
            <button className="btn px-2 py-1 text-[11px]" onClick={() => onAppAlerts([])}>
              <Trash2 size={12} /> Clear
            </button>
          </div>
          {appAlerts.length === 0 && <div className="faint py-6 text-center text-sm">No app alerts yet. They appear when a refresh shows a change you asked to hear about.</div>}
          <div className="space-y-1.5">
            {appAlerts.map((a) => (
              <div key={a.id} className="card flex gap-2 p-2 text-[12px]" style={{ opacity: a.read ? 0.65 : 1, borderLeft: `3px solid ${LEVEL_COLOR[a.level]}` }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded px-1 text-[9px] font-bold" style={{ background: 'rgba(34,211,238,.15)', color: 'var(--accent)' }}>
                      APP ALERT
                    </span>
                    <span className="truncate font-semibold">{a.title}</span>
                  </div>
                  <div className="muted mt-0.5">{a.body}</div>
                  <div className="faint mt-0.5 text-[10.5px]">
                    {timeAgo(a.time)}
                    {a.stationId && (
                      <>
                        {' · '}
                        <button className="accent" onClick={() => onSelectStation(a.stationId!)}>
                          open station
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'settings' && (
        <div className="text-[12.5px]">
          <Section title="Browser notifications">
            <div className="flex items-center gap-2">
              {perm === 'granted' ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="accent-cyan-500" checked={settings.browserNotifications} onChange={(e) => set('browserNotifications', e.target.checked)} /> Show desktop notifications
                </label>
              ) : perm === 'unsupported' ? (
                <span className="faint">This browser does not support notifications.</span>
              ) : (
                <button
                  className="btn"
                  onClick={() =>
                    Notification.requestPermission().then((p) => {
                      if (p === 'granted') set('browserNotifications', true);
                    })
                  }
                >
                  {perm === 'denied' ? <BellOff size={13} /> : <Bell size={13} />} {perm === 'denied' ? 'Blocked in browser settings' : 'Allow notifications'}
                </button>
              )}
            </div>
            <label className="mt-1.5 flex items-center gap-2">
              <input type="checkbox" className="accent-cyan-500" checked={settings.sound} onChange={(e) => set('sound', e.target.checked)} /> Play a chime
            </label>
          </Section>
          <Section title="Which stations">
            <select value={settings.scope} onChange={(e) => set('scope', e.target.value as AlertSettings['scope'])} className="w-full rounded-lg border bg-[var(--panel-solid)] px-2 py-1.5" style={{ borderColor: 'var(--border)' }} aria-label="Alert scope">
              <option value="main">Main stem + favorites</option>
              <option value="favorites">Favorites only ({favorites.length})</option>
              <option value="all">All basin stations</option>
            </select>
          </Section>
          <Section title="Rules">
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-cyan-500" checked={settings.floodStage} onChange={(e) => set('floodStage', e.target.checked)} /> Station enters a higher flood category (minor or worse)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-cyan-500" checked={settings.rapidRise} onChange={(e) => set('rapidRise', e.target.checked)} /> Rising faster than
                <input
                  type="number"
                  step="0.05"
                  min="0.01"
                  value={settings.rapidRiseFtPerHour}
                  onChange={(e) => set('rapidRiseFtPerHour', Math.max(0.01, parseFloat(e.target.value) || 0.2))}
                  className="w-16 rounded border bg-transparent px-1 tabular-nums"
                  style={{ borderColor: 'var(--border)' }}
                  aria-label="Rapid rise threshold"
                />
                ft/hour
              </label>
              <label className="ml-6 flex items-center gap-2 text-[11.5px]">
                <input type="checkbox" className="accent-cyan-500" checked={settings.ignoreTidal} onChange={(e) => set('ignoreTidal', e.target.checked)} /> Ignore tidal gauges for rapid rise
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-cyan-500" checked={settings.forecastChanges} onChange={(e) => set('forecastChanges', e.target.checked)} /> Official forecast crest changes by ≥
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={settings.forecastChangeFt}
                  onChange={(e) => set('forecastChangeFt', Math.max(0.1, parseFloat(e.target.value) || 0.2))}
                  className="w-14 rounded border bg-transparent px-1 tabular-nums"
                  style={{ borderColor: 'var(--border)' }}
                  aria-label="Forecast change threshold"
                />
                ft
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-cyan-500" checked={settings.newWarnings} onChange={(e) => set('newWarnings', e.target.checked)} /> New official NWS flood warning or advisory
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-cyan-500" checked={settings.staleData} onChange={(e) => set('staleData', e.target.checked)} /> Data becomes stale or a source goes down
              </label>
            </div>
          </Section>
          <Section title="Water level above a value">
            {settings.levelRules.length === 0 && <div className="faint text-[11.5px]">Add one from any station's panel ("Alert me").</div>}
            {settings.levelRules.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-0.5">
                <span className="flex-1 truncate">
                  {r.stationName} &gt; {r.above.toFixed(2)} ft
                </span>
                <button className="icon-btn h-6 w-6" onClick={() => set('levelRules', settings.levelRules.filter((x) => x.id !== r.id))} aria-label="Remove rule">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </Section>
        </div>
      )}
    </PanelShell>
  );
}
