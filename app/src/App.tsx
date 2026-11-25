import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot } from './shared/types';
import { REFRESH_SECONDS } from './shared/config';
import { getSnapshot } from './lib/api';
import { DEFAULT_LAYERS, usePersistentState, type Basemap, type LayerPrefs, type SavedLocation } from './lib/prefs';
import { DEFAULT_ALERT_SETTINGS, chime, evaluateAlerts, notify, type AlertSettings, type AppAlert } from './lib/alerts';
import TopBar from './components/TopBar';
import Dashboard from './components/Dashboard';
import MapView from './components/MapView';
import StationPanel from './components/StationPanel';
import PinPanel from './components/PinPanel';
import AlertsPanel from './components/AlertsPanel';
import SourcesPanel from './components/SourcesPanel';

export type Panel = 'station' | 'pin' | 'alerts' | 'sources' | null;

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [lastSuccess, setLastSuccess] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [nextAt, setNextAt] = useState<number>(Date.now() + REFRESH_SECONDS * 1000);
  const [refreshCount, setRefreshCount] = useState(0);

  const [theme, setTheme] = usePersistentState<'dark' | 'light'>('theme', 'dark');
  const [basemap, setBasemap] = usePersistentState<Basemap>('basemap', 'dark');
  const [layers, setLayers] = usePersistentState<LayerPrefs>('layers', DEFAULT_LAYERS);
  const [dashboardOpen, setDashboardOpen] = usePersistentState('dashboardOpen', true);
  const [favorites, setFavorites] = usePersistentState<string[]>('favorites', []);
  const [locations, setLocations] = usePersistentState<SavedLocation[]>('locations', []);
  const [alertSettings, setAlertSettings] = usePersistentState<AlertSettings>('alertSettings', DEFAULT_ALERT_SETTINGS);
  const [appAlerts, setAppAlerts] = usePersistentState<AppAlert[]>('appAlerts', []);

  const [panel, setPanel] = useState<Panel>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [pinMode, setPinMode] = useState(false);
  const [mapOnly, setMapOnly] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; zoom?: number; t: number } | null>(null);
  const [overlayGeo, setOverlayGeo] = useState<{ nhd: GeoJSON.FeatureCollection | null; terrain: [number, number][] | null }>({ nhd: null, terrain: null });

  const prevSnap = useRef<Snapshot | null>(null);
  const settingsRef = useRef(alertSettings);
  settingsRef.current = alertSettings;
  const favRef = useRef(favorites);
  favRef.current = favorites;

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  // ---- polling every 120 s; the map is never reset ----
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const refresh = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    setFetching(true);
    try {
      const snap = await getSnapshot();
      if (!Array.isArray(snap?.stations)) throw new Error('Unexpected response from data service');
      const fresh = evaluateAlerts(prevSnap.current, snap, settingsRef.current, favRef.current);
      if (fresh.length) {
        setAppAlerts((old) => [...fresh, ...old].slice(0, 150));
        if (settingsRef.current.browserNotifications) fresh.forEach(notify);
        if (settingsRef.current.sound) chime();
      }
      prevSnap.current = snap;
      setSnapshot(snap);
      setLastSuccess(Date.now());
      setFetchError(null);
      failures.current = 0;
      const next = Date.now() + REFRESH_SECONDS * 1000;
      setNextAt(next);
      timer.current = setTimeout(refresh, REFRESH_SECONDS * 1000);
    } catch (e) {
      failures.current++;
      setFetchError((e as Error).message || 'Connection failed');
      // back off: 15 s, 30 s, 60 s, then the normal interval
      const wait = Math.min(REFRESH_SECONDS, 15 * 2 ** (failures.current - 1)) * 1000;
      setNextAt(Date.now() + wait);
      timer.current = setTimeout(refresh, wait);
    } finally {
      setFetching(false);
      setRefreshCount((c) => c + 1);
    }
  }, [setAppAlerts]);

  useEffect(() => {
    refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  const selected = useMemo(() => snapshot?.stations.find((s) => s.id === selectedId) ?? null, [snapshot, selectedId]);

  const openStation = useCallback((id: string, fly = false) => {
    setSelectedId(id);
    setPanel('station');
    if (fly) {
      const s = prevSnap.current?.stations.find((x) => x.id === id);
      if (s) setFlyTo({ lat: s.lat, lon: s.lon, zoom: 11, t: Date.now() });
    }
  }, []);

  const dropPin = useCallback((lat: number, lon: number) => {
    setPin({ lat, lon });
    setPinMode(false);
    setPanel('pin');
    setOverlayGeo({ nhd: null, terrain: null });
  }, []);

  const toggleFavorite = useCallback((id: string) => setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id])), [setFavorites]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pinMode) setPinMode(false);
        else if (panel) setPanel(null);
        else if (mapOnly) setMapOnly(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, pinMode, mapOnly]);

  const toggleMapOnly = useCallback(() => {
    setMapOnly((v) => {
      const next = !v;
      try {
        if (next && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
        if (!next && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      } catch {
        /* fullscreen not allowed */
      }
      return next;
    });
  }, []);

  const unread = appAlerts.filter((a) => !a.read).length;
  const officialCount = snapshot?.alerts.filter((a) => a.isFlood || a.isWarning).length ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      {!mapOnly && (
        <TopBar
          snapshot={snapshot}
          lastSuccess={lastSuccess}
          nextAt={nextAt}
          fetching={fetching}
          fetchError={fetchError}
          theme={theme}
          onTheme={() => {
            const next = theme === 'dark' ? 'light' : 'dark';
            setTheme(next);
            if (next === 'light' && basemap === 'dark') setBasemap('streets');
            if (next === 'dark' && basemap === 'streets') setBasemap('dark');
          }}
          onRefresh={refresh}
          dashboardOpen={dashboardOpen}
          onDashboard={() => setDashboardOpen(!dashboardOpen)}
          onAlerts={() => setPanel(panel === 'alerts' ? null : 'alerts')}
          onSources={() => setPanel(panel === 'sources' ? null : 'sources')}
          alertCount={unread}
          officialCount={officialCount}
          pinMode={pinMode}
          onPinMode={() => setPinMode(!pinMode)}
          onMapOnly={toggleMapOnly}
        />
      )}
      <div className="relative flex min-h-0 flex-1">
        {!mapOnly && dashboardOpen && (
          <Dashboard
            snapshot={snapshot}
            lastSuccess={lastSuccess}
            nextAt={nextAt}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onSelect={(id) => openStation(id, true)}
            selectedId={selectedId}
            locations={locations}
            onLocation={(l) => {
              setFlyTo({ lat: l.lat, lon: l.lon, zoom: 14, t: Date.now() });
              dropPin(l.lat, l.lon);
            }}
            onRemoveLocation={(id) => setLocations(locations.filter((l) => l.id !== id))}
            onCollapse={() => setDashboardOpen(false)}
            onShowAlerts={() => setPanel('alerts')}
            refreshCount={refreshCount}
          />
        )}
        <main className="relative min-w-0 flex-1">
          <MapView
            snapshot={snapshot}
            basemap={basemap}
            onBasemap={setBasemap}
            layers={layers}
            onLayers={setLayers}
            selectedId={selectedId}
            onSelect={(id) => openStation(id)}
            pin={pin}
            pinMode={pinMode}
            onPinMode={setPinMode}
            onDropPin={dropPin}
            flyTo={flyTo}
            overlayGeo={overlayGeo}
            mapOnly={mapOnly}
            onExitMapOnly={toggleMapOnly}
            onOpenAlerts={() => setPanel('alerts')}
            theme={theme}
          />
          {panel === 'station' && selected && (
            <StationPanel
              key={selected.id}
              station={selected}
              snapshot={snapshot!}
              favorite={favorites.includes(selected.id)}
              onToggleFavorite={() => toggleFavorite(selected.id)}
              onClose={() => setPanel(null)}
              onSelect={(id) => openStation(id, true)}
              onAddLevelRule={(rule) => setAlertSettings({ ...alertSettings, levelRules: [...alertSettings.levelRules, rule] })}
            />
          )}
          {panel === 'pin' && pin && snapshot && (
            <PinPanel
              key={`${pin.lat},${pin.lon}`}
              pin={pin}
              snapshot={snapshot}
              onClose={() => {
                setPanel(null);
                setPin(null);
                setOverlayGeo({ nhd: null, terrain: null });
              }}
              onSave={(name) => setLocations([...locations, { id: `${Date.now()}`, name, lat: pin.lat, lon: pin.lon }])}
              saved={locations.some((l) => Math.abs(l.lat - pin.lat) < 1e-5 && Math.abs(l.lon - pin.lon) < 1e-5)}
              onGeometry={setOverlayGeo}
              onSelectStation={(id) => openStation(id, true)}
            />
          )}
          {panel === 'alerts' && snapshot && (
            <AlertsPanel
              snapshot={snapshot}
              appAlerts={appAlerts}
              onAppAlerts={setAppAlerts}
              settings={alertSettings}
              onSettings={setAlertSettings}
              favorites={favorites}
              onClose={() => setPanel(null)}
              onSelectStation={(id) => openStation(id, true)}
            />
          )}
          {panel === 'sources' && snapshot && <SourcesPanel snapshot={snapshot} lastSuccess={lastSuccess} fetchError={fetchError} onClose={() => setPanel(null)} />}
        </main>
      </div>
    </div>
  );
}
