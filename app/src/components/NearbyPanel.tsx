import { useEffect, useRef, useState } from 'react';
import { Navigation, Search, X } from 'lucide-react';
import { BASIN_BBOX } from '../shared/config';
import type { Station } from '../shared/types';
import { distanceKm, floodStageDistance, FRESHNESS, ft, localTime, TREND } from '../lib/format';

type Position = { lat: number; lon: number };

interface Props {
  stations: Station[] | undefined;
  position: Position | null;
  onPosition: (position: Position) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function NearbyPanel({ stations, position, onPosition, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  function locate() {
    if (!navigator.geolocation) {
      setMessage('Location is unavailable. Search for a town or gauge instead.');
      return;
    }
    setLocating(true);
    setMessage('');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!active.current) return;
      setLocating(false);
      const { latitude: lat, longitude: lon } = coords;
      if (lon < BASIN_BBOX.xmin || lon > BASIN_BBOX.xmax || lat < BASIN_BBOX.ymin || lat > BASIN_BBOX.ymax) {
        setMessage('Your location is outside the St. Johns River coverage area. You can still search for a gauge.');
        return;
      }
      setQuery('');
      onPosition({ lat, lon });
    }, (error) => {
      if (!active.current) return;
      setLocating(false);
      setMessage(error.code === error.PERMISSION_DENIED
        ? 'Location access was blocked. Search for a town or gauge instead.'
        : 'Your location couldn’t be found. Try again or search for a gauge.');
    }, { timeout: 10000 });
  }

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (stations ?? [])
    .filter((s) => s.inService && s.group !== 'other')
    .map((station) => {
      const searchable = [station.name, station.county, station.lid, station.usgsId].join(' ').toLowerCase();
      const km = position ? distanceKm(position.lat, position.lon, station.lat, station.lon) : null;
      return { station, searchable, km };
    })
    .filter(({ km, searchable }) => terms.length ? terms.every((term) => searchable.includes(term)) : km !== null && km <= 50)
    .sort((a, b) => (a.km ?? 0) - (b.km ?? 0) || a.station.name.localeCompare(b.station.name))
    .slice(0, terms.length ? 15 : 5);

  return (
    <section className="glass slide-in absolute bottom-3 right-3 top-3 z-20 flex w-[min(420px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl" aria-label="Nearby gauges">
      <header className="flex items-center justify-between border-b p-3" style={{ borderColor: 'var(--border)' }}>
        <h2 className="font-semibold">Nearby gauges</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close nearby gauges"><X size={16} /></button>
      </header>
      <div className="space-y-2 p-3">
        <button className="btn" disabled={locating} onClick={locate}>
          <Navigation size={15} /> {locating ? 'Locating…' : 'Use my location'}
        </button>
        <label className="card flex items-center gap-2 px-2 py-1.5">
          <Search size={15} aria-hidden />
          <input type="search" aria-label="Search town or gauge" placeholder="Search town or gauge" value={query}
            onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm" />
        </label>
        {message && <p className="muted text-xs" role="status">{message}</p>}
      </div>
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-3 pb-3" aria-live="polite">
        {!stations ? <p className="muted text-sm">Loading gauges…</p>
          : !rows.length && <p className="muted text-sm">{terms.length ? 'No gauges match your search.'
            : position ? 'No active gauges within 31 miles.' : 'Use your location or enter a town or gauge name.'}</p>}
        {rows.map(({ station, km }) => (
          <button key={station.id} className="card block w-full p-3 text-left" onClick={() => onSelect(station.id)}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold">{station.name}</div>
              {km !== null && <span className="faint shrink-0 text-xs">{(km / 1.609344).toFixed(1)} mi</span>}
            </div>
            {station.stage ? (
              <>
                <div className="mt-1 text-sm">{ft(station.stage.value)} · {TREND[station.trend].label}</div>
                <div className="muted text-xs">{floodStageDistance(station)?.label ?? 'No published flood stage'}</div>
                <div className="mt-1 text-xs">
                  <span className={FRESHNESS[station.freshness].cls}>{FRESHNESS[station.freshness].label}</span>
                  <span className="faint"> · Measured {localTime(station.stage.time)}</span>
                </div>
              </>
            ) : <div className="faint mt-1 text-xs">Water level unavailable</div>}
          </button>
        ))}
      </div>
    </section>
  );
}
